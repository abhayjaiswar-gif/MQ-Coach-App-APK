// Phase 3 — Parent verification (phone/email OTP) for the PUBLIC fitness-report
// QR destination (/reportcard?k=<report_key>).
//
// Behavioral baseline (legacy PHP pdf-verification flow, forensic doc §4):
//   6-digit OTP · 5-minute expiry · 3 verification attempts
// NOT ported from PHP: sessions, $_SESSION['pdf_otp'], debug_otp responses,
// legacy download flow. This is a DB-backed, hashed, report-scoped mechanism.
//
// Security invariants:
//   - report_key is always matched EXACTLY (result_id is never parsed from the
//     key and never trusted from the client).
//   - OTPs are stored as salted scrypt hashes — never plaintext, never logged,
//     never returned in responses.
//   - Access grants are 256-bit random tokens; only their SHA-256 hash is
//     stored; grants are short-lived and scoped to one report_key/result_id.
//   - No JWT, no client-side boolean trust.
//   - OTP delivery is dry-run by default (REPORT_OTP_DELIVERY must be 'live'
//     to actually send SMS/email) so tests can never fire real messages.
const crypto = require("crypto");
const db = require("../db");

const OTP_TTL_SECONDS = 300; // legacy: 5 minutes
const OTP_MAX_ATTEMPTS = 3; // legacy cap
const RESEND_COOLDOWN_SECONDS = 60; // abuse protection between sends
const GRANT_TTL_SECONDS = 3600; // short-lived report-session access grant
const MAX_ACTIVE_OTPS = 3; // cap unexpired OTPs per report/channel/destination
const MAX_OTP_PER_HOUR = 12; // extra cap on OTP rows per report per hour

const PHONE_RE = /^\d{10}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

let tablesEnsured = false;

// ─────────────────────────────────────────────────────────────────────────────
// Schema
// ─────────────────────────────────────────────────────────────────────────────
async function ensureTables() {
  if (tablesEnsured) return;
  await db.query(`
    CREATE TABLE IF NOT EXISTS report_access_otps (
      id          INT AUTO_INCREMENT PRIMARY KEY,
      report_key  VARCHAR(32)  NOT NULL,
      result_id   INT          NOT NULL,
      channel     ENUM('phone','email') NOT NULL,
      destination VARCHAR(255) NOT NULL,
      parent_name VARCHAR(255) DEFAULT NULL,
      otp_hash    VARCHAR(255) NOT NULL,
      expires_at  TIMESTAMP    NOT NULL,
      attempts    INT          NOT NULL DEFAULT 0,
      verified_at TIMESTAMP    NULL DEFAULT NULL,
      created_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
      KEY idx_otp_report (report_key),
      KEY idx_otp_channel (report_key, channel),
      KEY idx_otp_expires (expires_at)
    ) ENGINE=InnoDB
  `);
  await db.query(`
    CREATE TABLE IF NOT EXISTS report_access_grants (
      id          INT AUTO_INCREMENT PRIMARY KEY,
      report_key  VARCHAR(32)  NOT NULL,
      result_id   INT          NOT NULL,
      token_hash  VARCHAR(64)  NOT NULL,
      expires_at  TIMESTAMP    NOT NULL,
      created_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uq_grant_token (token_hash),
      KEY idx_grant_report (report_key),
      KEY idx_grant_expires (expires_at)
    ) ENGINE=InnoDB
  `);
  tablesEnsured = true;
}

// Called from server/index.js auto-migration block (existing init convention).
async function initTables() {
  tablesEnsured = false;
  await ensureTables();
  console.log("✅ report_access_otps / report_access_grants tables ensured");
}

// ─────────────────────────────────────────────────────────────────────────────
// Crypto helpers
// ─────────────────────────────────────────────────────────────────────────────
function generateOtp() {
  return String(crypto.randomInt(0, 1000000)).padStart(6, "0");
}

function hashSecret(value) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(String(value), salt, 64).toString("hex");
  return `scrypt$${salt}$${hash}`;
}

function verifySecret(value, stored) {
  try {
    const [algo, salt, hash] = String(stored).split("$");
    if (algo !== "scrypt" || !salt || !hash) return false;
    const expected = Buffer.from(hash, "hex");
    const actual = crypto.scryptSync(String(value), salt, 64);
    if (actual.length !== expected.length) return false;
    return crypto.timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

function sha256Hex(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function generateAccessToken() {
  return crypto.randomBytes(32).toString("hex");
}

// ─────────────────────────────────────────────────────────────────────────────
// Validation / resolution
// ─────────────────────────────────────────────────────────────────────────────
function normalizePhone(raw) {
  if (raw == null) return "";
  let digits = String(raw).replace(/\D/g, "");
  if (digits.length === 12 && digits.startsWith("91")) digits = digits.slice(2);
  return digits;
}

function normalizeEmail(raw) {
  return String(raw || "")
    .trim()
    .toLowerCase();
}

// Exact report_key lookup (both historical <12hex>-<id> and <12hex>B<id>).
async function resolveReport(reportKey) {
  const key = String(reportKey || "").trim();
  if (!key)
    return httpError(400, "REPORT_KEY_REQUIRED", "Report key is required");
  const [accessRows] = await db.query(
    `SELECT id, report_key, result_id, access_granted, parent_phone
     FROM fitness_test_report_access WHERE report_key = ?`,
    [key],
  );
  if (accessRows.length === 0) {
    return httpError(404, "REPORT_NOT_FOUND", "Report not found");
  }
  const access = accessRows[0];
  const [resultRows] = await db.query(
    `SELECT id, student_id, format_id, academic_year, term
     FROM fitness_test_results WHERE id = ?`,
    [access.result_id],
  );
  if (resultRows.length === 0) {
    return httpError(404, "RESULT_NOT_FOUND", "Report record not found");
  }
  const result = resultRows[0];
  const [studentRows] = await db.query(
    "SELECT id, name, std, division FROM students WHERE id = ?",
    [result.student_id],
  );
  if (studentRows.length === 0) {
    return httpError(404, "STUDENT_NOT_FOUND", "Student not found");
  }
  return { ok: true, access, result, student: studentRows[0] };
}

// ─────────────────────────────────────────────────────────────────────────────
// Delivery (SMS / email) — reuses the project's existing SMS env config and the
// existing nodemailer transport. Dry-run by default; never logs the OTP.
// ─────────────────────────────────────────────────────────────────────────────
function deliveryMode() {
  return process.env.REPORT_OTP_DELIVERY === "live" ? "live" : "dry";
}

function buildSmsMessage(otp) {
  return `Your OTP to view your child's report card is ${otp}. - Marcos Quay`;
}

// sms4g Transroute-style sendhttp API (values from server/.env).
async function sendSms(phone, otp) {
  const apiKey = (process.env.SMS_API_KEY || "").trim();
  const endpoint = (process.env.SMS_API_ENDPOINT || "")
    .trim()
    .replace(/^["']|["']$/g, "");
  const sender = (process.env.SMS_API_SENDER || "MQFEES").trim();
  const route = (process.env.SMS_API_ROUTE || "4").trim();
  const dltTemplateId = "1007262270357146308";

  if (!apiKey || !endpoint) {
    console.error(
      "[REPORT-ACCESS] SMS API configuration missing (SMS_API_KEY / SMS_API_ENDPOINT).",
    );
    throw new Error("SMS gateway is not configured on the server.");
  }

  const params = new URLSearchParams({
    authkey: apiKey,
    mobiles: phone,
    message: buildSmsMessage(otp),
    sender: sender,
    route: route,
    country: "91",
    DLT_TE_ID: dltTemplateId,
  });

  const url = `${endpoint}?${params.toString()}`;
  const safeUrl = `${endpoint}?mobiles=${phone}&sender=${sender}&route=${route}&country=91`;

  let res;
  let text = "";
  try {
    res = await fetch(url);
    text = await res.text();
  } catch (fetchErr) {
    console.error(
      `[REPORT-ACCESS] SMS HTTP fetch error (${safeUrl}):`,
      fetchErr.message,
    );
    throw new Error(
      `Failed to reach SMS provider gateway (${fetchErr.message})`,
    );
  }

  let isError = !res.ok;
  try {
    const json = JSON.parse(text);
    if (
      json.type === "error" ||
      json.code ||
      json.status === "error" ||
      (json.message && json.message.toLowerCase().includes("error"))
    ) {
      isError = true;
    }
  } catch {
    if (/error|invalid|fail|denied|unauthorized/i.test(text)) {
      isError = true;
    }
  }

  if (isError) {
    console.error(
      `[REPORT-ACCESS] SMS provider returned error (status ${res.status}): ${text.slice(0, 150)} (URL: ${safeUrl})`,
    );
    throw new Error(
      `SMS provider error (status ${res.status}): ${text.slice(0, 100)}`,
    );
  }

  console.log(
    `[REPORT-ACCESS] SMS delivery request accepted for phone ${phone} (response: ${text.slice(0, 50).trim()})`,
  );
}

async function sendOtpEmail(to, otp, parentName, studentName, ttlMinutes) {
  const mailUser = (process.env.MAIL_USER || "").trim();
  const mailPass = (process.env.MAIL_PASS || "").trim();
  if (!mailUser || !mailPass) {
    console.error(
      "[REPORT-ACCESS] SMTP credentials missing (MAIL_USER / MAIL_PASS).",
    );
    throw new Error("Email gateway is not configured on the server.");
  }

  const { transporter } = require("../emailService");
  const html = `
    <div style="font-family: sans-serif; max-width: 600px; margin: auto; padding: 20px; border: 1px solid #eee; border-radius: 10px;">
      <h2 style="color: #005daa; border-bottom: 2px solid #005daa; padding-bottom: 10px;">Physical Fitness Report — Verification</h2>
      <p>Hi ${escapeHtml(parentName || "Parent")},</p>
      <p>Use the code below to view <strong>${escapeHtml(studentName)}</strong>&#39;s Physical Fitness Report.</p>
      <div style="background-color: #f9f9f9; padding: 15px; border-radius: 5px; text-align: center; letter-spacing: 6px; font-size: 24px; font-weight: bold; color: #005daa;">${escapeHtml(
        otp,
      )}</div>
      <p style="font-size: 14px; color: #555;">This code is valid for ${ttlMinutes} minutes and can be used up to 3 times. Do not share it.</p>
      <hr style="margin-top: 30px; border: 0; border-top: 1px solid #eee;" />
      <p style="font-size: 11px; color: #aaa;">This is an automated message from Marcos Quay. If you did not request this, you can safely ignore it.</p>
    </div>`;

  const info = await transporter.sendMail({
    from: `"Marcos Quay" <${process.env.MAIL_FROM || "info@marcosquay.com"}>`,
    to,
    subject: "Your Physical Fitness Report Verification Code",
    html,
  });
  console.log(
    `[REPORT-ACCESS] OTP email sent successfully to ${to} (Message ID: ${info.messageId})`,
  );
  return info;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ─────────────────────────────────────────────────────────────────────────────
// OTP request
// ─────────────────────────────────────────────────────────────────────────────
async function requestOtp(reportKey, payload = {}) {
  await ensureTables();
  const channel = String(payload.channel || "");
  const parentName = String(payload.parentName || "").trim();
  if (channel !== "phone" && channel !== "email") {
    throw httpError(
      400,
      "INVALID_CHANNEL",
      "Channel must be 'phone' or 'email'",
    );
  }
  if (!parentName) {
    throw httpError(400, "PARENT_NAME_REQUIRED", "Parent name is required");
  }

  const resolved = await resolveReport(reportKey);
  if (!resolved.ok) throw resolved;

  let destination = "";
  if (channel === "phone") {
    destination = normalizePhone(payload.destination);
    if (!PHONE_RE.test(destination)) {
      throw httpError(
        400,
        "INVALID_PHONE",
        "Please enter a valid 10-digit phone number.",
      );
    }
  } else {
    destination = normalizeEmail(payload.destination);
    if (!EMAIL_RE.test(destination)) {
      throw httpError(
        400,
        "INVALID_EMAIL",
        "Please enter a valid email address.",
      );
    }
  }
  const reportKeyId = resolved.access.report_key;

  // Abuse protection (server-side only, no external dependency).
  const [[{ activeCount }]] = await db.query(
    `SELECT COUNT(*) AS activeCount FROM report_access_otps
     WHERE report_key = ? AND channel = ? AND destination = ?
       AND verified_at IS NULL AND expires_at > NOW()`,
    [reportKeyId, channel, destination],
  );
  if (Number(activeCount) >= MAX_ACTIVE_OTPS) {
    throw httpError(
      429,
      "OTP_RATE_LIMITED",
      "Too many verification codes requested for this report. Please try again later.",
    );
  }

  const [[{ hourCount }]] = await db.query(
    `SELECT COUNT(*) AS hourCount FROM report_access_otps
     WHERE report_key = ? AND created_at > (NOW() - INTERVAL 1 HOUR)`,
    [reportKeyId],
  );
  if (Number(hourCount) >= MAX_OTP_PER_HOUR) {
    throw httpError(
      429,
      "OTP_RATE_LIMITED",
      "Too many verification code requests for this report. Please try again later.",
    );
  }

  const [recentRows] = await db.query(
    `SELECT created_at FROM report_access_otps
     WHERE report_key = ? AND channel = ? AND destination = ?
     ORDER BY id DESC LIMIT 1`,
    [reportKeyId, channel, destination],
  );
  if (recentRows.length > 0) {
    const createdMs = new Date(recentRows[0].created_at).getTime();
    const elapsedSec = Math.floor((Date.now() - createdMs) / 1000);
    if (elapsedSec < RESEND_COOLDOWN_SECONDS) {
      throw httpError(
        429,
        "OTP_COOLDOWN",
        "Please wait before requesting another verification code.",
        { retry_after_seconds: RESEND_COOLDOWN_SECONDS - elapsedSec },
      );
    }
  }

  // Rotate: expire any previous active OTP for the same report/channel/destination.
  await db.query(
    `UPDATE report_access_otps SET expires_at = NOW()
     WHERE report_key = ? AND channel = ? AND destination = ?
       AND verified_at IS NULL AND expires_at > NOW()`,
    [reportKeyId, channel, destination],
  );

  const otp = generateOtp();
  const otpHash = hashSecret(otp);
  const [insertRes] = await db.query(
    `INSERT INTO report_access_otps
       (report_key, result_id, channel, destination, parent_name, otp_hash, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL ${OTP_TTL_SECONDS} SECOND))`,
    [
      reportKeyId,
      resolved.access.result_id,
      channel,
      destination,
      parentName,
      otpHash,
    ],
  );

  if (deliveryMode() === "live") {
    try {
      const ttlMinutes = Math.round(OTP_TTL_SECONDS / 60);
      if (channel === "phone") {
        await sendSms(destination, otp);
      } else {
        await sendOtpEmail(
          destination,
          otp,
          parentName,
          resolved.student.name,
          ttlMinutes,
        );
      }
    } catch (deliveryErr) {
      await db.query("DELETE FROM report_access_otps WHERE id = ?", [
        insertRes.insertId,
      ]);
      console.error(
        "[REPORT-ACCESS] OTP delivery failed (code not logged):",
        deliveryErr.message,
      );
      throw httpError(
        502,
        "OTP_DELIVERY_FAILED",
        `The verification code could not be sent: ${deliveryErr.message}`,
      );
    }
  } else {
    console.log(
      "[REPORT-ACCESS] OTP delivery skipped (dry-run mode). Set REPORT_OTP_DELIVERY=live in server/.env to enable live delivery.",
    );
  }

  return {
    success: true,
    data: {
      expires_in: OTP_TTL_SECONDS,
      max_attempts: OTP_MAX_ATTEMPTS,
      resend_cooldown: RESEND_COOLDOWN_SECONDS,
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// OTP verification → short-lived report-scoped access grant
// ─────────────────────────────────────────────────────────────────────────────
async function verifyOtp(reportKey, payload = {}) {
  await ensureTables();
  const channel = String(payload.channel || "");
  if (channel !== "phone" && channel !== "email") {
    throw httpError(
      400,
      "INVALID_CHANNEL",
      "Channel must be 'phone' or 'email'",
    );
  }
  const otpClean = String(payload.otp || "").replace(/\D/g, "");
  if (!/^\d{6}$/.test(otpClean)) {
    throw httpError(400, "OTP_INVALID_FORMAT", "Enter the 6-digit code.");
  }

  const resolved = await resolveReport(reportKey);
  if (!resolved.ok) throw resolved;

  const [rows] = await db.query(
    `SELECT id, otp_hash, destination, attempts, expires_at,
            (expires_at < NOW()) AS is_expired
     FROM report_access_otps
     WHERE report_key = ? AND channel = ? AND verified_at IS NULL
     ORDER BY id DESC LIMIT 1`,
    [resolved.access.report_key, channel],
  );
  if (rows.length === 0) {
    throw httpError(
      404,
      "OTP_NOT_FOUND",
      "No verification code found for this channel. Please request a new one.",
    );
  }
  const otpRow = rows[0];

  if (Boolean(otpRow.is_expired)) {
    throw httpError(
      410,
      "OTP_EXPIRED",
      "This verification code has expired. Please request a new one.",
    );
  }
  if (otpRow.attempts >= OTP_MAX_ATTEMPTS) {
    throw httpError(
      429,
      "OTP_ATTEMPTS_EXCEEDED",
      "Too many incorrect attempts. Please request a new code.",
    );
  }

  if (!verifySecret(otpClean, otpRow.otp_hash)) {
    const nextAttempts = otpRow.attempts + 1;
    await db.query("UPDATE report_access_otps SET attempts = ? WHERE id = ?", [
      nextAttempts,
      otpRow.id,
    ]);
    if (nextAttempts >= OTP_MAX_ATTEMPTS) {
      throw httpError(
        429,
        "OTP_ATTEMPTS_EXCEEDED",
        "Too many incorrect attempts. Please request a new code.",
      );
    }
    throw httpError(401, "OTP_MISMATCH", "Incorrect code. Please try again.", {
      attempts_remaining: OTP_MAX_ATTEMPTS - nextAttempts,
    });
  }

  // Success: mark the OTP verified, mint a one-time-return access grant.
  await db.query(
    "UPDATE report_access_otps SET attempts = ?, verified_at = NOW() WHERE id = ?",
    [otpRow.attempts + 1, otpRow.id],
  );

  const token = generateAccessToken();
  await db.query(
    `INSERT INTO report_access_grants (report_key, result_id, token_hash, expires_at)
     VALUES (?, ?, ?, DATE_ADD(NOW(), INTERVAL ${GRANT_TTL_SECONDS} SECOND))`,
    [resolved.access.report_key, resolved.access.result_id, sha256Hex(token)],
  );

  // Only now update the existing access row (access_granted = 1, accessed_at).
  if (channel === "phone") {
    await db.query(
      `UPDATE fitness_test_report_access
       SET access_granted = 1, accessed_at = NOW(), parent_phone = ?
       WHERE report_key = ? AND result_id = ?`,
      [
        otpRow.destination,
        resolved.access.report_key,
        resolved.access.result_id,
      ],
    );
  } else {
    await db.query(
      `UPDATE fitness_test_report_access
       SET access_granted = 1, accessed_at = NOW()
       WHERE report_key = ? AND result_id = ?`,
      [resolved.access.report_key, resolved.access.result_id],
    );
  }

  return {
    success: true,
    data: {
      verified: true,
      access_token: token,
      report_key: resolved.access.report_key,
      result_id: resolved.access.result_id,
      token_expires_in: GRANT_TTL_SECONDS,
    },
  };
}

// Accepts the raw token and checks it is (a) valid, (b) unexpired, and
// (c) scoped to the EXACT report_key supplied — a token for one report can
// never authorize another. Returns the grant row details so callers can bind
// the grant to the authoritative result_id (Phase 4 data endpoint).
async function validateAccessToken(reportKey, token) {
  const key = String(reportKey || "").trim();
  const raw = String(token || "").trim();
  if (!key || !raw) return { valid: false };
  const [rows] = await db.query(
    `SELECT id, report_key, result_id, expires_at FROM report_access_grants
     WHERE report_key = ? AND token_hash = ? AND expires_at > NOW()
     LIMIT 1`,
    [key, sha256Hex(raw)],
  );
  if (rows.length === 0) return { valid: false };
  return {
    valid: true,
    grant_id: rows[0].id,
    report_key: rows[0].report_key,
    result_id: rows[0].result_id,
    expires_at: rows[0].expires_at,
  };
}

function httpError(status, code, message, extra) {
  const body = { success: false, code, message, ...(extra || {}) };
  const err = new Error(message);
  err.status = status;
  err.body = body;
  return err;
}

module.exports = {
  initTables,
  requestOtp,
  verifyOtp,
  validateAccessToken,
  resolveReport,
  // exposed for deterministic .verify tests only
  generateOtp,
  hashSecret,
  verifySecret,
  sha256Hex,
  generateAccessToken,
  normalizePhone,
  normalizeEmail,
  OTP_TTL_SECONDS,
  OTP_MAX_ATTEMPTS,
  RESEND_COOLDOWN_SECONDS,
  GRANT_TTL_SECONDS,
};
