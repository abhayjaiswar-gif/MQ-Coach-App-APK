const fs = require("fs");
const path = require("path");
const jwt = require("jsonwebtoken");
const dotenv = require("dotenv");

// Ensure JWT_SECRET is available even if this module is loaded standalone.
dotenv.config({ path: path.join(__dirname, "..", ".env") });

// One physical file for ALL users (no per-user files).
const DEFAULT_LOG_FILE = path.join(__dirname, "..", "..", "logs", "user-activity.log");

// Serialize every append so concurrent requests from multiple users can never
// interleave or overwrite each other's records in the single physical file.
let writeQueue = Promise.resolve();

function getLogFilePath() {
  return process.env.ACTIVITY_LOG_PATH || DEFAULT_LOG_FILE;
}

function pad(value) {
  return String(value).padStart(2, "0");
}

function formatDate(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function formatTime(date) {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

// Never allow pipes (field separator) or control characters into a record.
function sanitize(value) {
  if (value === null || value === undefined) return "";
  return String(value)
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\|/g, "/")
    .trim();
}

// Human-readable auditable block, one logical record spanning two lines:
//   YYYY-MM-DD | User: <name> | UserID: <id>
//   HH:mm:ss   | <page> | <action> | <type>
// Date, user and id sit on the header line; the event time, module, action
// summary and activity type on the body line.
function formatActivity(activity = {}) {
  const now = new Date();
  const header =
    `${formatDate(now)} | User: ${sanitize(activity.userName)} | ` +
    `UserID: ${sanitize(activity.userId)}`;
  const body =
    `${formatTime(now)} | ${sanitize(activity.page)} | ` +
    `${sanitize(activity.action)} | ${sanitize(activity.type)}`;
  return `${header}\n${body}`;
}

/**
 * Append an activity record to logs/user-activity.log.
 * The logs directory and file are created automatically when missing.
 * Existing records are never overwritten (append-only).
 * Returns a promise; file-system errors are surfaced via console.error
 * and never break subsequent writes.
 */
function logActivity(activity) {
  const record = formatActivity(activity);
  const targetFile = getLogFilePath();

  const pendingWrite = writeQueue.then(async () => {
    try {
      await fs.promises.mkdir(path.dirname(targetFile), { recursive: true });
      await fs.promises.appendFile(targetFile, `${record}\n\n`, "utf8");
    } catch (err) {
      console.error("[userActivityLogger] Failed to append activity record:", err);
    }
  });

  writeQueue = pendingWrite;
  return writeQueue;
}

/**
 * Resolve the authenticated user from the request's Bearer JWT.
 * User identity is always derived from server-side context (verified token
 * + database lookup), never blindly trusted from the frontend body/query.
 * Returns { userId, userName } or null when the request is unauthenticated.
 */
async function resolveUserFromRequest(req, db) {
  try {
    const activeDb = db || require("../db");

    // 1. Try Bearer JWT from Authorization header
    const header = req.headers && req.headers.authorization;
    const token =
      header && header.startsWith("Bearer ")
        ? header.slice("Bearer ".length).trim()
        : null;

    if (token) {
      const secret = process.env.JWT_SECRET;
      const payload = jwt.verify(token, secret);
      if (payload && payload.id) {
        const [rows] = await activeDb.query(
          "SELECT id, name FROM users WHERE id = ?",
          [payload.id],
        );
        if (rows && rows.length > 0) {
          return { userId: rows[0].id, userName: rows[0].name };
        }
      }
    }

    // 2. Fallback: Resolve user identity from req.body or req.query user_id
    let rawUserId = null;
    if (req) {
      if (req.body) {
        rawUserId = req.body.user_id || req.body.userId || req.body.user_Id;
      }
      if (!rawUserId && req.query) {
        rawUserId = req.query.user_id || req.query.userId || req.query.user_Id;
      }
    }

    if (rawUserId) {
      const parsedId = parseInt(rawUserId, 10);
      if (!isNaN(parsedId) && parsedId > 0) {
        const [rows] = await activeDb.query(
          "SELECT id, name FROM users WHERE id = ?",
          [parsedId],
        );
        if (rows && rows.length > 0) {
          return { userId: rows[0].id, userName: rows[0].name };
        }
      }
    }

    return null;
  } catch (err) {
    return null;
  }
}

/**
 * Universal auditAction helper. Never throws or breaks business operations.
 * Identity is resolved server-side from the verified JWT.
 */
async function auditAction(req, args, db) {
  try {
    const resolved = typeof args === "function" ? args() : args || {};
    const { page, type, action, entity } = resolved || {};
    const actor = await resolveUserFromRequest(req, db);
    if (!actor) return;
    let finalAction = String(action || "");
    if (
      entity &&
      entity.id !== null &&
      entity.id !== undefined &&
      !finalAction.includes(String(entity.id))
    ) {
      finalAction += ` (${entity.type || "ID"}: ${entity.id})`;
    }
    await logActivity({
      userId: actor.userId,
      userName: actor.userName,
      page: String(page || "Application"),
      action: finalAction,
      type: String(type || "ACTION"),
    });
  } catch (err) {
    console.error(
      "[AUDIT] Activity event skipped (business logic unaffected):",
      err,
    );
  }
}

module.exports = {
  logActivity,
  resolveUserFromRequest,
  auditAction,
  getLogFilePath,
  formatActivity,
};