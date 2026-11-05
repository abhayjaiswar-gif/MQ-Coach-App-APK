/**
 * AUTO-GENERATED from MQ-Coach-App/server/index.js
 * Regenerate: node tools/build_legacy.js
 */
module.exports = function mountLegacy(app, ctx) {
  var UPLOADS_DIR = ctx.UPLOADS_DIR;
  var PDF_TEMP_DIR = ctx.PDF_TEMP_DIR;
  process.env.PDF_TEMP_DIR = PDF_TEMP_DIR;


const jwt = require("jsonwebtoken");
const bcrypt = require("bcrypt");
const crypto = require("crypto");

const multer = require("multer");
const xlsx = require("xlsx");
const path = require("path");
const fs = require("fs");
const QRCode = require("qrcode");
const {
  PDFDocument,
  PDFString,
  rgb,
  StandardFonts,
  degrees,
  PageSizes,
} = require("pdf-lib");
const archiver = require("archiver");

const { GoogleGenAI } = require("@google/genai");
const db = require('../db');
const {
  logActivity,
  resolveUserFromRequest,
  getLogFilePath,
} = require('../services/userActivityLogger.cjs');
const {
  normGradeName,
  gradeRank,
  levelLabel,
  isUsableLevel,
  getLevelProgress,
  ensureLevelProgress,
  setLevelProgress,
  getOrderedLevels,
  getNextLevel,
  ensureProgressRowsForSchool,
} = require('../curriculumLevelResolver');

// Fail-secure: the JWT signing secret MUST come from environment configuration.
// A hardcoded fallback must never silently weaken a production deployment.
if (
  !process.env.JWT_SECRET ||
  typeof process.env.JWT_SECRET !== "string" ||
  process.env.JWT_SECRET.length < 32
) {
  throw new Error(
    "JWT_SECRET must be configured in server/.env (at least 32 characters). " +
    "Generate one with: node -e \"console.log(require('crypto').randomBytes(48).toString('hex'))\"",
  );
}
const JWT_SIGNING_SECRET = process.env.JWT_SECRET;

// ─────────────────────────────────────────────────────────────────────────────
// Generic SUCCESS-ONLY business-action auditor.
//
// Any module can emit a specific, human-readable audit event after its real
// backend operation succeeds by calling:
//
//   await auditAction(req, {
//     page: "AOP Tracking",      // page/module label (same as VIEW label)
//     type: "FINALIZE",          // standardized activity type
//     action: `Finalized AOP "${aopName}"`,  // specific human-readable event
//     entity: { type: "AOP", id: aopId },    // optional identifying info
//   });
//
// For extra safety when building the event from dynamic application data, a
// thunk may be passed instead of the object — it is evaluated INSIDE the
// audit boundary so any evaluation error is swallowed and can never surface
// into the business operation:
//
//   await auditAction(req, () => ({
//     page: "AOP Tracking",
//     type: "FINALIZE",
//     action: `Finalized AOP "${aop.name}"`,  // safe even if aop is null
//   }));
//
// Identity is always resolved server-side from the verified Bearer JWT (never
// from frontend-supplied ids). Entity ids are appended to the event when they
// are not already embedded in the action text. THIS FUNCTION NEVER THROWS and
// never rejects: a logging failure can never change the business response.
async function auditAction(req, args) {
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

// Shared standard → std_code mapping (matches ParametersPage.vue / fill-marks logic)
function getStdCodeFromValue(stdVal) {
  if (!stdVal) return 0;
  const clean = String(stdVal).trim().toLowerCase();
  if (clean === "nursery") return 1;
  if (clean.includes("junior") || clean.includes("jr") || clean === "jkg")
    return 2;
  if (clean.includes("senior") || clean.includes("sr") || clean === "skg")
    return 13;

  const romanOrNumericMap = {
    i: 3,
    1: 3,
    "1st": 3,
    ii: 4,
    2: 4,
    "2nd": 4,
    iii: 5,
    3: 5,
    "3rd": 5,
    iv: 6,
    4: 6,
    "4th": 6,
    v: 7,
    5: 7,
    "5th": 7,
    vi: 8,
    6: 8,
    "6th": 8,
    vii: 9,
    7: 9,
    "7th": 9,
    viii: 10,
    8: 10,
    "8th": 10,
    ix: 11,
    9: 11,
    "9th": 11,
    x: 12,
    10: 12,
    "10th": 12,
  };
  if (romanOrNumericMap[clean]) return romanOrNumericMap[clean];
  const match = clean.match(/\d+/);
  if (match) {
    const num = parseInt(match[0]);
    if (num >= 1 && num <= 10) return num + 2;
  }
  return parseInt(stdVal) || 0;
}

function getGradeStd(stdVal) {
  if (!stdVal) return "0";
  const clean = String(stdVal).trim().toLowerCase();
  if (clean === "nursery" || clean === "-3") return "-3";
  if (clean.includes("jr") || clean.includes("junior") || clean === "-2") return "-2";
  if (clean.includes("sr") || clean.includes("senior") || clean === "-1") return "-1";
  const romanMap = {
    i: "1", "1st": "1",
    ii: "2", "2nd": "2",
    iii: "3", "3rd": "3",
    iv: "4", "4th": "4",
    v: "5", "5th": "5",
    vi: "6", "6th": "6",
    vii: "7", "7th": "7",
    viii: "8", "8th": "8",
    ix: "9", "9th": "9",
    x: "10", "10th": "10",
    xi: "11", "11th": "11",
    xii: "12", "12th": "12",
  };
  if (romanMap[clean]) return romanMap[clean];
  const match = clean.match(/\d+/);
  if (match) return match[0];
  return clean;
}

// Database auto-migrations
(async () => {
  try {
    // 1. Auto-create sports_teams table
    await db.query(`
      CREATE TABLE IF NOT EXISTS sports_teams (
        id INT(11) AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        sport VARCHAR(100),
        school_id INT(11),
        coach_id INT(11),
        status VARCHAR(50) DEFAULT 'Preparation',
        description TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `);

    // 2. Auto-create sports_team_players table
    await db.query(`
      CREATE TABLE IF NOT EXISTS sports_team_players (
        id INT(11) AUTO_INCREMENT PRIMARY KEY,
        team_id INT(11),
        student_id INT(11),
        assigned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    // Fix existing tables that may be missing AUTO_INCREMENT on id
    try {
      await db.query(`ALTER TABLE sports_team_players MODIFY COLUMN id INT(11) NOT NULL AUTO_INCREMENT`);
    } catch (alterErr) { /* already correct, ignore */ }

    // 3. Auto-create sports_team_attendance table
    await db.query(`
      CREATE TABLE IF NOT EXISTS sports_team_attendance (
        id INT(11) AUTO_INCREMENT PRIMARY KEY,
        team_id INT(11) NOT NULL,
        student_id INT(11) NOT NULL,
        attendance_date DATE NOT NULL,
        status ENUM('present', 'absent', 'late') DEFAULT 'present',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY unique_attendance (team_id, student_id, attendance_date)
      )
    `);

    // 4. Auto-create team_attendance table
    await db.query(`
      CREATE TABLE IF NOT EXISTS team_attendance (
        id INT(11) AUTO_INCREMENT PRIMARY KEY,
        team_id INT(11) NOT NULL,
        student_id INT(11) NOT NULL,
        attendance_date DATE NOT NULL,
        status ENUM('present', 'absent', 'late') DEFAULT 'present',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY unique_attendance (team_id, student_id, attendance_date)
      )
    `);

    // Auto-create student_attendance table
    await db.query(`
      CREATE TABLE IF NOT EXISTS student_attendance (
        id INT AUTO_INCREMENT PRIMARY KEY,
        mq_id VARCHAR(100) DEFAULT NULL,
        student_name VARCHAR(255) NOT NULL,
        standard VARCHAR(50) NOT NULL,
        division VARCHAR(50) NOT NULL,
        school_name VARCHAR(255) NOT NULL,
        attendance_date DATE NOT NULL,
        status ENUM('present', 'absent') NOT NULL,
        uploaded_by INT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY unique_student_attendance (mq_id, student_name, standard, division, school_name, attendance_date)
      )
    `);

    // Migration: add mq_id column if missing
    try {
      const [cols] = await db.query("DESCRIBE student_attendance");
      const hasMqId = cols.some((c) => c.Field === "mq_id");
      if (!hasMqId) {
        await db.query(
          "ALTER TABLE student_attendance ADD COLUMN mq_id VARCHAR(100) DEFAULT NULL AFTER id",
        );
        console.log("Added mq_id column to student_attendance");
      }
    } catch (migErr) {
      console.error("student_attendance mq_id migration note:", migErr.message);
    }

    // Migration: fix unique key to include student identifiers
    try {
      const [keys] = await db.query(
        "SHOW KEYS FROM student_attendance WHERE Key_name = 'unique_student_attendance'",
      );
      if (keys.length > 0) {
        const keyColumns = keys.map((k) => k.Column_name);
        const correctColumns = [
          "mq_id",
          "student_name",
          "standard",
          "division",
          "school_name",
          "attendance_date",
        ];
        const isCorrect = correctColumns.every((c) => keyColumns.includes(c));
        if (!isCorrect) {
          console.log(
            "Migrating student_attendance unique key to include mq_id + student_name...",
          );
          await db.query(
            "ALTER TABLE student_attendance DROP INDEX unique_student_attendance",
          );
          await db.query(
            "ALTER TABLE student_attendance ADD UNIQUE KEY unique_student_attendance (mq_id, student_name, standard, division, school_name, attendance_date)",
          );
          console.log("student_attendance unique key migrated successfully");
        }
      }
    } catch (migErr) {
      console.error("student_attendance migration error:", migErr.message);
    }

    const [columns] = await db.query("DESCRIBE parameter_grades");
    const hasGender = columns.some((col) => col.Field === "gender");
    if (!hasGender) {
      console.log("Adding gender column to parameter_grades table...");
      await db.query(
        "ALTER TABLE parameter_grades ADD COLUMN gender VARCHAR(50) DEFAULT 'All' AFTER std",
      );
      console.log("gender column added successfully!");
    }
    const hasTestDisplay = columns.some((col) => col.Field === "test_display");
    if (!hasTestDisplay) {
      console.log("Adding test_display column to parameter_grades table...");
      await db.query(
        "ALTER TABLE parameter_grades ADD COLUMN test_display VARCHAR(255) DEFAULT '' AFTER parameter",
      );
      console.log("test_display column added successfully!");
    }

    // AFNAN HEADCOACH QUERY
    // Auto-add head_coach_email column to schools table
    const [schoolColumns] = await db.query("DESCRIBE schools");
    const hasHeadCoachEmail = schoolColumns.some(
      (col) => col.Field === "head_coach_email",
    );
    if (!hasHeadCoachEmail) {
      console.log("Adding head_coach_email column to schools table...");
      await db.query(
        "ALTER TABLE schools ADD COLUMN head_coach_email VARCHAR(255) NULL AFTER phone",
      );
      console.log("head_coach_email column added successfully!");
    }

    // Auto-create visit_planner table (SSGM School Visit Planner)
    await db.query(`
      CREATE TABLE IF NOT EXISTS visit_planner (
        id INT AUTO_INCREMENT PRIMARY KEY,
        school_id INT NOT NULL,
        school_name VARCHAR(255),
        user_id INT DEFAULT NULL,
        visit_date DATE DEFAULT NULL,
        planned_arrival_time VARCHAR(50) DEFAULT NULL,
        to_date DATE DEFAULT NULL,
        to_time VARCHAR(50) DEFAULT NULL,
        travel_from_date DATE DEFAULT NULL,
        travel_from_time VARCHAR(50) DEFAULT NULL,
        travel_to_date DATE DEFAULT NULL,
        travel_to_time VARCHAR(50) DEFAULT NULL,
        purpose VARCHAR(500) DEFAULT NULL,
        additional_notes TEXT,
        duration VARCHAR(20) DEFAULT NULL,
        is_travelling VARCHAR(3) NOT NULL DEFAULT 'no',
        status ENUM('preplanned', 'in_progress', 'completed', 'cancelled') DEFAULT 'preplanned',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        KEY idx_school (school_id),
        KEY idx_status (status),
        KEY idx_user (user_id)
      )
    `);
    console.log("visit_planner table ensured.");

    // Auto-create pre_weekly_planner_credentials table
    await initPreWeeklyPlannerCredentialsTables();

    // Auto-create fitness-report OTP + access-grant tables (Phase 3)
    await reportAccessOtp.initTables();
  } catch (err) {
    console.error("Error during auto-migration:", err);
  }
})();
const gcsService = require('../googleCloudService');
const emailService = require('../emailService');
const reportAccessOtp = require('../services/reportAccessOtp.cjs');
const reportCardData = require('../services/reportCardData.cjs');
const admin = { initializeApp(){}, credential:{ cert(){return null;} }, messaging:{ send(){return Promise.resolve();} } };
const { getConfig } = require('../curriculumConfig');
const CurriculumService = require('../curriculumService');

// 🔑 FIREBASE ADMIN INITIALIZATION
const serviceAccountPath = path.join(__dirname, '..', 'serviceAccountKey.json');
if (fs.existsSync(serviceAccountPath)) {
  const serviceAccount = require(serviceAccountPath);
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
  console.log("🔥 Firebase Admin initialized successfully");
} else {
  console.warn(
    "⚠️ Firebase serviceAccountKey.json not found. Push notifications will be disabled.",
  );
}

const sendPushNotification = async (userIds, title, body, data = {}) => {
  try {
    if (!admin.apps.length) return;

    const recipientIds = Array.isArray(userIds) ? userIds : [userIds];
    if (recipientIds.length === 0) return;

    // 1. Log notifications to database for history
    for (const rid of recipientIds) {
      await db
        .query(
          "INSERT INTO notifications (title, message, user_id, created_at) VALUES (?, ?, ?, NOW())",
          [title, body, rid],
        )
        .catch((err) => console.error("LOG NOTIFICATION ERROR:", err));
    }

    // 2. Get tokens for these users
    const [rows] = await db.query(
      "SELECT token FROM user_fcm_tokens WHERE user_id IN (?)",
      [recipientIds],
    );
    const tokens = rows.map((r) => r.token);

    if (tokens.length === 0) return;

    const message = {
      notification: { title, body },
      webpush: {
        notification: {
          icon: "https://app.marcosquay.com/app/M%26Q.png",
          sound: "default",
        },
      },
      data: { ...data, click_action: "FLUTTER_NOTIFICATION_CLICK" },
      tokens: tokens,
    };

    const response = await admin.messaging().sendEachForMulticast(message);
    console.log(
      `✅ Push notifications sent: ${response.successCount} success, ${response.failureCount} failure`,
    );
  } catch (err) {
    console.error("❌ PUSH NOTIFICATION ERROR:", err);
  }
};

function wrapText(text, maxW, font, fontSize) {
  const words = text.split(/\s+/);
  const lines = [];
  let currentLine = words[0];

  for (let i = 1; i < words.length; i++) {
    const word = words[i];
    const width = font.widthOfTextAtSize(currentLine + " " + word, fontSize);
    if (width < maxW) {
      currentLine += " " + word;
    } else {
      lines.push(currentLine);
      currentLine = word;
    }
  }
  lines.push(currentLine);
  return lines;
}

// ── GET OR CREATE REPORT KEY (Matched to Legacy PHP Logic) ──
async function getOrCreateReportKey(resultId, db) {
  try {
    // 1. Check if table exists
    const [tables] = await db.query(
      "SHOW TABLES LIKE 'fitness_test_report_access'",
    );
    if (tables.length === 0) {
      console.log(
        `[PDF] Table 'fitness_test_report_access' missing, using simple fallback`,
      );
      return `fitness-${resultId}B${Math.floor(Date.now() / 1000)}`;
    }

    // 2. Already exists?
    const [existing] = await db.query(
      "SELECT report_key FROM fitness_test_report_access WHERE result_id = ?",
      [resultId],
    );
    if (existing.length > 0 && existing[0].report_key) {
      return existing[0].report_key;
    }

    // 3. Not found, create new one based on result details
    const [[result]] = await db.query(
      `
      SELECT ftr.*, s.name as student_name, s.std, s.division 
      FROM fitness_test_results ftr 
      JOIN students s ON ftr.student_id = s.id 
      WHERE ftr.id = ?
    `,
      [resultId],
    );

    if (!result) return `fitness-${resultId}B${Math.floor(Date.now() / 1000)}`;

    // 4. Mimic generateUniqueReportKey hashing logic
    // $base_string = $result->id . '-' . $result->student_id . '-' . $result->format_id . '-' . $result->academic_year . '-' . $result->term;
    // $hash = md5($base_string . time() . rand(1000, 9999));
    // return substr($hash, 0, 12) . 'B' . $result->id;
    const baseString = `${result.id}-${result.student_id}-${result.format_id}-${result.academic_year}-${result.term}`;
    const randPart = Math.floor(Math.random() * 9000) + 1000;
    const hashData = baseString + Math.floor(Date.now() / 1000) + randPart;
    const hash = crypto.createHash("md5").update(hashData).digest("hex");
    const reportKey = hash.substring(0, 12) + "B" + result.id;

    // 5. Insert
    await db.query(
      "INSERT INTO fitness_test_report_access (result_id, report_key, created_at) VALUES (?, ?, NOW())",
      [resultId, reportKey],
    );
    return reportKey;
  } catch (err) {
    console.error("[PDF] Error in getOrCreateReportKey:", err);
    return `fitness-${resultId}B${Math.floor(Date.now() / 1000)}`;
  }
}

// 📊 INITIALIZE GRADING SCALES TABLE
const initGradingTable = async () => {
  try {
    await db.query(`
            CREATE TABLE IF NOT EXISTS grading_scales (
                id INT AUTO_INCREMENT PRIMARY KEY,
                name VARCHAR(50) NOT NULL,
                min_percent INT NOT NULL,
                max_percent INT NOT NULL,
                descriptor TEXT,
                icon VARCHAR(50),
                color VARCHAR(20),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
            )
        `);

    const [rows] = await db.query(
      "SELECT COUNT(*) as count FROM grading_scales",
    );
    if (rows[0].count === 0) {
      await db.query(`
                INSERT INTO grading_scales (name, min_percent, max_percent, descriptor, icon, color) VALUES
                ('Excellent', 90, 100, 'Consistently exceeds academic expectations, demonstrates advanced critical thinking, and shows leadership in collaborative tasks.', 'verified', 'green'),
                ('Good', 75, 89, 'Meets all academic requirements effectively, participates actively in class discussions, and shows steady improvement.', 'thumb_up', 'blue'),
                ('Developing', 50, 74, 'Demonstrates partial understanding of concepts, requires occasional support to complete tasks, but showing potential.', 'trending_up', 'amber'),
                ('Needs Improvement', 0, 49, 'Struggles to meet core requirements, requires significant intervention and scaffolded support to achieve learning outcomes.', 'warning', 'red')
            `);
    }
  } catch (err) {
    console.error("INIT GRADING TABLE ERROR:", err);
  }
};
initGradingTable();

// 📊 INITIALIZE CURRICULUM STATUS TABLES
const initLPStatusTables = async () => {
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS lp_status (
        id INT AUTO_INCREMENT PRIMARY KEY,
        lp_no VARCHAR(50),
        lp_unique_id VARCHAR(100) NOT NULL,
        user_id INT NOT NULL,
        school_id INT,
        status ENUM('Done', 'Pending') NOT NULL,
        remark TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY user_lp (user_id, lp_unique_id)
      )
    `);
    await db.query(`
      CREATE TABLE IF NOT EXISTS lp_status_photos (
        id INT AUTO_INCREMENT PRIMARY KEY,
        lp_status_id INT NOT NULL,
        photo_path VARCHAR(255) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (lp_status_id) REFERENCES lp_status(id) ON DELETE CASCADE
      )
    `);
    await db.query(`
      CREATE TABLE IF NOT EXISTS dashboard_highlights (
        id INT AUTO_INCREMENT PRIMARY KEY,
        tagline VARCHAR(100),
        title VARCHAR(200) NOT NULL,
        subtitle VARCHAR(200),
        image_path VARCHAR(255) NOT NULL,
        category VARCHAR(50) DEFAULT 'Event',
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
  } catch (err) {
    console.error("INIT LP STATUS TABLES ERROR:", err);
  }
};
initLPStatusTables();

// 🏆 INITIALIZE SCHOOL ACHIEVEMENTS TABLE
const initAchievementTables = async () => {
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS school_achievements (
        id INT AUTO_INCREMENT PRIMARY KEY,
        title VARCHAR(255) NOT NULL,
        description TEXT,
        media_json TEXT,
        created_by INT DEFAULT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    try {
      await db.query(
        "ALTER TABLE school_achievements ADD COLUMN school_id INT DEFAULT NULL",
      );
    } catch (alterErr) {
      // school_id column already exists
    }
    console.log("✅ school_achievements table ready");
  } catch (err) {
    console.error("INIT ACHIEVEMENTS TABLE ERROR:", err);
  }
};
initAchievementTables();

// 📊 INITIALIZE SDP CURRICULUM TABLES
const initSDPTables = async () => {
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS sdp_lp_master (
        id INT AUTO_INCREMENT PRIMARY KEY,
        grade VARCHAR(50),
        sport VARCHAR(255),
        under_group VARCHAR(255),
        lp_no VARCHAR(50),
        skill TEXT,
        sub_skill TEXT,
        objective TEXT,
        teaching_aids TEXT,
        warm_up TEXT,
        skill_implementation TEXT,
        picture TEXT,
        cool_down TEXT,
        summarization TEXT,
        life_skill TEXT,
        lp_unique_id VARCHAR(100),
        id_indicate_curriculum INT,
        smart_start_status TINYINT DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_curriculum (id_indicate_curriculum),
        INDEX idx_sport (sport)
      )
    `);
    console.log("✅ sdp_lp_master table ready");
  } catch (err) {
    console.error("INIT SDP TABLES ERROR:", err);
  }
};
initSDPTables();

// 📊 INITIALIZE MSFC CURRICULUM TABLES
const initMSFCTables = async () => {
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS msfc_lp_master (
        id INT AUTO_INCREMENT PRIMARY KEY,
        grade VARCHAR(50),
        sport VARCHAR(255),
        under_group VARCHAR(255),
        lp_no VARCHAR(50),
        skill TEXT,
        sub_skill TEXT,
        objective TEXT,
        teaching_aids TEXT,
        warm_up TEXT,
        skill_implementation TEXT,
        picture TEXT,
        cool_down TEXT,
        summarization TEXT,
        life_skill TEXT,
        lp_unique_id VARCHAR(100),
        id_indicate_curriculum INT,
        smart_start_status TINYINT DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_curriculum (id_indicate_curriculum),
        INDEX idx_sport (sport)
      )
    `);
    console.log("✅ msfc_lp_master table ready");
  } catch (err) {
    console.error("INIT MSFC TABLES ERROR:", err);
  }
};
initMSFCTables();

const WEEKLY_REPORT_MONTH_MAP = {
  jan: "Jan",
  feb: "Feb",
  mar: "Mar",
  apr: "Apr",
  may: "May",
  jun: "Jun",
  jul: "Jul",
  aug: "Aug",
  sep: "Sep",
  oct: "Oct",
  nov: "Nov",
  dec: "Dec",
};

const normalizeWeeklyReportMonthYear = (value) => {
  if (!value) return null;

  const rawValue = String(value).trim();
  if (!rawValue) return null;

  const parts = rawValue.split(/[\s,.-]+/).filter(Boolean);
  if (parts.length < 2) return rawValue;

  const monthToken = parts[0].slice(0, 3).toLowerCase();
  const yearToken = parts[parts.length - 1];
  const normalizedMonth = WEEKLY_REPORT_MONTH_MAP[monthToken];

  if (!normalizedMonth || !/^\d{4}$/.test(yearToken)) {
    return rawValue;
  }

  return `${normalizedMonth},${yearToken}`;
};

const normalizeWeeklyReportWeek = (value) => {
  if (!value) return null;

  const rawValue = String(value).trim();
  if (!rawValue) return null;

  const weekValue = rawValue.replace(/^week\s*/i, "").trim();
  if (!weekValue) return null;

  return `Week ${weekValue}`;
};

const resolveWeeklyReportIdentity = ({
  school_id,
  user_id,
  month_year,
  week_no,
  week,
}) => {
  const normalizedSchoolId = Number(school_id);
  const normalizedUserId = Number(user_id);
  const normalizedMonthYear = normalizeWeeklyReportMonthYear(month_year);
  const normalizedWeekNo = normalizeWeeklyReportWeek(week_no || week);

  if (
    !Number.isFinite(normalizedSchoolId) ||
    normalizedSchoolId <= 0 ||
    !Number.isFinite(normalizedUserId) ||
    normalizedUserId <= 0 ||
    !normalizedMonthYear ||
    !normalizedWeekNo
  ) {
    return null;
  }

  return {
    school_id: normalizedSchoolId,
    user_id: normalizedUserId,
    month_year: normalizedMonthYear,
    week_no: normalizedWeekNo,
  };
};

const buildWeeklyReportStatusKey = ({ month_year, week_no, week }) => {
  const normalizedMonthYear = normalizeWeeklyReportMonthYear(month_year);
  const normalizedWeekNo = normalizeWeeklyReportWeek(week_no || week);

  if (!normalizedMonthYear || !normalizedWeekNo) return null;
  return `${normalizedMonthYear}__${normalizedWeekNo}`;
};

// Reuses the exact calendar-week fallback from WeeklyReportPage.vue's isCurrentWeek(),
// so the Dashboard and the Weekly Report cannot disagree about the current period.
const WEEKLY_REPORT_MONTHS_SHORT = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

const getCurrentWeeklyReportPeriod = () => {
  const now = new Date();
  const month_year = `${WEEKLY_REPORT_MONTHS_SHORT[now.getMonth()]},${now.getFullYear()}`;
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const day = now.getDate();
  const weekNum = Math.min(
    5,
    Math.max(1, Math.ceil((day + startOfMonth.getDay()) / 7)),
  );
  return { month_year, week_no: `Week ${weekNum}` };
};

const initWeeklyReportStatusTable = async () => {
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS weekly_report_status (
        id INT AUTO_INCREMENT PRIMARY KEY,
        school_id INT NOT NULL,
        user_id INT NOT NULL,
        month_year VARCHAR(50) NOT NULL,
        week_no VARCHAR(50) NOT NULL,
        started_at TIMESTAMP NULL DEFAULT NULL,
        submitted_at TIMESTAMP NULL DEFAULT NULL,
        published_at TIMESTAMP NULL DEFAULT NULL,
        status VARCHAR(50) DEFAULT 'started',
        recipient_email VARCHAR(255) NULL,
        UNIQUE KEY unique_weekly_report_status (school_id, user_id, month_year, week_no)
      )
    `);
    // Ensure recipient_email column exists if table already existed
    try {
      await db.query(
        `ALTER TABLE weekly_report_status ADD COLUMN recipient_email VARCHAR(255) NULL`,
      );
    } catch (colErr) {
      // Column may already exist, safe to ignore
    }
  } catch (err) {
    console.error("INIT WEEKLY REPORT STATUS TABLE ERROR:", err);
  }
};
initWeeklyReportStatusTable();

const fetchWeeklyReportStatus = async (payload) => {
  const identity = resolveWeeklyReportIdentity(payload);
  if (!identity) return null;

  const [rows] = await db.query(
    `
      SELECT id, school_id, user_id, month_year, week_no, started_at, submitted_at, published_at, status, recipient_email
      FROM weekly_report_status
      WHERE school_id = ? AND user_id = ? AND month_year = ? AND week_no = ?
      LIMIT 1
    `,
    [
      identity.school_id,
      identity.user_id,
      identity.month_year,
      identity.week_no,
    ],
  );

  return rows[0] || null;
};

const ensureWeeklyReportStarted = async (payload) => {
  const identity = resolveWeeklyReportIdentity(payload);
  if (!identity) return null;

  await db.query(
    `
      INSERT INTO weekly_report_status (school_id, user_id, month_year, week_no, started_at, status)
      VALUES (?, ?, ?, ?, NOW(), 'started')
      ON DUPLICATE KEY UPDATE
        started_at = COALESCE(started_at, NOW())
    `,
    [
      identity.school_id,
      identity.user_id,
      identity.month_year,
      identity.week_no,
    ],
  );

  return fetchWeeklyReportStatus(identity);
};

const markWeeklyReportSubmitted = async (payload) => {
  const identity = resolveWeeklyReportIdentity(payload);
  if (!identity) return null;

  await db.query(
    `
      INSERT INTO weekly_report_status (school_id, user_id, month_year, week_no, submitted_at, status)
      VALUES (?, ?, ?, ?, NOW(), 'submitted')
      ON DUPLICATE KEY UPDATE
        submitted_at = COALESCE(submitted_at, NOW()),
        status = CASE WHEN status = 'published' THEN 'published' ELSE 'submitted' END
    `,
    [
      identity.school_id,
      identity.user_id,
      identity.month_year,
      identity.week_no,
    ],
  );

  const row = await fetchWeeklyReportStatus(identity);
  console.log("[DEBUG] Weekly Report Submitted:", row);
  return row;
};

const markWeeklyReportPublished = async (payload) => {
  const identity = resolveWeeklyReportIdentity(payload);
  if (!identity) return null;
  const recipientEmail = payload.recipient_email || payload.email || null;

  await db.query(
    `
      INSERT INTO weekly_report_status (school_id, user_id, month_year, week_no, published_at, status, recipient_email)
      VALUES (?, ?, ?, ?, NOW(), 'published', ?)
      ON DUPLICATE KEY UPDATE
        published_at = COALESCE(published_at, NOW()),
        status = 'published',
        recipient_email = COALESCE(VALUES(recipient_email), recipient_email)
    `,
    [
      identity.school_id,
      identity.user_id,
      identity.month_year,
      identity.week_no,
      recipientEmail,
    ],
  );

  const row = await fetchWeeklyReportStatus(identity);
  console.log("[DEBUG] Weekly Report Published:", row);
  return row;
};
// 🛡️ INITIALIZE USER PAGE ACCESS TABLE
const initUserPageAccessTable = async () => {
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS user_page_access (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        route_path VARCHAR(255) NOT NULL,
        is_granted BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY user_route (user_id, route_path),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);
  } catch (err) {
    console.error("INIT USER PAGE ACCESS TABLE ERROR:", err);
  }
};
initUserPageAccessTable();

// 🛡️ INITIALIZE ROLE PAGE ACCESS TABLE
const initRolePageAccessTable = async () => {
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS role_page_access (
        id INT AUTO_INCREMENT PRIMARY KEY,
        role_id INT NOT NULL,
        route_path VARCHAR(255) NOT NULL,
        is_granted BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY role_route (role_id, route_path),
        FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE
      )
    `);
  } catch (err) {
    console.error("INIT ROLE PAGE ACCESS TABLE ERROR:", err);
  }
};
initRolePageAccessTable();

// Seed student attendance permission for coach roles
const seedStudentAttendancePermission = async () => {
  try {
    await db.query(`
      INSERT IGNORE INTO role_page_access (role_id, route_path, is_granted)
      VALUES (4, '/student/attendance', 1), (5, '/student/attendance', 1)
    `);
  } catch (err) {
    console.error("SEED STUDENT ATTENDANCE PERMISSION ERROR:", err);
  }
};
seedStudentAttendancePermission();

// Seed SSGM visit planner permission (role 3 = SSGM)
const seedVisitPlannerPermission = async () => {
  try {
    await db.query(`
      INSERT IGNORE INTO role_page_access (role_id, route_path, is_granted)
      VALUES (3, '/management/visit-planner', 1), (3, '/management/last-visited-tracking', 1), (1, '/management/visit-planner', 1)
    `);
  } catch (err) {
    console.error("SEED VISIT PLANNER PERMISSION ERROR:", err);
  }
};
seedVisitPlannerPermission();

// 🛡️ MIGRATE MONTH_YEAR FORMATS FOR EXTRA ACTIVITIES
const migrateExtraActivityMonthYear = async () => {
  try {
    // 1. Replace spaces with hyphens in month_year
    await db.query(`
      UPDATE coach_lesson_tracking 
      SET month_year = REPLACE(month_year, ' ', '-')
      WHERE month_year LIKE '% %'
    `);
    await db.query(`
      UPDATE weekly_report_status 
      SET month_year = REPLACE(month_year, ' ', '-')
      WHERE month_year LIKE '% %'
    `);

    // 2. Abbreviate full month names to 3-letter abbreviation
    const months = [
      { full: "January", short: "Jan" },
      { full: "February", short: "Feb" },
      { full: "March", short: "Mar" },
      { full: "April", short: "Apr" },
      { full: "June", short: "Jun" },
      { full: "July", short: "Jul" },
      { full: "August", short: "Aug" },
      { full: "September", short: "Sep" },
      { full: "October", short: "Oct" },
      { full: "November", short: "Nov" },
      { full: "December", short: "Dec" },
    ];

    for (const m of months) {
      await db.query(
        `
        UPDATE coach_lesson_tracking
        SET month_year = REPLACE(month_year, ?, ?)
        WHERE month_year LIKE ?
      `,
        [m.full, m.short, `${m.full}%`],
      );
      await db.query(
        `
        UPDATE weekly_report_status
        SET month_year = REPLACE(month_year, ?, ?)
        WHERE month_year LIKE ?
      `,
        [m.full, m.short, `${m.full}%`],
      );
    }

    console.log(
      "✅ Database migration: month_year formats aligned to MMM-YYYY.",
    );
  } catch (err) {
    console.error("MIGRATION ERROR FOR MONTH_YEAR FORMATS:", err);
  }
};
migrateExtraActivityMonthYear();

// 📺 INITIALIZE DASHBOARD SOCIAL CONTENT SCHEMA
const initSocialContentTable = async () => {
  try {
    // Create table if it doesn't exist (includes all columns from the start)
    await db.query(`
      CREATE TABLE IF NOT EXISTS dashboard_social_content (
        id INT AUTO_INCREMENT PRIMARY KEY,
        platform VARCHAR(100),
        title VARCHAR(255),
        url VARCHAR(500),
        video_path VARCHAR(255) DEFAULT NULL,
        school_id INT DEFAULT NULL,
        thumbnail VARCHAR(255),
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Migrate: add video_path if missing (for existing deployments)
    const [cols] = await db.query(
      `SHOW COLUMNS FROM dashboard_social_content LIKE 'video_path'`,
    );
    if (cols.length === 0) {
      await db.query(
        `ALTER TABLE dashboard_social_content ADD COLUMN video_path VARCHAR(255) AFTER url`,
      );
      console.log("✅ Added video_path to dashboard_social_content");
    }

    // Migrate: add school_id if missing (for existing deployments)
    const [schoolCols] = await db.query(
      `SHOW COLUMNS FROM dashboard_social_content LIKE 'school_id'`,
    );
    if (schoolCols.length === 0) {
      await db.query(
        `ALTER TABLE dashboard_social_content ADD COLUMN school_id INT DEFAULT NULL`,
      );
      console.log("✅ Added school_id to dashboard_social_content");
    }

    console.log("✅ Dashboard Social Content table initialized");
  } catch (err) {
    console.error("INIT SOCIAL CONTENT TABLE ERROR:", err);
  }
};
initSocialContentTable();

// 📅 INITIALIZE DASHBOARD EVENTS SCHEMA
const initDashboardEventsTable = async () => {
  try {
    // Create table if it doesn't exist (includes all columns from the start)
    await db.query(`
      CREATE TABLE IF NOT EXISTS dashboard_events (
        id INT AUTO_INCREMENT PRIMARY KEY,
        title VARCHAR(255) NOT NULL,
        description TEXT,
        event_date DATE,
        event_time TIME,
        location VARCHAR(255),
        school_id INT DEFAULT NULL,
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Migrate: add school_id if missing (for existing deployments)
    const [cols] = await db.query(
      `SHOW COLUMNS FROM dashboard_events LIKE 'school_id'`,
    );
    if (cols.length === 0) {
      await db.query(
        `ALTER TABLE dashboard_events ADD COLUMN school_id INT DEFAULT NULL`,
      );
      console.log("✅ Added school_id to dashboard_events");
    }

    console.log("✅ Dashboard Events table initialized");
  } catch (err) {
    console.error("INIT DASHBOARD EVENTS TABLE ERROR:", err);
  }
};
initDashboardEventsTable();

// ⚾ INITIALIZE TEAMS TABLE
const initTeamsTable = async () => {
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS teams (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        sport VARCHAR(100),
        school_id INT,
        coach_id INT,
        status VARCHAR(50) DEFAULT 'Preparation',
        description TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (school_id) REFERENCES schools(id) ON DELETE SET NULL,
        FOREIGN KEY (coach_id) REFERENCES users(id) ON DELETE SET NULL
      )
    `);

    await db.query(`
      CREATE TABLE IF NOT EXISTS team_players (
        id INT AUTO_INCREMENT PRIMARY KEY,
        team_id INT,
        student_id INT,
        assigned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE,
        FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE
      )
    `);
    console.log("✅ Teams and Roster tables initialized");
  } catch (err) {
    console.error("INIT TEAMS TABLE ERROR:", err);
  }
};
initTeamsTable();

// 📅 INITIALIZE MARKED LECTURES TABLE (Manual Entries)
const initMarkedLecturesTable = async () => {
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS marked_lectures (
        id INT AUTO_INCREMENT PRIMARY KEY,
        school_id INT NOT NULL,
        coach_id INT NOT NULL,
        created_by INT NULL,
        sport VARCHAR(255) NOT NULL,
        lecture_date DATE NOT NULL,
        start_time TIME NOT NULL,
        end_time TIME NOT NULL,
        grades TEXT, -- Stored as comma-separated or JSON list
        division VARCHAR(50),
        week_no VARCHAR(20) NULL,
        status VARCHAR(50) DEFAULT 'Completed',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (school_id) REFERENCES schools(id) ON DELETE CASCADE,
        FOREIGN KEY (coach_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);
    console.log("✅ Marked Lectures table initialized");

    // Run structural migrations to alter existing table if columns are missing
    const [colsCreatedBy] = await db.query(
      "SHOW COLUMNS FROM marked_lectures LIKE 'created_by'",
    );
    if (colsCreatedBy.length === 0) {
      await db.query(
        "ALTER TABLE marked_lectures ADD COLUMN created_by INT NULL AFTER coach_id",
      );
      console.log("⚠️ Added created_by column to marked_lectures");
    }

    const [colsWeekNo] = await db.query(
      "SHOW COLUMNS FROM marked_lectures LIKE 'week_no'",
    );
    if (colsWeekNo.length === 0) {
      await db.query(
        "ALTER TABLE marked_lectures ADD COLUMN week_no VARCHAR(20) NULL AFTER division",
      );
      console.log("⚠️ Added week_no column to marked_lectures");
    }
  } catch (err) {
    console.error("INIT MARKED LECTURES TABLE ERROR:", err);
  }
};
initMarkedLecturesTable();

const initSupportTicketsTable = async () => {
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS support_tickets (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        email VARCHAR(255) NOT NULL,
        subject VARCHAR(255) NOT NULL,
        message TEXT NOT NULL,
        status ENUM('Open', 'In Progress', 'Resolved', 'Closed') DEFAULT 'Open',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `);
    console.log("✅ Support Tickets table initialized");
  } catch (err) {
    console.error("INIT SUPPORT TICKETS TABLE ERROR:", err);
  }
};
initSupportTicketsTable();

// 🔧 Ensure complaints table has escalation columns
const initComplaintsEscalationColumns = async () => {
  try {
    // Add current_tier if missing
    await db
      .query(
        `
      ALTER TABLE complaints ADD COLUMN IF NOT EXISTS current_tier INT DEFAULT 1
    `,
      )
      .catch(() => { });
    // Add last_escalated_at if missing
    await db
      .query(
        `
      ALTER TABLE complaints ADD COLUMN IF NOT EXISTS last_escalated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    `,
      )
      .catch(() => { });
    // Backfill last_escalated_at where NULL using created_at
    await db
      .query(
        `
      UPDATE complaints SET last_escalated_at = created_at WHERE last_escalated_at IS NULL
    `,
      )
      .catch(() => { });
    console.log("✅ Complaints escalation columns ready");
  } catch (err) {
    console.error("INIT COMPLAINTS COLUMNS ERROR:", err);
  }
};
initComplaintsEscalationColumns();
const initBirthdayTable = async () => {
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS birthday_table (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        birthday_date DATE NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY user_birthday (user_id),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);
    console.log("✅ Birthday Table initialized");
  } catch (err) {
    console.error("INIT BIRTHDAY TABLE ERROR:", err);
  }
};
initBirthdayTable();

// 📄 INITIALIZE MIR REPORTS TABLE
const initMIRReportsTable = async () => {
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS mir_reports (
        id INT AUTO_INCREMENT PRIMARY KEY,
        school_id INT NOT NULL,
        user_id INT DEFAULT 0,
        file_path VARCHAR(255) NOT NULL,
        month_year VARCHAR(50),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (school_id) REFERENCES schools(id) ON DELETE CASCADE
      )
    `);
    console.log("✅ MIR Reports table initialized");
  } catch (err) {
    console.error("INIT MIR REPORTS TABLE ERROR:", err);
  }
};
initMIRReportsTable();

// 📄 INITIALIZE SSGM CHECKLIST TABLE
const initSSGMChecklistTable = async () => {
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS sggm_school_check_list (
        id INT AUTO_INCREMENT PRIMARY KEY,
        school_id INT,
        user_id INT,
        school_name VARCHAR(255),
        conducted_at DATETIME,
        auditor_name VARCHAR(255),
        auditor_role VARCHAR(255),
        location VARCHAR(255),
        
        -- Section A: Professional Standards
        arrive_on_time BOOLEAN,
        arrive_on_time_why TEXT,
        actively_engaged BOOLEAN,
        actively_engaged_why TEXT,
        professional_behavior BOOLEAN,
        professional_behavior_why TEXT,
        
        uniform_tshirt_type VARCHAR(50),
        uniform_pants_type VARCHAR(50),
        uniform_shoes_type VARCHAR(50),
        uniform_whistle_wearing VARCHAR(50),
        grooming_type VARCHAR(50),
        
        equipment_safe BOOLEAN,
        proper_setup BOOLEAN,
        students_engaged_obs BOOLEAN,
        discipline_effective BOOLEAN,
        observations_pos TEXT,
        observations_neg TEXT,
        
        -- Section B: Well-being & Logistics
        wellbeing_issues TEXT, -- JSON array
        fail_standards BOOLEAN,
        concern_types TEXT, -- JSON array
        disciplinary_recommendations TEXT,
        
        -- Section C: Stakeholders
        stakeholder_types TEXT, -- JSON array
        stakeholder_name VARCHAR(255),
        stakeholder_designation VARCHAR(255),
        stakeholder_points TEXT,
        stakeholder_pos_feedback TEXT,
        stakeholder_concerns TEXT,
        
        -- Section D: Relationship
        satisfaction_rating VARCHAR(50),
        new_initiatives TEXT,
        urgent_complaints TEXT,
        
        -- Section E: Sentiment
        engagement_level VARCHAR(50),
        safety_measures_taken BOOLEAN,
        parent_testimonies TEXT,
        student_requests TEXT,
        
        -- Section F: Plans & Growth
        upcoming_event_name VARCHAR(255),
        upcoming_event_date DATE,
        mq_support_expected TEXT,
        growth_potential VARCHAR(50),
        infra_support_needed BOOLEAN,
        infra_requirements TEXT,
        
        -- Section G: Warning Signs
        warning_signs_observed BOOLEAN,
        warning_signs_desc TEXT,
        
        -- Section H: Insights
        insight_1 TEXT,
        insight_2 TEXT,
        insight_3 TEXT,
        hq_immediate_action TEXT,
        long_term_opportunity TEXT,
        
        -- Section I: Overall
        overall_performance VARCHAR(50),

        -- New Form Fields
        coaches_present TEXT,
        principal_coordinator_met VARCHAR(255),
        duration_of_visit VARCHAR(50),
        coach_attendance VARCHAR(50),
        coach_attendance_remarks TEXT,
        coach_attendance_evidence TEXT,
        professionalism_punctual TINYINT(1),
        professionalism_dressed TINYINT(1),
        professionalism_uniform TINYINT(1),
        professionalism_shoes TINYINT(1),
        professionalism_whistle TINYINT(1),
        professionalism_engaged TINYINT(1),
        professionalism_remarks TEXT,
        team_coordination VARCHAR(100),
        team_coordination_remarks TEXT,
        session_structure_observed VARCHAR(50),
        session_structure_remarks TEXT,
        session_structure_evidence TEXT,
        student_engagement VARCHAR(50),
        student_engagement_examples TEXT,
        class_management VARCHAR(50),
        class_management_remarks TEXT,
        curriculum_delivery VARCHAR(100),
        curriculum_delivery_remarks TEXT,
        curriculum_evidence TEXT,
        assessments_report_cards TEXT,
        assessments_report_cards_remarks TEXT,
        equipment_availability VARCHAR(100),
        equipment_availability_remarks TEXT,
        equipment_condition VARCHAR(100),
        equipment_condition_remarks TEXT,
        equipment_evidence TEXT,
        ground_inspection_safe TINYINT(1),
        ground_inspection_stored TINYINT(1),
        ground_inspection_risks TINYINT(1),
        ground_inspection_remarks TEXT,
        stakeholders_met TEXT,
        feedback_positive TEXT,
        feedback_concerns TEXT,
        satisfaction_level VARCHAR(50),
        complaints_raised VARCHAR(50),
        complaints_details TEXT,
        upcoming_events TEXT,
        upcoming_events_details TEXT,
        mq_readiness VARCHAR(100),
        mq_readiness_evidence TEXT,
        mq_readiness_remarks TEXT,
        growth_opportunities TEXT,
        growth_opportunities_details TEXT,
        coach_support_concerns TEXT,
        coach_support_evidence TEXT,
        coach_support_details TEXT,
        strengths_1 TEXT,
        strengths_2 TEXT,
        strengths_3 TEXT,
        concerns_1 TEXT,
        concerns_2 TEXT,
        concerns_3 TEXT,
        immediate_actions_assigned TEXT,
        immediate_actions_remarks TEXT,
        
        -- Photo columns
        coach_attendance_photo TEXT,
        session_structure_photo TEXT,
        curriculum_photo TEXT,
        equipment_photo TEXT,
        mq_readiness_photo TEXT,
        coach_support_photo TEXT,

        
        
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    console.log("✅ SSGM Checklist table initialized");
  } catch (err) {
    console.error("INIT SSGM CHECKLIST TABLE ERROR:", err);
  }
};
initSSGMChecklistTable();

// 📄 INITIALIZE WHERE NEXT TABLE
const initWhereNextTable = async () => {
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS where_next (
        id INT AUTO_INCREMENT PRIMARY KEY,
        person_name VARCHAR(255) NOT NULL,
        phone_number VARCHAR(20) NOT NULL,
        email VARCHAR(255),
        created_by_name VARCHAR(255) NOT NULL,
        unique_token VARCHAR(100) UNIQUE,
        status ENUM('Pending', 'Opened', 'Completed') DEFAULT 'Pending',
        opened_at TIMESTAMP NULL,
        completed_at TIMESTAMP NULL,
        assessment_data JSON,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log("✅ Where Next table initialized with tracking fields");
  } catch (err) {
    console.error("INIT WHERE NEXT TABLE ERROR:", err);
  }
};
initWhereNextTable();

// 📹 INITIALIZE MEETING TABLES
const initMeetingTables = async () => {
  try {
    // 1. Create meeting_events
    await db.query(`
      CREATE TABLE IF NOT EXISTS meeting_events (
        id INT AUTO_INCREMENT PRIMARY KEY,
        title VARCHAR(255) NOT NULL,
        description TEXT,
        room_id VARCHAR(100) NOT NULL UNIQUE,
        created_by INT NULL,
        scheduled_at DATETIME NULL,
        ai_summary TEXT,
        transcript LONGTEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    // 2. Create meeting_participants
    await db.query(`
      CREATE TABLE IF NOT EXISTS meeting_participants (
        id INT AUTO_INCREMENT PRIMARY KEY,
        room_id VARCHAR(100) NOT NULL,
        user_name VARCHAR(255) NOT NULL,
        joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        left_at TIMESTAMP NULL,
        duration_minutes INT NULL,
        INDEX idx_room (room_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    // 3. Ensure ai_summary and transcript columns exist if table was already created earlier
    try {
      await db.query(
        "ALTER TABLE meeting_events ADD COLUMN ai_summary TEXT NULL",
      );
      console.log("✅ Checked/Added ai_summary column to meeting_events");
    } catch (e) {
      if (e.code !== "ER_DUP_FIELDNAME" && e.errno !== 1060) {
        console.warn("Could not add ai_summary column:", e.message);
      }
    }

    try {
      await db.query(
        "ALTER TABLE meeting_events ADD COLUMN transcript LONGTEXT NULL",
      );
      console.log("✅ Checked/Added transcript column to meeting_events");
    } catch (e) {
      if (e.code !== "ER_DUP_FIELDNAME" && e.errno !== 1060) {
        console.warn("Could not add transcript column:", e.message);
      }
    }

    // 4. Ensure assigned_exam_formats column exists in schools table
    try {
      await db.query(
        "ALTER TABLE schools ADD COLUMN assigned_exam_formats TEXT NULL",
      );
      console.log("✅ Checked/Added assigned_exam_formats column to schools");
    } catch (e) {
      if (e.code !== "ER_DUP_FIELDNAME" && e.errno !== 1060) {
        console.warn(
          "Could not add assigned_exam_formats column to schools:",
          e.message,
        );
      }
    }

    console.log("✅ Meeting Events & Participants tables initialized");
  } catch (err) {
    console.error("INIT MEETING TABLES ERROR:", err);
  }
};
initMeetingTables();

// ⭐ INITIALIZE TEAM RATINGS TABLE
const initTeamRatingsTable = async () => {
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS team_ratings (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        rater_id INT NOT NULL,
        rating DECIMAL(3,2) NOT NULL,
        description TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_user (user_id),
        INDEX idx_rater (rater_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
    console.log("✅ Team Ratings table initialized");
  } catch (err) {
    console.error("INIT TEAM RATINGS ERROR:", err);
  }
};
initTeamRatingsTable();

// 📋 INITIALIZE KANBAN TABLES
const initKanbanTables = async () => {
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS kanban_boards (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await db.query(`
      CREATE TABLE IF NOT EXISTS kanban_tasks (
        id INT AUTO_INCREMENT PRIMARY KEY,
        board_id INT NOT NULL,
        title VARCHAR(255) NOT NULL,
        description TEXT,
        priority ENUM('LOW', 'MEDIUM', 'HIGH') DEFAULT 'MEDIUM',
        column_key VARCHAR(50) NOT NULL,
        due_date DATE,
        assignee_id INT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (board_id) REFERENCES kanban_boards(id) ON DELETE CASCADE
      )
    `);

    // Insert some initial data if tables are empty
    const [boards] = await db.query(
      "SELECT COUNT(*) as count FROM kanban_boards",
    );
    if (boards[0].count === 0) {
      console.log("Inserting initial boards...");
      await db.query(
        "INSERT INTO kanban_boards (name) VALUES ('Engineering'), ('Marketing'), ('Sales')",
      );
    }

    console.log("✅ Kanban tables initialized successfully");
  } catch (err) {
    console.error("INIT KANBAN TABLES ERROR:", err);
  }
};
initKanbanTables();

// Convertion of url link for MQ Backup Plan -
function normalizeYouTubeUrl(url) {
  try {
    const parsed = new URL(url);

    let videoId = "";

    // https://youtu.be/VIDEO_ID
    if (parsed.hostname.includes("youtu.be")) {
      videoId = parsed.pathname.slice(1);
    }

    // https://youtube.com/watch?v=VIDEO_ID
    else if (
      parsed.hostname.includes("youtube.com") &&
      parsed.pathname === "/watch"
    ) {
      videoId = parsed.searchParams.get("v");
    }

    // https://youtube.com/shorts/VIDEO_ID
    else if (
      parsed.hostname.includes("youtube.com") &&
      parsed.pathname.startsWith("/shorts/")
    ) {
      videoId = parsed.pathname.split("/")[2];
    }

    if (!videoId) {
      return null;
    }

    return `https://www.youtube.com/embed/${videoId}`;
  } catch (err) {
    return null;
  }
}
// 📹 INITIALIZE THEORY VIDEOS TABLE
const initTheoryVideosTable = async () => {
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS theory_videos (
        id INT AUTO_INCREMENT PRIMARY KEY,
        sport VARCHAR(255) NOT NULL,
        title VARCHAR(255) NOT NULL,
        src VARCHAR(500) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log("✅ Theory Videos table initialized");
  } catch (err) {
    console.error("INIT THEORY VIDEOS TABLE ERROR:", err);
  }
};
initTheoryVideosTable();

const initFitnessTestResultValuesTable = async () => {
  try {
    // Check if the table exists
    const [tables] = await db.query(`
      SHOW TABLES LIKE 'fitness_test_result_values'
    `);

    if (tables.length === 0) {
      // Create the table if it does not exist
      await db.query(`
        CREATE TABLE fitness_test_result_values (
          id INT AUTO_INCREMENT PRIMARY KEY,
          result_id INT NOT NULL,
          parameter_id INT NOT NULL,
          parameter_value DECIMAL(10,2) DEFAULT NULL,
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          mark_status VARCHAR(50) DEFAULT NULL,
          UNIQUE KEY result_parameter_unique (result_id, parameter_id),
          KEY result_id (result_id),
          KEY parameter_id (parameter_id),
          CONSTRAINT fk_result_values_parameter
            FOREIGN KEY (parameter_id)
            REFERENCES parameter_info (id)
            ON DELETE CASCADE,
          CONSTRAINT fk_result_values_result
            FOREIGN KEY (result_id)
            REFERENCES fitness_test_results (id)
            ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=latin1 COLLATE=latin1_swedish_ci
      `);

      console.log("✅ fitness_test_result_values table created");
      return;
    }

    // Table exists → check if mark_status column exists
    const [columns] = await db.query(`
      SHOW COLUMNS FROM fitness_test_result_values
      LIKE 'mark_status'
    `);

    if (columns.length === 0) {
      await db.query(`
        ALTER TABLE fitness_test_result_values
        ADD COLUMN mark_status VARCHAR(50) DEFAULT NULL
      `);

      console.log("✅ fitness_test_result_values.mark_status column added");
    } else {
      console.log("✅ fitness_test_result_values table ready");
    }
  } catch (err) {
    console.error("INIT FITNESS TEST RESULT VALUES TABLE ERROR:", err);
  }
};

initFitnessTestResultValuesTable();

async function initSSGMPreWeeklyPlannerTables() {
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS ssgm_pre_weekly_planner_selections (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        school_id INT NOT NULL,
        sport VARCHAR(255) NOT NULL,
        grade VARCHAR(100) NOT NULL,
        division VARCHAR(20) DEFAULT 'A',
        week VARCHAR(20) NOT NULL,
        mode ENUM('current', 'next') NOT NULL,
        updated_by INT NULL,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_school_sport_grade_division_week (school_id, sport, grade, division, week),
        INDEX idx_updated_by (updated_by),
        FOREIGN KEY (school_id) REFERENCES schools(id) ON DELETE CASCADE,
        FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL
      )
    `);
    //AFNAN HERE!!
    await db.query(`
  CREATE TABLE IF NOT EXISTS ssgm_pre_weekly_planner_sent (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    school_id INT NOT NULL,
    week_no INT NOT NULL DEFAULT 1,
    month_year VARCHAR(20) NOT NULL,
    email_to TEXT NOT NULL,
    sent_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    send_date DATE NULL,
    send_week INT NULL,
    planner_option VARCHAR(50) NULL,
    INDEX idx_school_week (school_id, week_no, month_year),
    INDEX idx_sent_at (sent_at),
    FOREIGN KEY (school_id) REFERENCES schools(id) ON DELETE CASCADE
  )
`);

    await db.query(`
      CREATE TABLE IF NOT EXISTS ssgm_pre_weekly_planner_assessment_plans (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        school_id INT NOT NULL,
        filename VARCHAR(255) NOT NULL,
        original_name VARCHAR(255) NOT NULL,
        file_path VARCHAR(500) NOT NULL,
        mime_type VARCHAR(100) NOT NULL,
        file_size BIGINT NOT NULL,
        uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        plan_type VARCHAR(20) NOT NULL DEFAULT 'whole',
        INDEX idx_school_id (school_id),
        INDEX idx_uploaded_at (uploaded_at),
        FOREIGN KEY (school_id) REFERENCES schools(id) ON DELETE CASCADE
      )
    `);

    try {
      await db.query(
        `ALTER TABLE ssgm_pre_weekly_planner_assessment_plans ADD COLUMN plan_type VARCHAR(20) NOT NULL DEFAULT 'whole'`,
      );
    } catch (e) {
      // Column plan_type already exists
    }

    try {
      await db.query(
        `ALTER TABLE ssgm_pre_weekly_planner_assessment_plans ADD COLUMN uploaded_by INT`,
      );
    } catch (e) {
      // Column uploaded_by already exists
    }

    await db.query(`
      CREATE TABLE IF NOT EXISTS ssgm_pre_weekly_planner_assessment_plan_scopes (
        id INT AUTO_INCREMENT PRIMARY KEY,
        assessment_plan_id BIGINT NOT NULL,
        school_id INT NOT NULL,
        sport VARCHAR(100) NOT NULL,
        grade VARCHAR(100) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_plan_id (assessment_plan_id),
        INDEX idx_school_sport_grade (school_id, sport, grade),
        FOREIGN KEY (assessment_plan_id) REFERENCES ssgm_pre_weekly_planner_assessment_plans(id) ON DELETE CASCADE,
        FOREIGN KEY (school_id) REFERENCES schools(id) ON DELETE CASCADE
      )
    `);

    // Add send_date, send_week, planner_option columns if they don't exist
    try {
      await db.query(
        `ALTER TABLE ssgm_pre_weekly_planner_sent ADD COLUMN send_date DATE NULL`,
      );
    } catch (e) {
      // Column already exists
    }
    try {
      await db.query(
        `ALTER TABLE ssgm_pre_weekly_planner_sent ADD COLUMN send_week INT NULL`,
      );
    } catch (e) {
      // Column already exists
    }
    try {
      await db.query(
        `ALTER TABLE ssgm_pre_weekly_planner_sent ADD COLUMN planner_option VARCHAR(50) NULL`,
      );
    } catch (e) {
      // Column already exists
    }

    console.log("✅ SSGM Pre Weekly Planner tables initialized.");
  } catch (err) {
    console.error("❌ Error initializing SSGM Pre Weekly Planner tables:", err);
  }
}
initSSGMPreWeeklyPlannerTables();

async function initPreWeeklyPlannerCredentialsTables() {
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS pre_weekly_planner_credentials (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        email VARCHAR(255) NOT NULL,
        password TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY unique_ssgm_user (user_id)
      )
    `);

    console.log("✅ Pre Weekly Planner Credentials table initialized.");
  } catch (err) {
    console.error(
      "❌ Error initializing Pre Weekly Planner Credentials table:",
      err,
    );
  }
}

async function initCurriculumCompletionNotificationsTable() {
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS curriculum_completion_notifications (
        id INT AUTO_INCREMENT PRIMARY KEY,
        school_id INT NOT NULL,
        school_grade VARCHAR(60) NOT NULL,
        sport VARCHAR(100) NOT NULL,
        sports_level VARCHAR(60) NOT NULL,
        notification_type VARCHAR(50) NOT NULL DEFAULT 'SPORTS_LEVEL_COMPLETE',
        status ENUM('PENDING', 'SENDING', 'SENT', 'FAILED') NOT NULL DEFAULT 'PENDING',
        recipient_email VARCHAR(255) NULL,
        retry_count INT NOT NULL DEFAULT 0,
        last_attempt_at TIMESTAMP NULL,
        sent_at TIMESTAMP NULL,
        error_message TEXT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

        UNIQUE KEY uniq_completion_notif (
          school_id,
          school_grade,
          sport,
          sports_level,
          notification_type
        ),

        INDEX idx_ccn_school (school_id),
        INDEX idx_ccn_status (status)
      ) ENGINE=InnoDB
      DEFAULT CHARSET=utf8mb4
      COLLATE=utf8mb4_unicode_ci
    `);

    console.log("✅ Curriculum Completion Notifications table initialized.");
  } catch (err) {
    console.error(
      "❌ Error initializing Curriculum Completion Notifications table:",
      err,
    );
  }
}
initCurriculumCompletionNotificationsTable();

async function initMRMReportTable() {
  try {
    await db.query(`
      CREATE TABLE \`mir_reports\` (
        \`id\` int(11) NOT NULL AUTO_INCREMENT,
        \`school_id\` int(11) NOT NULL,
        \`user_id\` int(11) DEFAULT 0,
        \`file_path\` varchar(255) NOT NULL,
        \`month_year\` varchar(50) DEFAULT NULL,
        \`created_at\` timestamp NOT NULL DEFAULT current_timestamp(),
        PRIMARY KEY (\`id\`),
        KEY \`school_id\` (\`school_id\`),
        CONSTRAINT \`mir_reports_ibfk_1\`
          FOREIGN KEY (\`school_id\`)
          REFERENCES \`schools\` (\`id\`)
          ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
    `);

    await db.query(`
      ALTER TABLE mir_reports
        ADD COLUMN \`month\` VARCHAR(20) NOT NULL AFTER \`file_path\`,
        ADD COLUMN \`year\` INT(11) NOT NULL AFTER \`month\`,
        DROP COLUMN \`month_year\`;
    `);

    console.log("✅ MRM Reports table initialized.");
  } catch (err) {
    console.error("❌ Error initializing MIR Reports table:", err);
  }
}

// 🏫 INITIALIZE REFRESH SESSIONS TABLE

const initRefreshSessionTable = async () => {
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS refresh_sessions (
        id int NOT NULL AUTO_INCREMENT,
        user_id int NOT NULL,
        token_hash varchar(64) NOT NULL,
        expires_at datetime NOT NULL,
        created_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
        revoked tinyint(1) NOT NULL DEFAULT '0',
        revoked_at datetime DEFAULT NULL,
        last_used_at datetime DEFAULT NULL,
        ip_address varchar(45) DEFAULT NULL,
        user_agent varchar(255) DEFAULT NULL,
        PRIMARY KEY (id),
        UNIQUE KEY uq_refresh_token_hash (token_hash),
        KEY idx_refresh_user (user_id),
        KEY idx_refresh_expires (expires_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    console.log("✅ Refresh Session table initialized");
  } catch (err) {
    console.error("INIT REFRESH SESSION TABLE ERROR:", err);
  }
};

initRefreshSessionTable();

// 🏫 INITIALIZE SCHOOL INVENTORY MANAGEMENT TABLES
async function initSchoolInventoryManagementTables() {
  try {
    // Parent table: one equipment record per school, month and year
    await db.query(`
      CREATE TABLE IF NOT EXISTS school_inventory_equipments (
        id INT AUTO_INCREMENT PRIMARY KEY,
        school_id INT NOT NULL,
        equipment_name VARCHAR(255) NOT NULL,
        \`month\` VARCHAR(20) NOT NULL,
        \`year\` INT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY unique_school_equipment (
          school_id,
          equipment_name,
          \`month\`,
          \`year\`
        ),
        INDEX idx_sie_school (school_id),
        FOREIGN KEY (school_id)
          REFERENCES schools(id)
          ON DELETE CASCADE
      )
    `);

    // Child table: variants belonging to an equipment record
    await db.query(`
      CREATE TABLE IF NOT EXISTS school_inventory_equipment_variants (
        id INT AUTO_INCREMENT PRIMARY KEY,
        equipment_id INT NOT NULL,
        size VARCHAR(50) DEFAULT NULL,
        damaged INT NOT NULL DEFAULT 0,
        quantity INT NOT NULL DEFAULT 0,
        \`condition\` VARCHAR(20) NOT NULL DEFAULT 'Good',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_siev_equipment (equipment_id),
        FOREIGN KEY (equipment_id)
          REFERENCES school_inventory_equipments(id)
          ON DELETE CASCADE,
        CONSTRAINT chk_siev_damaged_non_negative
          CHECK (damaged >= 0),
        CONSTRAINT chk_siev_quantity_non_negative
          CHECK (quantity >= 0)
      )
    `);

    // Migrate existing databases: allow both numeric and text sizes (e.g. "M", "XL", "Large")
    await db.query(`
      ALTER TABLE school_inventory_equipment_variants
      MODIFY COLUMN size VARCHAR(50) DEFAULT NULL
    `);

    // Transfer history: one row per executed stock transfer (same transaction).
    // \`month\` is NULL for year-only transfers; legacy month-based rows are kept intact.
    await db.query(`
      CREATE TABLE IF NOT EXISTS school_inventory_stock_transfers (
        id INT AUTO_INCREMENT PRIMARY KEY,
        source_school_id INT NOT NULL,
        destination_school_id INT NOT NULL,
        equipment_name VARCHAR(255) NOT NULL,
        size VARCHAR(50) DEFAULT NULL,
        \`month\` VARCHAR(20) DEFAULT NULL,
        \`year\` INT NOT NULL,
        quantity INT NOT NULL,
        source_before INT NOT NULL DEFAULT 0,
        source_after INT NOT NULL DEFAULT 0,
        destination_before INT NOT NULL DEFAULT 0,
        destination_after INT NOT NULL DEFAULT 0,
        transferred_by INT DEFAULT NULL,
        \`status\` VARCHAR(20) NOT NULL DEFAULT 'SUCCESS',
        transferred_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_stf_source (source_school_id),
        INDEX idx_stf_dest (destination_school_id),
        INDEX idx_stf_equipment (equipment_name),
        INDEX idx_stf_period (\`month\`, \`year\`),
        INDEX idx_stf_year (\`year\`)
      )
    `);

    // Migrate existing databases: year-only transfers have no single month
    await db.query(`
      ALTER TABLE school_inventory_stock_transfers
      MODIFY COLUMN \`month\` VARCHAR(20) DEFAULT NULL
    `);

    // Year-based history lookups (no-op if already applied)
    try {
      await db.query(`
        ALTER TABLE school_inventory_stock_transfers
        ADD INDEX idx_stf_year (\`year\`)
      `);
    } catch (idxErr) {
      if (idxErr.code !== "ER_DUP_KEYNAME") {
        console.error("ADD INDEX idx_stf_year ERROR:", idxErr);
      }
    }

    console.log("✅ School Inventory Management tables initialized.");
  } catch (err) {
    console.error("INIT SCHOOL INVENTORY MANAGEMENT TABLES ERROR:", err);
  }
}

initSchoolInventoryManagementTables();

/*
// ===== PRINCIPAL AUTOMATE TASK START: AUTOMATION TABLES =====

// 📬 PRINCIPAL FEEDBACK AUTOMATION TABLES
// Stores one row per emailed feedback request (identified by a secure token)
// and the raw answers the principal submits against that token. No scoring or
// aggregation happens here — responses are stored verbatim for later analysis.
const initPrincipalFeedbackAutomationTables = async () => {
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS principal_feedback_requests (
        id INT AUTO_INCREMENT PRIMARY KEY,
        token VARCHAR(128) NOT NULL UNIQUE,
        school_id INT NOT NULL,
        month_year VARCHAR(20) NOT NULL,
        principal_email VARCHAR(255) NOT NULL,
        status ENUM('pending','submitted') NOT NULL DEFAULT 'pending',
        requested_by INT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        submitted_at TIMESTAMP NULL,
        INDEX idx_pfr_school (school_id),
        INDEX idx_pfr_status (status),
        INDEX idx_pfr_month (month_year)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    await db.query(`
      CREATE TABLE IF NOT EXISTS principal_feedback_responses (
        id INT AUTO_INCREMENT PRIMARY KEY,
        request_id INT NOT NULL,
        question_key VARCHAR(50) NOT NULL,
        response TEXT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_pfrp_request (request_id),
        CONSTRAINT pfrp_request_fk FOREIGN KEY (request_id)
          REFERENCES principal_feedback_requests(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    console.log("✅ Principal Feedback Automation tables initialized.");
  } catch (err) {
    console.error("INIT PRINCIPAL FEEDBACK AUTOMATION TABLES ERROR:", err);
  }
};

initPrincipalFeedbackAutomationTables();

// ===== PRINCIPAL AUTOMATE TASK: AUTOMATION TABLES END =====
*/

// ⏰ PTM AUTO-RELOCK: Delete unlocks older than 12 hours (runs every 30 minutes)
const runPTMAutoRelock = async () => {
  try {
    const [result] = await db.query(
      "DELETE FROM ptm_user_unlocks WHERE unlocked_at < NOW() - INTERVAL 12 HOUR",
    );
    if (result.affectedRows > 0) {
      console.log(
        `🔒 PTM Auto-Relock: ${result.affectedRows} expired unlock(s) removed`,
      );
    }
  } catch (err) {
    console.error("PTM AUTO-RELOCK ERROR:", err.message);
  }
};

// Run immediately on startup, then every 30 minutes
runPTMAutoRelock();
setInterval(runPTMAutoRelock, 30 * 60 * 1000);



/* socket.io omitted */
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = UPLOADS_DIR;
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + "-" + file.originalname);
  },
});
const upload = multer({ storage });
const socialUpload = upload.fields([
  { name: "thumbnail", maxCount: 1 },
  { name: "video", maxCount: 1 },
]);
const templateStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = "files/mqreporttemplates";
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, "test_format_" + uniqueSuffix + path.extname(file.originalname));
  },
});
const templateUpload = multer({ storage: templateStorage });
const schoolUploadFields = upload.fields([
  { name: "school_logo", maxCount: 1 },
  { name: "school_image", maxCount: 1 },
  { name: "time_table_image", maxCount: 1 },
  { name: "principal_signature_image", maxCount: 1 },
  { name: "head_coach_signature_image", maxCount: 1 },
]);

// 📂 GENERIC FILE UPLOAD ENDPOINT

; // stripped /api/upload


// ─────────────────────────────────────────────────────────────────────────────
// Persistent session (refresh credential) helpers.
// ─────────────────────────────────────────────────────────────────────────────
const ACCESS_TOKEN_LIFETIME = "1h"; // short-lived JWT
const REFRESH_SESSION_DAYS = 14; // significantly longer than the access token

// Refresh credentials are never stored in plaintext — only a SHA-256 digest is
// persisted so a database leak cannot be replayed as a valid credential.
function hashRefreshToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

// One-time rotation guard: a refresh credential can be used to mint a new
// access token several times, so keep the persistent session until it expires
// or is revoked. Purge plain-expired rows opportunistically.
async function cleanupExpiredRefreshSessions() {
  try {
    await db.query(
      "DELETE FROM refresh_sessions WHERE expires_at <= NOW()",
      [],
    );
  } catch (err) {
    console.error("[AUTH] Refresh session cleanup skipped:", err.message);
  }
}

app.post("/api/login", async (req, res) => {
  console.log("\n--- LOGIN REQUEST ---");
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({
      success: false,
      message: "Email and password required",
    });
  }
  try {
    const formattedEmail = email.toLowerCase().trim();
    const [rows] = await db.query(
      "SELECT id, name, email, password, is_active, hash_key, role_id, profile_pic FROM users WHERE email = ?",
      [formattedEmail],
    );
    if (rows.length === 0) {
      console.log("❌ USER NOT FOUND");
      return res.status(401).json({
        success: false,
        message: "Incorrect email or password!",
      });
    }
    const user = rows[0];
    console.log("✅ USER FOUND:", user.email);
    if (user.is_active !== 1) {
      console.log("❌ USER INACTIVE");
      return res.status(403).json({
        success: false,
        message: "Account inactive",
      });
    }
    const cleanPassword = password.trim();
    let isMatch = false;
    const isSHA1 = user.password.length === 40;
    const isBcrypt = user.password.startsWith("$2");
    if (isSHA1) {
      const sha1 = crypto
        .createHash("sha1")
        .update(cleanPassword)
        .digest("hex");

      if (sha1 === user.password) {
        isMatch = true;

        console.log("✅ SHA1 MATCH");
        const hashed = await bcrypt.hash(cleanPassword, 10);
        await db.query("UPDATE users SET password = ? WHERE id = ?", [
          hashed,
          user.id,
        ]);
        console.log("🔄 Password upgraded to bcrypt");
      } else {
        console.log("❌ SHA1 MISMATCH");
      }
    } else if (isBcrypt) {
      isMatch = await bcrypt.compare(cleanPassword, user.password);
    }

    // ❌ Wrong password
    if (!isMatch) {
      console.log("❌ LOGIN FAILED");
      return res.status(401).json({
        success: false,
        message: "Incorrect email or password!",
      });
    }

    // ✅ Generate short-lived access JWT
    const token = jwt.sign(
      { id: user.id, email: user.email, role_id: user.role_id },
      JWT_SIGNING_SECRET,
      { expiresIn: ACCESS_TOKEN_LIFETIME },
    );

    // ✅ Update last_login
    await db.query("UPDATE users SET last_login = NOW() WHERE id = ?", [
      user.id,
    ]);

    // ✅ Fetch assigned school_id
    const [schoolRows] = await db.query(
      "SELECT school_id FROM assign_school WHERE user_id = ? LIMIT 1",
      [user.id],
    );
    const school_id = schoolRows.length > 0 ? schoolRows[0].school_id : null;

    console.log("🎉 LOGIN SUCCESS, SCHOOL_ID:", school_id);

    // ✅ Create persistent refresh session (hashed, long-lived)
    const refreshToken = crypto.randomBytes(48).toString("hex");
    const refreshExpiry = new Date(
      Date.now() + REFRESH_SESSION_DAYS * 86400000,
    );
    await db.query(
      "INSERT INTO refresh_sessions (user_id, token_hash, expires_at, ip_address, user_agent) VALUES (?, ?, ?, ?, ?)",
      [
        user.id,
        hashRefreshToken(refreshToken),
        refreshExpiry.toISOString().slice(0, 19).replace("T", " "),
        req.ip || req.socket?.remoteAddress || null,
        String((req.headers["user-agent"] || "").slice(0, 255)) || null,
      ],
    );
    await cleanupExpiredRefreshSessions();

    // 🧾 AUDIT LOG: successful login (identity from authenticated DB user record)
    logActivity({
      userId: user.id,
      userName: user.name,
      page: "Login",
      action: "User logged in successfully",
      type: "LOGIN",
    });

    // ✅ Fetch role name from roles table for admin redirect logic
    const [roleRows] = await db.query("SELECT name FROM roles WHERE id = ?", [
      user.role_id,
    ]);
    const role_name = roleRows.length > 0 ? roleRows[0].name : null;

    return res.json({
      success: true,
      message: "Login successful",
      token,
      expires_in: 3600,
      refresh_token: refreshToken,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        hash_key: user.hash_key,
        role_id: user.role_id,
        role_name: role_name, // ← NEW: Include role name in login response
        profile_pic: user.profile_pic || "",
        school_id,
      },
    });
  } catch (err) {
    console.error("❌ ERROR:", err);
    return res.status(500).json({
      success: false,
      message: "Server error during login",
    });
  }
});

// 🔄 REFRESH — exchanges a valid persistent refresh credential for a new
// short-lived access token. Rejects expired, revoked, or unknown sessions.
app.post("/api/refresh", async (req, res) => {
  try {
    const { refresh_token } = req.body || {};
    if (!refresh_token || typeof refresh_token !== "string") {
      return res
        .status(401)
        .json({ success: false, message: "Refresh token required" });
    }

    const tokenHash = hashRefreshToken(refresh_token);
    const [rows] = await db.query(
      "SELECT id, user_id, expires_at, revoked FROM refresh_sessions WHERE token_hash = ?",
      [tokenHash],
    );

    if (rows.length === 0) {
      return res
        .status(401)
        .json({ success: false, message: "Session expired" });
    }

    const session = rows[0];
    const isExpired = new Date(session.expires_at) <= new Date();
    if (session.revoked === 1 || isExpired) {
      return res
        .status(401)
        .json({ success: false, message: "Session expired" });
    }

    const [userRows] = await db.query(
      "SELECT id, email, role_id, is_active, name FROM users WHERE id = ?",
      [session.user_id],
    );
    if (userRows.length === 0 || userRows[0].is_active !== 1) {
      await db.query(
        "UPDATE refresh_sessions SET revoked = 1, revoked_at = NOW() WHERE id = ?",
        [session.id],
      );
      return res
        .status(401)
        .json({ success: false, message: "Account unavailable" });
    }
    const user = userRows[0];

    const token = jwt.sign(
      { id: user.id, email: user.email, role_id: user.role_id },
      JWT_SIGNING_SECRET,
      { expiresIn: ACCESS_TOKEN_LIFETIME },
    );

    await db.query(
      "UPDATE refresh_sessions SET last_used_at = NOW(), ip_address = ?, user_agent = ? WHERE id = ?",
      [
        req.ip || req.socket?.remoteAddress || null,
        String((req.headers["user-agent"] || "").slice(0, 255)) || null,
        session.id,
      ],
    );
    await cleanupExpiredRefreshSessions();

    logActivity({
      userId: user.id,
      userName: user.name,
      page: "Login",
      action: "Access token refreshed",
      type: "LOGIN",
    });

    return res.json({
      success: true,
      message: "Token refreshed",
      token,
      expires_in: 3600,
    });
  } catch (err) {
    console.error("❌ REFRESH ERROR:", err);
    return res.status(500).json({
      success: false,
      message: "Server error during refresh",
    });
  }
});

// 🚪 LOGOUT — revokes the persistent refresh session and records the logout
// activity (identity resolved from the verified JWT when still valid).
app.post("/api/logout", async (req, res) => {
  try {
    const actor = await resolveUserFromRequest(req, db);

    // Revoke the persistent refresh session so the credential can never obtain
    // a new access token after logout. The refresh credential arrives in the
    // request body (never in a URL/query string).
    const { refresh_token } = req.body || {};
    if (refresh_token && typeof refresh_token === "string") {
      await db.query(
        "UPDATE refresh_sessions SET revoked = 1, revoked_at = NOW() WHERE token_hash = ? AND revoked = 0",
        [hashRefreshToken(refresh_token)],
      );
    }

    if (actor) {
      await logActivity({
        userId: actor.userId,
        userName: actor.userName,
        page: "Logout",
        action: "User logged out",
        type: "LOGOUT",
      });
    }
    res.json({ success: true });
  } catch (err) {
    console.error("LOGOUT LOG ERROR:", err);
    res.status(500).json({ success: false, message: "Error during logout" });
  }
});

// 👁️ PAGE VIEW — central page/module tracking. The route navigated to is sent
// by the frontend, but the identity is always resolved server-side from the JWT.

; // stripped /api/activity/view


// ⚡ UI ACTION / INTERACTION — frontend meaningful action tracking

; // stripped /api/activity/action


// ─── READ-ONLY ACTIVITY LOG VIEWER ───────────────────────────────────────────
// These GET endpoints expose the EXISTING logs/user-activity.log file as a
// filterable, paginated read view. The source file is NEVER modified, its
// format is NOT changed, and no activity is ever written here.

// Parse a log entry. Returns null for incomplete/malformed records so the
// reader can skip them instead of crashing.
function parseActivityRecord(headerLine, bodyLine) {
  const headerMatch =
    /^(\d{4}-\d{2}-\d{2}) \| User: (.+) \| UserID: (\d+)$/.exec(headerLine);
  const bodyMatch = /^(\d{2}:\d{2}:\d{2}) \| (.+) \| (.+) \| (.+)$/.exec(
    bodyLine,
  );
  if (!headerMatch || !bodyMatch) return null;
  return {
    date: headerMatch[1],
    user_name: headerMatch[2].trim(),
    user_id: parseInt(headerMatch[3], 10),
    time: bodyMatch[1],
    page: bodyMatch[2].trim(),
    action: bodyMatch[3].trim(),
    type: bodyMatch[4].trim(),
  };
}

// Read logs/user-activity.log and return parsed records in file order.
// Safely returns [] when the file is missing or unreadable. Incomplete
// trailing records (mid-append) and malformed groups are skipped.
async function readActivityLogEntries() {
  const logFile = getLogFilePath();
  let raw = "";
  try {
    raw = await fs.promises.readFile(logFile, "utf8");
  } catch (err) {
    if (err && err.code === "ENOENT") return [];
    console.error("READ ACTIVITY LOG ERROR:", err);
    return [];
  }

  const lines = raw.split(/\r?\n/);
  const entries = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    // A content line starts the record; it must be a header line.
    if (!/^\d{4}-\d{2}-\d{2} \| User: /.test(line)) continue;
    const headerLine = lines[i];
    const bodyLine = lines[i + 1] ? lines[i + 1].trim() : "";
    const record = parseActivityRecord(headerLine, bodyLine);
    if (record) entries.push(record);
    i += 1; // consume the body line; trailing incomplete records are ignored
  }
  return entries;
}

// 📖 ACTIVITY LOG — filterable, server-paginated read view of user-activity.log

; // stripped /api/activity/log


// 📊 ACTIVITY LOG SUMMARY — report KPI totals + per-user presence, scoped to
// the same Per User / Per Role filters used by the page. Read-only: the log
// file format and writer are never touched.

; // stripped /api/activity/log/summary


// 👥 ACTIVITY LOG USERS — users for the cascading filter (optional role scope)

; // stripped /api/activity/log/users



; // stripped /api/users


// 📝 REGISTER API

; // stripped /api/register


// 🚀 WHERE NEXT APIS

; // stripped /api/where-next


// 📋 KANBAN BOARD APIS

; // stripped /api/kanban/boards



; // stripped /api/kanban/boards



; // stripped /api/kanban/tasks/:boardId



; // stripped /api/kanban/tasks


app.patch("/api/kanban/tasks/:taskId", async (req, res) => {
  const { taskId } = req.params;
  const updates = req.body;
  const allowedFields = [
    "title",
    "description",
    "priority",
    "column_key",
    "due_date",
    "assignee_id",
  ];
  const updatePairs = [];
  const params = [];

  Object.keys(updates).forEach((key) => {
    if (allowedFields.includes(key)) {
      updatePairs.push(`${key} = ?`);
      params.push(updates[key]);
    }
  });

  if (updatePairs.length === 0)
    return res
      .status(400)
      .json({ success: false, message: "No valid fields provided" });

  params.push(taskId);
  try {
    await db.query(
      `UPDATE kanban_tasks SET ${updatePairs.join(", ")} WHERE id = ?`,
      params,
    );
    const actionType = updates.column_key ? "WORKFLOW" : "UPDATE";
    const actionDesc = updates.column_key
      ? `Moved task #${taskId} to status "${updates.column_key}"`
      : `Updated task #${taskId}`;

    await auditAction(req, {
      page: "Task Manager",
      type: actionType,
      action: actionDesc,
      entity: { type: "Task", id: taskId },
    });

    res.json({ success: true });
  } catch (err) {
    console.error("UPDATE TASK ERROR:", err);
    res.status(500).json({ success: false, message: "Error updating task" });
  }
});


; // stripped /api/kanban/tasks/:taskId



; // stripped /api/where-next


// 📊 ASSESSMENT TRACKING APIS

; // stripped /api/assessment/:token



; // stripped /api/assessment/open/:token



; // stripped /api/assessment/save/:token



; // stripped /api/assessment/submit/:token


// 🎂 BIRTHDAY APIS

; // stripped /api/user-birthday/:userId



; // stripped /api/user-birthday


// 🏫 GET SCHOOLS API (Filtered by Gallery existence if requested)
app.get("/api/schools", async (req, res) => {
  const { hasGallery, hasReports, user_id, role_id } = req.query;
  let rid = parseInt(role_id) || 0;
  let uid = parseInt(user_id) || 0;

  try {
    // If role_id is not passed in query, look it up from database
    if (uid > 0 && !rid) {
      const [uRows] = await db.query("SELECT role_id FROM users WHERE id = ?", [
        uid,
      ]);
      if (uRows.length > 0) {
        rid = uRows[0].role_id;
      }
    }

    const isUnrestricted = rid === 1 || rid === 7 || rid === 2;

    // 1. Determine assigned schools for this user (only for restricted roles like Coaches / SSGM / etc.)
    let schoolIds = [];
    if (uid > 0 && !isUnrestricted) {
      const [assignments] = await db.query(
        `
        SELECT school_id FROM assign_school WHERE user_id = ? OR ssgm_id = ?
        UNION
        SELECT school_id FROM lp_assign WHERE user_id = ?
        UNION
        SELECT school_id FROM coach_lesson_tracking WHERE user_id = ?
      `,
        [uid, uid, uid, uid],
      );
      schoolIds = assignments
        .map((a) => a.school_id)
        .filter((id) => id !== null && id !== undefined && id !== 0);
    }

    let query = `
      SELECT s.*, u.name as om_name,
      (SELECT COUNT(*) FROM students src WHERE src.school_id = s.id) as student_count,
      (SELECT COUNT(*) FROM school_gallery sg WHERE sg.school_id = s.id) as gallery_count
      FROM schools s 
      LEFT JOIN users u ON s.mq_om_id = u.id
    `;

    const conditions = [];

    // 2. Apply school access filter (Admins and Operations Head see ALL schools)
    if (uid > 0 && !isUnrestricted) {
      if (schoolIds.length > 0) {
        conditions.push(`s.id IN (${schoolIds.join(",")})`);
      } else {
        conditions.push(`1 = 0`); // Force empty result if non-admin user has no assigned schools
      }
    }

    if (hasGallery === "true") {
      conditions.push(
        `EXISTS (SELECT 1 FROM school_gallery sg WHERE sg.school_id = s.id)`,
      );
    } else if (hasGallery === "false") {
      conditions.push(
        `NOT EXISTS (SELECT 1 FROM school_gallery sg WHERE sg.school_id = s.id)`,
      );
    }

    if (hasReports === "true") {
      conditions.push(`(
        EXISTS (SELECT 1 FROM year_lp_master_new yn WHERE yn.school_id = s.id) 
        OR EXISTS (SELECT 1 FROM coach_lesson_tracking clt WHERE clt.school_id = s.id)
      )`);
    }

    if (conditions.length > 0) {
      query += ` WHERE ` + conditions.join(" AND ");
    }

    const [rows] = await db.query(query);
    res.json({ success: true, schools: rows });
  } catch (err) {
    console.error("FETCH SCHOOLS ERROR:", err);
    res.status(500).json({ success: false, message: "Error fetching schools" });
  }
});

// 🏫 GET SINGLE SCHOOL DETAIL
app.get("/api/schools/:id", async (req, res) => {
  const { id } = req.params;
  try {
    const [rows] = await db.query("SELECT * FROM schools WHERE id = ?", [id]);
    if (rows.length === 0) {
      return res
        .status(404)
        .json({ success: false, message: "School not found" });
    }
    const school = { ...rows[0] };
    const isTruthy = (v) => v === true || v === 'true' || v === 1 || v === '1';
    school.show_principal_signature = isTruthy(school.show_principal_signature) ? 1 : 0;
    school.show_head_coach_signature = isTruthy(school.show_head_coach_signature) ? 1 : 0;
    res.json({ success: true, school });
  } catch (err) {
    console.error("FETCH SCHOOL DETAIL ERROR:", err);
    res
      .status(500)
      .json({ success: false, message: "Error fetching school details" });
  }
});

// 🤖 AUTOMATED STAFF HIERARCHY API

; // stripped /api/staff-hierarchy/automated/:school_id


// 📅 LECTURE MANAGEMENT APIS

; // stripped /api/coaches



; // stripped /api/lectures



; // stripped /api/lectures



; // stripped /api/school-metadata/:school_id


// 🎫 SUPPORT TICKETING APIS
// Redundant endpoints removed for consolidation below.


; // stripped /api/tickets/:id/action


let cachedSchoolSigIsEnum = null;
async function isSchoolSigEnum() {
  if (cachedSchoolSigIsEnum !== null) return cachedSchoolSigIsEnum;
  try {
    const [cols] = await db.query(
      "SELECT DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'schools' AND COLUMN_NAME = 'show_principal_signature'"
    );
    cachedSchoolSigIsEnum = (cols.length > 0 && String(cols[0].DATA_TYPE).toLowerCase() === 'enum');
  } catch (e) {
    cachedSchoolSigIsEnum = true;
  }
  return cachedSchoolSigIsEnum;
}

async function normalizeSchoolSignatureFields(data) {
  const isEnum = await isSchoolSigEnum();
  const isTruthy = (v) => v === true || v === 'true' || v === 1 || v === '1';
  if (data.show_principal_signature !== undefined) {
    const truthy = isTruthy(data.show_principal_signature);
    data.show_principal_signature = isEnum ? (truthy ? 'true' : 'false') : (truthy ? 1 : 0);
  }
  if (data.show_head_coach_signature !== undefined) {
    const truthy = isTruthy(data.show_head_coach_signature);
    data.show_head_coach_signature = isEnum ? (truthy ? 'true' : 'false') : (truthy ? 1 : 0);
  }
}

// 🏫 ADD NEW SCHOOL API
app.post("/api/schools", schoolUploadFields, async (req, res) => {
  const data = req.body;
  const files = req.files;

  try {
    // Extract file names if uploaded
    if (files["school_logo"])
      data.school_logo = files["school_logo"][0].filename;
    if (files["school_image"])
      data.school_image = files["school_image"][0].filename;
    if (files["time_table_image"])
      data.time_table_image = files["time_table_image"][0].filename;
    if (files["principal_signature_image"])
      data.principal_signature_image =
        files["principal_signature_image"][0].filename;
    if (files["head_coach_signature_image"])
      data.head_coach_signature_image =
        files["head_coach_signature_image"][0].filename;

    await normalizeSchoolSignatureFields(data);

    const creatorId = data.creator_id;
    delete data.creator_id;

    const fields = Object.keys(data);
    const placeholders = fields.map(() => "?").join(", ");
    const columns = fields.join(", ");
    const values = fields.map((field) => data[field]);

    const [result] = await db.query(
      `INSERT INTO schools (${columns}, last_updated_on) VALUES (${placeholders}, NOW())`,
      values,
    );

    const schoolId = result.insertId;

    // Automatically copy all active standards from stds_master to school_stds for this school
    const [stds] = await db.query(
      "SELECT id FROM stds_master WHERE is_active = 1",
    );
    if (stds.length > 0) {
      const schoolStdsValues = stds.map((std) => [schoolId, std.id]);
      await db.query("INSERT INTO school_stds (school_id, std_id) VALUES ?", [
        schoolStdsValues,
      ]);
    }

    // Automatically assign the selected Operation Manager (SSGM) to this school in assign_school
    if (data.mq_om_id) {
      const [users] = await db.query("SELECT role_id FROM users WHERE id = ?", [
        data.mq_om_id,
      ]);
      if (users.length > 0 && String(users[0].role_id) === "3") {
        // Check if assignment already exists
        const [existing] = await db.query(
          "SELECT id FROM assign_school WHERE user_id = ? AND school_id = ?",
          [data.mq_om_id, schoolId],
        );
        if (existing.length === 0) {
          await db.query(
            "INSERT INTO assign_school (user_id, school_id, ssgm_id) VALUES (?, ?, ?)",
            [data.mq_om_id, schoolId, data.mq_om_id],
          );
        }
      }
    }

    // If an SSGM user created this school (and isn't already the selected OM), automatically assign it to them
    if (creatorId && String(creatorId) !== String(data.mq_om_id)) {
      const [users] = await db.query("SELECT role_id FROM users WHERE id = ?", [
        creatorId,
      ]);
      if (users.length > 0 && String(users[0].role_id) === "3") {
        // Check if assignment already exists
        const [existing] = await db.query(
          "SELECT id FROM assign_school WHERE user_id = ? AND school_id = ?",
          [creatorId, schoolId],
        );
        if (existing.length === 0) {
          await db.query(
            "INSERT INTO assign_school (user_id, school_id, ssgm_id) VALUES (?, ?, ?)",
            [creatorId, schoolId, creatorId],
          );
        }
      }
    }

    await auditAction(req, () => ({
      page: "Schools",
      type: "CREATE",
      action: `Created school "${data.name || ""}"`,
      entity: { type: "School", id: schoolId },
    }));

    res.json({
      success: true,
      message: "School added successfully",
      id: schoolId,
    });
  } catch (err) {
    console.error("ADD SCHOOL ERROR:", err);
    res.status(500).json({
      success: false,
      message: "Error adding school",
      error: err.message,
    });
  }
});

// 🏫 UPDATE SCHOOL API
app.put("/api/schools/:id", schoolUploadFields, async (req, res) => {
  const { id } = req.params;
  const data = req.body;
  const files = req.files || {};
  try {
    // Extract file names if uploaded
    if (files["school_logo"])
      data.school_logo = files["school_logo"][0].filename;
    if (files["school_image"])
      data.school_image = files["school_image"][0].filename;
    if (files["time_table_image"])
      data.time_table_image = files["time_table_image"][0].filename;
    if (files["principal_signature_image"])
      data.principal_signature_image =
        files["principal_signature_image"][0].filename;
    if (files["head_coach_signature_image"])
      data.head_coach_signature_image =
        files["head_coach_signature_image"][0].filename;

    await normalizeSchoolSignatureFields(data);

    // Dynamically build update query
    const fields = Object.keys(data).filter(
      (key) => key !== "id" && key !== "last_updated_on",
    );
    if (fields.length === 0 && !files) {
      return res
        .status(400)
        .json({ success: false, message: "No fields to update" });
    }

    const setClause = fields.map((field) => `${field} = ?`).join(", ");
    const values = fields.map((field) => data[field]);
    values.push(new Date().toISOString().slice(0, 19).replace("T", " ")); // last_updated_on
    values.push(id);

    await db.query(
      `UPDATE schools SET ${setClause}, last_updated_on = ? WHERE id = ?`,
      values,
    );

    // Automatically assign the selected Operation Manager (SSGM) to this school in assign_school
    if (data.mq_om_id) {
      const [users] = await db.query("SELECT role_id FROM users WHERE id = ?", [
        data.mq_om_id,
      ]);
      if (users.length > 0 && String(users[0].role_id) === "3") {
        // Check if assignment already exists
        const [existing] = await db.query(
          "SELECT id FROM assign_school WHERE user_id = ? AND school_id = ?",
          [data.mq_om_id, id],
        );
        if (existing.length === 0) {
          await db.query(
            "INSERT INTO assign_school (user_id, school_id, ssgm_id) VALUES (?, ?, ?)",
            [data.mq_om_id, id, data.mq_om_id],
          );
        }
      }
    }

    await auditAction(req, () => ({
      page: "Schools",
      type: "UPDATE",
      action: `Updated school #${id}${data.name ? ` (new name: "${data.name}")` : ""}`,
      entity: { type: "School", id },
    }));

    res.json({ success: true, message: "School updated successfully" });
  } catch (err) {
    console.error("UPDATE SCHOOL ERROR:", err);
    res.status(500).json({ success: false, message: "Error updating school" });
  }
});

// 🏫 DELETE SCHOOL API
app.delete("/api/schools/:id", async (req, res) => {
  const { id } = req.params;
  const sId = parseInt(id, 10);
  if (!sId) {
    return res
      .status(400)
      .json({ success: false, message: "Invalid school ID" });
  }

  try {
    // 1. Fetch school details to get file paths for cleanup
    const [schools] = await db.query("SELECT * FROM schools WHERE id = ?", [
      sId,
    ]);
    if (schools.length === 0) {
      return res
        .status(404)
        .json({ success: false, message: "School not found" });
    }
    const school = schools[0];

    // Clean up uploaded files if they exist
    const fileFields = [
      "school_logo",
      "school_image",
      "time_table_image",
      "principal_signature_image",
      "head_coach_signature_image",
    ];
    for (const field of fileFields) {
      if (school[field]) {
        const filePath = path.join(__dirname, "uploads", school[field]);
        if (fs.existsSync(filePath)) {
          try {
            fs.unlinkSync(filePath);
          } catch (e) {
            console.warn("Failed to delete school file:", filePath);
          }
        }
      }
    }

    // Also clean up assessment plan files
    try {
      const [apRows] = await db.query(
        "SELECT file_path FROM ssgm_pre_weekly_planner_assessment_plans WHERE school_id = ?",
        [sId],
      );
      for (const ap of apRows) {
        if (ap.file_path && fs.existsSync(ap.file_path)) {
          try {
            fs.unlinkSync(ap.file_path);
          } catch (e) { }
        }
      }
    } catch (e) {
      console.warn("Error cleaning up assessment plans:", e.message);
    }

    // 2. Remove dependencies across associated tables safely
    const tablesWithSchoolId = [
      "ssgm_pre_weekly_planner_assessment_plan_scopes",
      "ssgm_pre_weekly_planner_assessment_plans",
      "ssgm_pre_weekly_planner_selections",
      "ssgm_pre_weekly_planner_sent",
      "curriculum_builder_plans",
      "assign_school",
      "lp_assign",
      "coach_lesson_tracking",
      "year_lp_master_new",
      "school_gallery",
      "sports_teams",
      "students",
    ];

    for (const tbl of tablesWithSchoolId) {
      try {
        await db.query(`DELETE FROM ${tbl} WHERE school_id = ?`, [sId]);
      } catch (e) {
        console.warn(
          `Note on deleting from ${tbl} for school ${sId}:`,
          e.message,
        );
      }
    }

    // 3. Delete the school record
    await db.query("DELETE FROM schools WHERE id = ?", [sId]);

    await auditAction(req, () => ({
      page: "Schools",
      type: "DELETE",
      action: `Deleted school "${school.name || ""}"`,
      entity: { type: "School", id: sId },
    }));

    res.json({
      success: true,
      message: `School "${school.name}" deleted successfully`,
    });
  } catch (err) {
    console.error("DELETE SCHOOL ERROR:", err);
    res.status(500).json({
      success: false,
      message: "Error deleting school: " + err.message,
    });
  }
});

// 📅 GET AVAILABLE MONTHS

; // stripped /api/available-months


// 🛠️ EQUIPMENT SEARCH (Autocomplete)

; // stripped /api/equipment


// 📊 GET ALL EQUIPMENTS FOR SCHOOL

; // stripped /api/school-equipments


// 💾 AUTOSAVE STOCK

; // stripped /api/autosave-stock


// 🖼️ GET SCHOOL GALLERY PHOTOS
app.get("/api/school-gallery/:id", async (req, res) => {
  const { id } = req.params;
  try {
    const [rows] = await db.query(
      "SELECT * FROM school_gallery WHERE school_id = ? ORDER BY uploaded_at DESC",
      [id],
    );
    res.json({ success: true, gallery: rows });
  } catch (err) {
    console.error("FETCH GALLERY ERROR:", err);
    res.status(500).json({ success: false, message: "Error fetching gallery" });
  }
});

// 🖼️ UPLOAD GALLERY PHOTOS
app.post(
  "/api/school-gallery/:id",
  upload.array("photos"),
  async (req, res) => {
    const { id } = req.params;
    const { category, description } = req.body;
    const files = req.files;

    if (!files || files.length === 0) {
      return res
        .status(400)
        .json({ success: false, message: "No photos uploaded" });
    }

    try {
      const values = [];

      for (const file of files) {
        try {
          const fileName =
            "gallery_" + id + "_" + Date.now() + "_" + file.originalname;
          const publicUrl = await gcsService.uploadToGCS(file.path, fileName);

          values.push([
            id,
            path.extname(file.originalname).substring(1), // file_type
            publicUrl, // Store GCS URL
            category || "General",
            new Date().toISOString().slice(0, 19).replace("T", " "), // uploaded_at
          ]);

          if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
        } catch (gcsErr) {
          console.error("GALLERY GCS UPLOAD ERROR:", gcsErr);
          values.push([
            id,
            path.extname(file.originalname).substring(1),
            file.filename,
            category || "General",
            new Date().toISOString().slice(0, 19).replace("T", " "),
          ]);
        }
      }

      await db.query(
        "INSERT INTO school_gallery (school_id, file_type, file_path, caption, uploaded_at) VALUES ?",
        [values],
      );

      res.json({
        success: true,
        message: `${files.length} photos uploaded successfully`,
      });
    } catch (err) {
      console.error("UPLOAD GALLERY ERROR:", err);
      res.status(500).json({
        success: false,
        message: "Error uploading photos",
        error: err.message,
      });
    }
  },
);

// 🖼️ DELETE GALLERY PHOTO

; // stripped /api/school-gallery-item/:itemId



; // stripped /api/match-reports


// 📄 UPLOAD MATCH REPORT

; // stripped /api/match-reports


// 📄 GET ALL MIR REPORTS

; // stripped /api/mir-reports


// 📊 GET MRM STATUS BY SCHOOL AND YEAR

; // stripped /api/reports/mrm-status


// 📄 UPLOAD MIR REPORT

; // stripped /api/mir-reports


// 👪 GET ALL PARENTS REPORTS

; // stripped /api/parents-reports


// 🔗 GET ALL SCHOOL ASSIGNMENTS

; // stripped /api/school-assignments


// 👥 GET ALL USERS FOR MANAGEMENT

; // stripped /api/users-list


// 📋 GET ALL ROLES

; // stripped /api/roles


// ➕ ADD NEW ROLE

; // stripped /api/roles


// 💾 SAVE SCHOOL ASSIGNMENTS

; // stripped /api/school-assignments


// 👥 CREATE NEW USER

; // stripped /api/users



; // stripped /api/users/coaches



; // stripped /api/users/ssgms



; // stripped /api/users/operations-managers


// 🔍 GET SINGLE USER

; // stripped /api/users/login-status


// 🔍 GET ASSIGNED USER LOGIN STATUS

; // stripped /api/assigned-users/login-status


// 👥 GET USER HIERARCHY

; // stripped /api/user-hierarchy


// 💾 SAVE USER HIERARCHY

; // stripped /api/user-hierarchy



; // stripped /api/users/:id


// 🔄 UPDATE USER

; // stripped /api/users/:id


// 🎓 ADD NEW STUDENT (Smart Endpoint: Supports IDs and Names)
app.post("/api/students", async (req, res) => {
  const {
    mq_id,
    name,
    gender,
    school_id,
    school_name,
    std,
    standard,
    division,
    status,
    roll_number,
  } = req.body;

  // 1. Unified field resolution (std/standard, school_id/school_name)
  const resolvedStd = std || standard;
  const resolvedName = name;
  let resolvedSchoolId = school_id;

  if (!resolvedName || !resolvedStd) {
    return res.status(400).json({
      success: false,
      message: "Missing mandatory fields (Name, Standard)",
    });
  }

  try {
    // 2. Resolve school_id from school_name if needed
    if (!resolvedSchoolId && school_name) {
      const [schoolRows] = await db.query(
        "SELECT id FROM schools WHERE name = ?",
        [school_name],
      );
      if (schoolRows.length > 0) resolvedSchoolId = schoolRows[0].id;
    }

    if (!resolvedSchoolId) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid or missing School" });
    }

    // 3. Duplicate check for MQ ID (if provided)
    if (mq_id) {
      const [existing] = await db.query(
        "SELECT id FROM students WHERE mq_id = ? AND mq_id IS NOT NULL",
        [mq_id],
      );
      if (existing.length > 0) {
        return res.status(400).json({
          success: false,
          message: `Student with MQ ID ${mq_id} already exists`,
        });
      }
    }

    // 4. Insert Student
    const [result] = await db.query(
      `INSERT INTO students
      (mq_id, name, gender, school_id, std, division, roll_number, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        mq_id || null,
        resolvedName,
        gender || null,
        resolvedSchoolId,
        resolvedStd,
        division || "",
        roll_number || "",
        status || "1",
      ],
    );
    await auditAction(req, {
      page: "Students",
      type: "CREATE",
      action: `Created student "${resolvedName}" (Student ID: ${result.insertId}) successfully`,
      entity: { type: "Student", id: result.insertId },
    });

    res.json({
      success: true,
      message: "Student created successfully",
      studentId: result.insertId,
    });
  } catch (err) {
    console.error("CREATE STUDENT ERROR:", err);
    res.status(500).json({
      success: false,
      message: "Error creating student",
      error: err.message,
    });
  }
});

// 🎓 GET ALL STUDENTS & DYNAMIC FILTERS
app.get("/api/students", async (req, res) => {
  try {
    const { user_id } = req.query;

    // Determine assigned schools
    let schoolIds = [];
    if (user_id) {
      const [[user]] = await db.query(
        "SELECT role_id FROM users WHERE id = ?",
        [user_id],
      );
      if (
        user &&
        user.role_id !== 1 &&
        user.role_id !== 7 &&
        user.role_id !== 2
      ) {
        const [assignments] = await db.query(
          "SELECT school_id FROM assign_school WHERE user_id = ?",
          [user_id],
        );
        schoolIds = assignments.map((a) => a.school_id);
      }
    }

    let whereClause = "";
    if (schoolIds.length > 0) {
      const idList = schoolIds.join(",");
      whereClause = `WHERE st.school_id IN (${idList})`;
    }

    const [students] = await db.query(`
      SELECT st.*, s.name as school_name 
      FROM students st 
      LEFT JOIN schools s ON st.school_id = s.id 
      ${whereClause}
      ORDER BY st.id DESC
    `);

    // Fetch unique active standards (scoped)
    const stdWhere =
      schoolIds.length > 0 ? `AND school_id IN (${schoolIds.join(",")})` : "";
    const [standardsResult] = await db.query(
      `SELECT DISTINCT std as standard FROM students WHERE std IS NOT NULL AND std != "" ${stdWhere} ORDER BY std ASC`,
    );
    const standards = standardsResult.map((row) => row.standard);

    // Fetch unique active divisions (scoped)
    const [divisionsResult] = await db.query(
      `SELECT DISTINCT division FROM students WHERE division IS NOT NULL AND division != "" ${stdWhere} ORDER BY division ASC`,
    );
    const divisions = divisionsResult.map((row) => row.division);

    // Fetch distinct schools from the actual students data (scoped)
    const schoolJoinWhere =
      schoolIds.length > 0
        ? `AND st.school_id IN (${schoolIds.join(",")})`
        : "";
    const [schoolsResult] = await db.query(`
      SELECT DISTINCT s.name as school_name 
      FROM students st 
      JOIN schools s ON st.school_id = s.id 
      WHERE s.name IS NOT NULL AND s.name != "" ${schoolJoinWhere}
      ORDER BY s.name ASC
    `);
    const schools = schoolsResult.map((row) => row.school_name);

    res.json({
      success: true,
      students,
      filters: {
        standards,
        divisions,
        schools,
      },
    });
  } catch (err) {
    console.error("FETCH STUDENTS ERROR:", err);
    res.status(500).json({
      success: false,
      message: "Error fetching students",
      error: err.message,
    });
  }
});

app.put("/api/students/:id", async (req, res) => {
  const { id } = req.params;
  const {
    name,
    gender,
    school_name,
    standard,
    division,
    gr_number,
    mq_id,
    status,
  } = req.body;

  if (!name || !school_name || !standard) {
    return res
      .status(400)
      .json({ success: false, message: "Missing required fields" });
  }

  try {
    const [oldRows] = await db.query(
      "SELECT name, std, division FROM students WHERE id = ?",
      [id],
    );
    const oldStudent = oldRows[0] || {};

    // Look up the school ID from name
    const [schoolRows] = await db.query(
      "SELECT id FROM schools WHERE name = ?",
      [school_name],
    );
    const school_id = schoolRows.length > 0 ? schoolRows[0].id : null;

    // Map status string to int
    const statusVal = status === "Active" || status === 1 ? 1 : 0;

    await db.query(
      `UPDATE students SET 
        name = ?, gender = ?, school_id = ?, std = ?, division = ?, 
        roll_number = ?, mq_id = ?, status = ?
       WHERE id = ?`,
      [
        name,
        gender || null,
        school_id,
        standard,
        division || null,
        gr_number || null,
        mq_id || null,
        statusVal,
        id,
      ],
    );

    let changeDetails = [];
    if (oldStudent.std && oldStudent.std !== standard) {
      changeDetails.push(`Standard ${oldStudent.std} → ${standard}`);
    }
    if (oldStudent.division && oldStudent.division !== (division || null)) {
      changeDetails.push(
        `Division ${oldStudent.division || "N/A"} → ${division || "N/A"}`,
      );
    }
    const changeSuffix =
      changeDetails.length > 0 ? `: ${changeDetails.join(", ")}` : "";

    await auditAction(req, {
      page: "Students",
      type: "UPDATE",
      action: `Updated student "${name}" (Student ID: ${id})${changeSuffix} successfully`,
      entity: { type: "Student", id },
    });

    res.json({ success: true, message: "Student updated successfully" });
  } catch (err) {
    console.error("UPDATE STUDENT ERROR:", err);
    res.status(500).json({
      success: false,
      message: "Error updating student",
      error: err.message,
    });
  }
});

// 🗑️ DELETE STUDENT
app.delete("/api/students/:id", async (req, res) => {
  const { id } = req.params;
  try {
    const [stRows] = await db.query("SELECT name FROM students WHERE id = ?", [
      id,
    ]);
    const stName = stRows[0] ? stRows[0].name : null;

    const [result] = await db.query("DELETE FROM students WHERE id = ?", [id]);
    if (result.affectedRows === 0) {
      return res
        .status(404)
        .json({ success: false, message: "Student not found" });
    }

    await auditAction(req, {
      page: "Students",
      type: "DELETE",
      action: `Deleted student ${stName ? `"${stName}" ` : ""}(Student ID: ${id}) successfully`,
      entity: { type: "Student", id },
    });

    res.json({ success: true, message: "Student deleted successfully" });
  } catch (err) {
    console.error("DELETE STUDENT ERROR:", err);
    res.status(500).json({
      success: false,
      message: "Error deleting student",
      error: err.message,
    });
  }
});

// 🎓 GET ALL PARAMETERS

; // stripped /api/parameters


// 🎓 GET GRADING CONFIG

; // stripped /api/grading-config


// 🎓 UPDATE GRADING CONFIG

; // stripped /api/grading-config


// 🎓 CREATE PARAMETER

; // stripped /api/parameters


// 🎓 UPDATE PARAMETER

; // stripped /api/parameters/:id


// 🎓 DELETE PARAMETER

; // stripped /api/parameters/:id


// 🌟 GET TEAM MEMBERS FOR RATING

; // stripped /api/team-members


// ⭐ SUBMIT TEAM RATING

; // stripped /api/rate-team


// ⭐ SUBMIT PRINCIPAL FEEDBACK

; // stripped /api/principal-feedback


// 🗑 DELETE A SINGLE PRINCIPAL FEEDBACK RECORD (Admin / Ops Head / SSGM view)

; // stripped /api/principal-feedback/:id


// 🏫 GET ACTIVE SCHOOLS FOR PRINCIPAL FEEDBACK (Filtered by assigned schools)

; // stripped /api/principal-feedback/schools


// 👤 GET ACTIVE PRINCIPALS WITH ASSIGNED SCHOOL

; // stripped /api/principal-feedback/principals


// 📊 GET ALL PRINCIPAL FEEDBACK (Admin / SSGM View)

; // stripped /api/principal-feedback


/*
// ===== PRINCIPAL AUTOMATE TASK START: ROUTES =====

// ── Principal Feedback Automation (emailed questionnaire flow) ───────────────
// NOTE: registered AFTER /schools and /principals so those static paths keep
// matching first. No scoring, rating or aggregation happens in this flow — the
// submitted answers are stored verbatim.

const PRINCIPAL_FEEDBACK_EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
// Cheap early-reject for junk links. The DB lookup below is a parameterized
// exact match, so this is only a guard, never the security boundary.
const PRINCIPAL_FEEDBACK_TOKEN_PATTERN = /^[a-f0-9-]{16,128}$/i;

// Public base URL the emailed link points at. Falls back to the existing
// public report-card URL so there is a single place to configure per environment.
const getPrincipalFeedbackBaseUrl = () =>
  (
    process.env.PUBLIC_FEEDBACK_URL ||
    process.env.PUBLIC_REPORTCARD_URL ||
    "http://localhost:5173"
  ).replace(/\/+$/, "");

const isValidMonthYear = (value) => {
  const parts = String(value).split(/[-,\s]+/);
  if (parts.length < 2) return false;
  const monthNames = [
    "jan",
    "feb",
    "mar",
    "apr",
    "may",
    "jun",
    "jul",
    "aug",
    "sep",
    "oct",
    "nov",
    "dec",
  ];
  const mIdx = monthNames.findIndex(
    (m) => m === parts[0].toLowerCase().slice(0, 3),
  );
  const yr = parseInt(parts[1], 10);
  return mIdx !== -1 && !isNaN(yr) && yr >= 2000 && yr <= 2100;
};

// ===== PRINCIPAL AUTOMATE TASK: EMAIL START =====

// 📬 SEND PRINCIPAL FEEDBACK REQUEST EMAIL

; // stripped /api/principal-feedback/send-email


// ===== PRINCIPAL AUTOMATE TASK: EMAIL END =====

// ===== PRINCIPAL AUTOMATE TASK: TOKEN START =====

// 🔗 GET PRINCIPAL FEEDBACK REQUEST BY TOKEN (public, unauthenticated)

; // stripped /api/principal-feedback/:token


// ===== PRINCIPAL AUTOMATE TASK: TOKEN END =====

// ===== PRINCIPAL AUTOMATE TASK: FEEDBACK FORM START =====

// 📝 SUBMIT PRINCIPAL FEEDBACK RESPONSES (public, unauthenticated, one-shot)

; // stripped /api/principal-feedback/:token/submit


// ===== PRINCIPAL AUTOMATE TASK: FEEDBACK FORM END =====

// ===== PRINCIPAL AUTOMATE TASK: ROUTES END =====
*/

// 📊 GET PRINCIPAL SCORE (Dashboard View)

; // stripped /api/principal-score


// 🖨️ GET PRINCIPAL SCORE REPORT DATA (Admin-only PDF export source)

; // stripped /api/principal-score-report


// 📊 GET ALL TEAM RATINGS (Admin View)

; // stripped /api/team-ratings


// Helper to get current academic year (e.g., "2025-2026")
const getCurrentAcademicYear = () => {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth(); // 0-11
  // If month is June (5) or later, academic year is currentYear-nextYear
  // Else, it's previousYear-currentYear
  if (month >= 5) {
    return `${year}-${year + 1}`;
  } else {
    return `${year - 1}-${year}`;
  }
};

// 🎓 GET ALL EXAM FORMATS
app.get("/api/exam-formats", async (req, res) => {
  try {
    const { school_id, user_id } = req.query;
    let [formats] = await db.query(
      "SELECT id, test_name, test_title, academic_year FROM fitness_test_formats WHERE is_active = 1 ORDER BY test_name",
    );

    if (school_id) {
      const [schools] = await db.query(
        "SELECT assigned_exam_formats FROM schools WHERE id = ?",
        [school_id],
      );
      if (schools.length > 0 && schools[0].assigned_exam_formats) {
        let assignedIds = [];
        try {
          assignedIds = JSON.parse(schools[0].assigned_exam_formats);
        } catch (e) {
          // Fallback to comma separated
          assignedIds = schools[0].assigned_exam_formats
            .split(",")
            .map((id) => parseInt(id.trim()))
            .filter((id) => !isNaN(id));
        }

        // Convert to array of numbers
        if (Array.isArray(assignedIds)) {
          assignedIds = assignedIds.map(Number);
          formats = formats.filter((f) => assignedIds.includes(f.id));
        } else {
          formats = [];
        }
      } else {
        // If no exams assigned, return empty
        formats = [];
      }
    } else if (user_id) {
      const [userRows] = await db.query(
        "SELECT role_id FROM users WHERE id = ?",
        [user_id],
      );
      if (userRows.length > 0 && String(userRows[0].role_id) !== "1") {
        const [schools] = await db.query(
          `
          SELECT s.assigned_exam_formats 
          FROM schools s
          JOIN assign_school as_s ON s.id = as_s.school_id
          WHERE as_s.user_id = ?
        `,
          [user_id],
        );

        let allAssignedIds = new Set();
        schools.forEach((s) => {
          if (s.assigned_exam_formats) {
            let ids = [];
            try {
              ids = JSON.parse(s.assigned_exam_formats);
            } catch (e) {
              ids = s.assigned_exam_formats
                .split(",")
                .map((id) => parseInt(id.trim()))
                .filter((id) => !isNaN(id));
            }
            if (Array.isArray(ids))
              ids.forEach((id) => allAssignedIds.add(Number(id)));
          }
        });
        formats = formats.filter((f) => allAssignedIds.has(f.id));
      }
    }

    res.json({ success: true, formats });
  } catch (err) {
    console.error("FETCH EXAM FORMATS ERROR:", err);
    res.status(500).json({
      success: false,
      message: "Error fetching exam formats",
      error: err.message,
    });
  }
});

// 🎓 GET SINGLE EXAM FORMAT

; // stripped /api/exam-formats/:id


// 🎓 CREATE EXAM FORMAT
app.post(
  "/api/exam-formats",
  templateUpload.single("background_image"),
  async (req, res) => {
    const { test_name, test_title, academic_year, is_active, parameters } =
      req.body;
    const background_image = req.file
      ? `files/mqreporttemplates/${req.file.filename}`
      : null;

    if (parameters) {
      try {
        const paramsArray = JSON.parse(parameters);
        const seenIds = new Set();
        const seenOrders = new Set();
        for (const p of paramsArray) {
          if (seenIds.has(p.parameter_id)) {
            return res.status(400).json({
              success: false,
              message: "Duplicate parameter selected",
            });
          }
          if (seenOrders.has(p.parameter_order)) {
            return res.status(400).json({
              success: false,
              message: `Duplicate order number ${p.parameter_order} specified`,
            });
          }
          seenIds.add(p.parameter_id);
          seenOrders.add(p.parameter_order);
        }
      } catch (e) {
        return res
          .status(400)
          .json({ success: false, message: "Invalid parameters format" });
      }
    }

    const connection = await db.getConnection();
    await connection.beginTransaction();

    try {
      const [formatResult] = await connection.query(
        "INSERT INTO fitness_test_formats (test_name, test_title, academic_year, background_image, is_active, created_by) VALUES (?, ?, ?, ?, ?, ?)",
        [
          test_name,
          test_title,
          academic_year,
          background_image,
          is_active || 1,
          1,
        ], // Using 1 for created_by
      );
      const newFormatId = formatResult.insertId;

      if (parameters) {
        const paramsArray = JSON.parse(parameters);
        for (const p of paramsArray) {
          await connection.query(
            "INSERT INTO fitness_test_format_parameters (format_id, parameter_id, parameter_order, is_required) VALUES (?, ?, ?, ?)",
            [newFormatId, p.parameter_id, p.parameter_order, p.is_required],
          );
        }
      }

      await connection.commit();
      res.json({
        success: true,
        message: "Exam format created successfully",
        id: newFormatId,
      });
    } catch (err) {
      await connection.rollback();
      console.error("CREATE EXAM FORMAT ERROR:", err);
      res
        .status(500)
        .json({ success: false, message: "Error creating exam format" });
    } finally {
      connection.release();
    }
  },
);

// 🎓 UPDATE EXAM FORMAT

; // stripped /api/exam-formats/:id


// 🎓 DELETE EXAM FORMAT

; // stripped /api/exam-formats/:id


app.get("/api/exam-formats", async (req, res) => {
  try {
    const [rows] = await db.query(`
            SELECT id, test_name, test_title, academic_year
            FROM fitness_test_formats 
            WHERE is_active = 1 
            ORDER BY test_name
        `);

    res.json({ success: true, formats: rows });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

/* ======================================================
   2. FILTERS
====================================================== */
app.get("/api/fill-marks/filters", async (req, res) => {
  const { school_id, user_id } = req.query;

  try {
    // Determine assigned schools for this user
    let schoolIds = [];
    let restrictSchools = false;
    if (user_id) {
      const [[user]] = await db.query(
        "SELECT role_id FROM users WHERE id = ?",
        [user_id],
      );
      if (
        user &&
        user.role_id !== 1 &&
        user.role_id !== 7 &&
        user.role_id !== 2
      ) {
        restrictSchools = true;
        const [assignments] = await db.query(
          "SELECT school_id FROM assign_school WHERE user_id = ?",
          [user_id],
        );
        schoolIds = assignments.map((a) => a.school_id);
      }
    }

    let schools = [];
    if (!restrictSchools) {
      const [allSchools] = await db.query(
        "SELECT id, name FROM schools ORDER BY name",
      );
      schools = allSchools;
    } else if (schoolIds.length > 0) {
      const [assignedSchools] = await db.query(
        `SELECT id, name FROM schools WHERE id IN (${schoolIds.join(",")}) ORDER BY name`,
      );
      schools = assignedSchools;
    }

    // Standards scoped to the students actually enrolled in the selected
    // school (same behaviour as the Student Directory)
    let standards = [];
    if (school_id) {
      const [studentStds] = await db.query(
        "SELECT DISTINCT std FROM students WHERE school_id = ? AND std IS NOT NULL AND std != '' ORDER BY std",
        [school_id],
      );
      standards = studentStds.map((s) => ({ id: s.std, name: s.std }));
    } else {
      const [allStds] = await db.query(
        "SELECT DISTINCT std FROM students WHERE std IS NOT NULL AND std != '' ORDER BY std",
      );
      standards = allStds.map((s) => ({ id: s.std, name: s.std }));
    }

    // Divisions scoped to the students actually enrolled in the selected school
    let divisions = [];
    if (school_id) {
      const [studentDivisions] = await db.query(
        "SELECT DISTINCT division FROM students WHERE school_id = ? AND division IS NOT NULL AND division != '' ORDER BY division",
        [school_id],
      );
      divisions = studentDivisions.map((d) => d.division);
    } else {
      const [allDivisions] = await db.query(
        "SELECT DISTINCT division FROM students WHERE division IS NOT NULL AND division != '' ORDER BY division",
      );
      divisions = allDivisions.map((d) => d.division);
      if (divisions.length === 0) {
        divisions = ["A", "B", "C", "D", "E", "F", "G", "H"];
      }
    }
    const terms = ["Term 1", "Term 2"];

    res.json({
      success: true,
      filters: { schools, standards, divisions, terms },
    });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

/* ======================================================
   3. FORMAT PARAMETERS
====================================================== */
app.get("/api/fill-marks/format/:id", async (req, res) => {
  try {
    const [rows] = await db.query(
      `
            SELECT 
                fp.parameter_id AS id,
                fp.parameter_order,
                fp.is_required,
                pi.title, 
                pi.ctype, 
                pi.description,
                pi.test_display
            FROM fitness_test_format_parameters fp
            JOIN parameter_info pi ON fp.parameter_id = pi.id
            WHERE fp.format_id = ?
            ORDER BY fp.parameter_order
        `,
      [req.params.id],
    );

    // Pre-primary params (259–264) are Yes/No inputs handled in code
    const parameters = rows.map((r) =>
      isPrePrimaryYesNoParam(r) ? { ...r, ctype: "Yes/No" } : r,
    );

    res.json({ success: true, parameters });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

/* ======================================================
   4. STUDENTS + MARKS + RANGES
====================================================== */
app.get("/api/fill-marks/students", async (req, res) => {
  const { school_id, std, division, format_id, term } = req.query;
  if (!school_id || !std || !division || !format_id || !term) {
    return res.json({ success: false, error: "Missing required parameters" });
  }

  // Normalize term
  let normalizedTerm = term;
  if (term === "Term 1" || term === "1") normalizedTerm = "term1";
  else if (term === "Term 2" || term === "2") normalizedTerm = "term2";

  try {
    /* ---------- 1. STUDENTS ---------- */
    const [allStudents] = await db.query(
      `
            SELECT a.*, b.name as school_name
            FROM students a
            LEFT JOIN schools b ON a.school_id = b.id
            WHERE a.school_id = ?
            AND a.division = ?
            ORDER BY a.id
        `,
      [school_id, division],
    );

    // Helper function to map student's raw std to std_code
    const getStdCode = (stdVal) => {
      if (!stdVal) return 0;
      const clean = String(stdVal).trim().toLowerCase();
      if (clean === "nursery") return 1;
      if (clean.includes("junior") || clean.includes("jr") || clean === "jkg")
        return 2;
      if (clean.includes("senior") || clean.includes("sr") || clean === "skg")
        return 13;

      const romanOrNumericMap = {
        i: 3,
        1: 3,
        "1st": 3,
        ii: 4,
        2: 4,
        "2nd": 4,
        iii: 5,
        3: 5,
        "3rd": 5,
        iv: 6,
        4: 6,
        "4th": 6,
        v: 7,
        5: 7,
        "5th": 7,
        vi: 8,
        6: 8,
        "6th": 8,
        vii: 9,
        7: 9,
        "7th": 9,
        viii: 10,
        8: 10,
        "8th": 10,
        ix: 11,
        9: 11,
        "9th": 11,
        x: 12,
        10: 12,
        "10th": 12,
      };
      if (romanOrNumericMap[clean]) return romanOrNumericMap[clean];
      const match = clean.match(/\d+/);
      if (match) {
        const num = parseInt(match[0]);
        if (num >= 1 && num <= 10) return num + 2;
      }
      return parseInt(stdVal) || 0;
    };

    const targetStdCode = getStdCode(std);
    const targetStd = String(std).trim().toLowerCase();
    const students = allStudents.filter(
      (s) => String(s.std).trim().toLowerCase() === targetStd,
    );

    if (students.length === 0) {
      return res.json({ success: true, students: [], ranges: [] });
    }

    const studentIds = students.map((s) => s.id);

    /* ---------- 2. PARAMETERS ---------- */
    const [params] = await db.query(
      `
            SELECT fp.parameter_id, pi.title, pi.ctype, pi.parameter, pi.test_display
            FROM fitness_test_format_parameters fp
            JOIN parameter_info pi ON fp.parameter_id = pi.id
            WHERE fp.format_id = ?
        `,
      [format_id],
    );

    /* ---------- 3. EXISTING MARKS ---------- */
    const [results] = await db.query(
      `
            SELECT ftr.student_id, ftrv.parameter_id, ftrv.parameter_value
            FROM fitness_test_results ftr
            LEFT JOIN fitness_test_result_values ftrv 
                ON ftr.id = ftrv.result_id
            WHERE ftr.format_id = ?
            AND ftr.term = ?
            AND ftr.student_id IN (?)
        `,
      [format_id, normalizedTerm, studentIds],
    );

    const marksMap = {};

    results.forEach((r) => {
      if (!marksMap[r.student_id]) {
        marksMap[r.student_id] = {};
      }

      let value = r.parameter_value;

      const param = params.find((p) => p.parameter_id == r.parameter_id);

      // YES/NO conversion (same as PHP)
      if (
        param &&
        (["yes/no", "Yes/No", "boolean", "Boolean"].includes(param.ctype) ||
          isPrePrimaryYesNoParam(param))
      ) {
        if (value === "1.00") value = "Yes";
        if (value === "0.00") value = "No";
      }

      marksMap[r.student_id][r.parameter_id] = value;
    });

    /* ---------- 4. ATTACH MARKS ---------- */
    const finalStudents = students.map((s) => ({
      ...s,
      marks: marksMap[s.id] || {},
    }));

    /* ---------- 5. PARAMETER RANGES (From parameter_grades) ---------- */
    let ranges = [];

    if (params.length > 0) {
      // Build a composite key map: (parameter + test_display) -> parameter_id
      const comboToParamId = {};
      const allParamKeys = [];

      params.forEach((p) => {
        if (p.parameter) {
          const paramKey = p.parameter;
          const testDispKey = (p.test_display || "").trim();
          const composite = `${paramKey}||${testDispKey}`;
          comboToParamId[composite] = p.parameter_id;
          if (!allParamKeys.includes(paramKey)) allParamKeys.push(paramKey);
        }
      });

      if (allParamKeys.length > 0) {
        // Query all grades for these parameters and specific standard AND standard 0
        let query = `SELECT * FROM parameter_grades WHERE parameter IN (?) AND std IN (?, 0) ORDER BY std DESC`;

        const [rangeRows] = await db.query(query, [
          allParamKeys,
          targetStdCode,
        ]);

        ranges = [];
        const usedParamIds = new Set();

        for (const row of rangeRows) {
          // Try matching with test_display exact match first
          const rowTestDisp = (row.test_display || "").trim();
          const compositeExact = `${row.parameter}||${rowTestDisp}`;
          let paramId = comboToParamId[compositeExact];

          // Fallback: match by parameter only (for legacy entries without test_display)
          if (!paramId) {
            for (const key in comboToParamId) {
              if (key.startsWith(`${row.parameter}||`)) {
                paramId = comboToParamId[key];
                break;
              }
            }
          }

          if (
            paramId &&
            !usedParamIds.has(
              `${paramId}-${row.std}-${row.gender}-${row.grade}`,
            )
          ) {
            ranges.push({
              ...row,
              parameter_id: paramId,
            });
            usedParamIds.add(
              `${paramId}-${row.std}-${row.gender}-${row.grade}`,
            );
          }
        }
      }
    }

    res.json({
      success: true,
      students: finalStudents,
      ranges,
    });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

/* ======================================================
   5. SAVE MARKS (PHP Parity)
====================================================== */
/* ======================================================
   4b. PRINTABLE TEMPLATE + PHOTO SCAN (mobile app)
====================================================== */
const fmSelf = (p) => `http://127.0.0.1:3000${p}`;
const fmEsc = (v) => String(v ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const fmIsYesNo = (p) => ["yes/no", "boolean", "y/n", "true/false", "t/f"].includes(String(p.ctype || "").toLowerCase());
async function fmLoadSheet(q) {
  const { school_id, std, division, format_id, term } = q;
  const qs = new URLSearchParams({ school_id, std, division, format_id, term }).toString();
  const [pr, sr] = await Promise.all([
    fetch(fmSelf(`/api/fill-marks/format/${encodeURIComponent(format_id)}`)).then((r) => r.json()),
    fetch(fmSelf(`/api/fill-marks/students?${qs}`)).then((r) => r.json()),
  ]);
  if (!pr.success || !sr.success) throw new Error(pr.error || sr.error || "Could not load sheet");
  const students = [...sr.students].sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
  return { params: pr.parameters || [], students };
}

// GET /api/fill-marks/template?school_id&std&division&format_id&term -> printable HTML sheet
app.get("/api/fill-marks/template", async (req, res) => {
  try {
    const { params, students } = await fmLoadSheet(req.query);
    const [[fmt]] = await db.query("SELECT test_name FROM fitness_test_formats WHERE id = ?", [req.query.format_id]);
    const [[sch]] = await db.query("SELECT name FROM schools WHERE id = ?", [req.query.school_id]);
    const head = params.map((p) => `<th>${fmEsc(p.title)}${p.test_display ? `<small>${fmEsc(p.test_display)}</small>` : ""}${fmIsYesNo(p) ? "<small>Y / N</small>" : ""}</th>`).join("");
    const rows = students.map((s, i) => `<tr><td class="n">${i + 1}</td><td class="id">${fmEsc(s.mq_id || "-")}</td><td class="nm">${fmEsc(s.name)}</td>${params.map(() => "<td></td>").join("")}</tr>`).join("");
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Marks sheet</title><style>
@page{size:A4 landscape;margin:10mm}body{font-family:Arial,sans-serif;color:#0F1A14;margin:16px}
h1{font-size:18px;margin:0;color:#1E8E3E}.meta{font-size:13px;margin:4px 0 10px}
.tip{font-size:11px;color:#475569;margin-bottom:8px}table{border-collapse:collapse;width:100%;table-layout:fixed}
th,td{border:1.5px solid #333;padding:0 6px;height:34px;font-size:13px}th{background:#E8F5EC;font-size:11px;height:auto;padding:6px}
th small{display:block;font-weight:normal;color:#475569}td.n{width:28px;text-align:center;font-weight:bold}
td.id{width:90px;font-family:monospace;font-weight:bold}td.nm{width:200px}
.btn{position:fixed;right:16px;top:12px;background:#1E8E3E;color:#fff;border:0;border-radius:20px;padding:10px 18px;font-size:14px}
@media print{.btn{display:none}body{margin:0}}</style></head><body>
<button class="btn" onclick="window.print()">Print / Save PDF</button>
<h1>${fmEsc(fmt?.test_name || "Marks sheet")}</h1>
<div class="meta">${fmEsc(sch?.name || "")} &middot; Class ${fmEsc(req.query.std)} - ${fmEsc(req.query.division)} &middot; ${fmEsc(req.query.term)} &middot; Date: ____________</div>
<div class="tip">Write one clear number in each box. Leave a box empty if the test was not done. Keep the row numbers and MQ IDs visible when you take the photo.</div>
<table><thead><tr><th>#</th><th>MQ ID</th><th>Student</th>${head}</tr></thead><tbody>${rows}</tbody></table></body></html>`);
  } catch (err) {
    res.status(500).send(`Could not build the sheet: ${fmEsc(err.message)}`);
  }
});

// Offline OCR fallback (tesseract.js): rows anchored on printed MQ IDs, numbers clustered into columns by x position.
async function fmTesseractRows(buf, params) {
  const { createWorker } = require("tesseract.js");
  const worker = await createWorker("eng");
  try {
    const { data } = await worker.recognize(buf, {}, { blocks: true });
    const words = [];
    (data.blocks || []).forEach((b) => (b.paragraphs || []).forEach((p) => (p.lines || []).forEach((l) => (l.words || []).forEach((w) => words.push(w)))));
    const cy = (w) => (w.bbox.y0 + w.bbox.y1) / 2, cx = (w) => (w.bbox.x0 + w.bbox.x1) / 2;
    const anchors = words.filter((w) => /^MQ-?\d+/i.test(w.text.trim())).sort((a, b) => cy(a) - cy(b));
    if (!anchors.length) return [];
    const gaps = anchors.slice(1).map((a, i) => cy(a) - cy(anchors[i])).sort((a, b) => a - b);
    const rowH = gaps.length ? gaps[Math.floor(gaps.length / 2)] : anchors[0].bbox.y1 - anchors[0].bbox.y0 + 20;
    const nameWords = words.filter((w) => /^(student|name)$/i.test(w.text.trim()));
    const minX = Math.max(...anchors.map((a) => a.bbox.x1)) + (nameWords.length ? Math.max(0, nameWords[0].bbox.x1 - anchors[0].bbox.x1) + 40 : 160);
    const nums = words.filter((w) => /^\d+([.,]\d+)?$/.test(w.text.trim()) && cx(w) > minX && cy(w) > cy(anchors[0]) - rowH / 2);
    const xs = nums.map(cx).sort((a, b) => a - b);
    const k = params.length;
    let cents = xs.length ? Array.from({ length: k }, (_, i) => xs[0] + ((xs[xs.length - 1] - xs[0]) * i) / Math.max(1, k - 1)) : [];
    for (let it = 0; it < 25 && xs.length; it++) {
      const groups = cents.map(() => []);
      xs.forEach((x) => { let bi = 0; cents.forEach((c2, i) => { if (Math.abs(x - c2) < Math.abs(x - cents[bi])) bi = i; }); groups[bi].push(x); });
      cents = cents.map((c2, i) => (groups[i].length ? groups[i].reduce((a, b) => a + b, 0) / groups[i].length : c2));
    }
    const filledCols = new Set(nums.map((w) => cents.reduce((bi, c2, i) => (Math.abs(cx(w) - c2) < Math.abs(cx(w) - cents[bi]) ? i : bi), 0)));
    const colPenalty = filledCols.size === k ? 1 : 0.5; // some columns empty everywhere -> column mapping is a guess
    return anchors.map((a, ri) => ({
      row: ri + 1,
      mq_id: a.text.trim().replace(/^MQ-?/i, "MQ-"),
      values: nums.filter((w) => Math.abs(cy(w) - cy(a)) < rowH * 0.45).map((w) => {
        const ci = cents.reduce((bi, c2, i) => (Math.abs(cx(w) - c2) < Math.abs(cx(w) - cents[bi]) ? i : bi), 0);
        return { parameter_id: params[ci].id, value: w.text.trim().replace(",", "."), confidence: (w.confidence / 100) * colPenalty };
      }),
    }));
  } finally { await worker.terminate(); }
}

// POST /api/fill-marks/scan multipart { photo, school_id, std, division, format_id, term }
// -> { marks: [{ student_id, parameter_id, value, confidence }], unmatched: [{ label, values }] }. Never saves.
const fmScanUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 12 * 1024 * 1024 } });
app.post("/api/fill-marks/scan", fmScanUpload.single("photo"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, message: "Please attach a photo of the sheet." });
    const { params, students } = await fmLoadSheet(req.body);
    if (!students.length || !params.length) return res.json({ success: false, message: "No students or test parameters for this selection." });

    const roster = students.map((s, i) => `${i + 1} | ${s.mq_id || "-"} | ${s.name}`).join("\n");
    const cols = params.map((p) => `${p.id} | ${p.title}${p.test_display ? ` (${p.test_display})` : ""} | ${fmIsYesNo(p) ? "Yes/No" : "number"}`).join("\n");
    const prompt = `You are reading a photo of a handwritten school fitness marks sheet.
Rows on the printed sheet (row number | MQ ID | student name):
${roster}

Mark columns, left to right after the name (parameter_id | title | type):
${cols}

Read every handwritten value. Return JSON only:
{"rows":[{"row":<printed row number>,"mq_id":"<as printed>","name":"<as printed>","values":[{"parameter_id":<id>,"value":"<number, or Yes/No>","confidence":<0..1>}]}]}
Rules: skip empty boxes; use a dot for decimals; for Yes/No columns read ticks/Y as Yes and crosses/N as No; give a low confidence (<0.7) when the writing is unclear, overwritten, or you are unsure which row or column it belongs to. Do not guess values that are not written.`;

    let parsed = {}, engine = "gemini";
    try {
    if (!process.env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY not set");
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    const out = await ai.models.generateContent({
      model: process.env.GEMINI_VISION_MODEL || "gemini-2.5-flash",
      contents: [{ role: "user", parts: [{ inlineData: { mimeType: req.file.mimetype || "image/jpeg", data: req.file.buffer.toString("base64") } }, { text: prompt }] }],
      config: { responseMimeType: "application/json", temperature: 0 },
    });
    parsed = JSON.parse(String(out.text || "{}").replace(/^```json\s*|```$/g, ""));
    } catch (e) {
      console.warn("FILL MARKS SCAN: vision model unavailable, using tesseract fallback:", e.status || "", String(e.message || "").slice(0, 80));
      engine = "tesseract";
      parsed = { rows: await fmTesseractRows(req.file.buffer, params) };
    }

    const norm = (v) => String(v || "").trim().toLowerCase().replace(/\s+/g, " ");
    const paramIds = new Set(params.map((p) => Number(p.id)));
    const marks = [];
    const unmatched = [];
    const used = new Set();
    for (const r of parsed.rows || []) {
      let st = null, how = "";
      if (r.mq_id && r.mq_id !== "-") { st = students.find((s) => s.mq_id && norm(s.mq_id) === norm(r.mq_id)); how = "id"; }
      if (!st && r.name) { st = students.find((s) => norm(s.name) === norm(r.name)); how = "name"; }
      if (!st && Number(r.row) >= 1 && Number(r.row) <= students.length) { st = students[Number(r.row) - 1]; how = "row"; }
      const vals = (r.values || []).filter((v) => paramIds.has(Number(v.parameter_id)) && v.value !== "" && v.value != null);
      if (!st || used.has(st.id)) { unmatched.push({ label: `${r.row ?? "?"} ${r.name || r.mq_id || ""}`.trim(), values: vals }); continue; }
      used.add(st.id);
      for (const v of vals) {
        const p = params.find((x) => Number(x.id) === Number(v.parameter_id));
        let value = String(v.value).trim();
        let conf = Math.max(0, Math.min(1, Number(v.confidence) || 0));
        if (fmIsYesNo(p)) { value = /^(y|yes|1|true|✓)/i.test(value) ? "Yes" : /^(n|no|0|false|x)/i.test(value) ? "No" : value; }
        else { const n = Number(value.replace(",", ".")); if (!Number.isFinite(n)) conf = Math.min(conf, 0.3); else value = String(n); }
        if (how === "row") conf = Math.min(conf, 0.6); // matched only by position
        marks.push({ student_id: st.id, parameter_id: Number(v.parameter_id), value, confidence: conf });
      }
    }
    res.json({ success: true, engine, marks, unmatched, rows_read: (parsed.rows || []).length });
  } catch (err) {
    console.error("FILL MARKS SCAN ERROR:", err);
    res.status(500).json({ success: false, message: "Could not read the photo. Try a clearer, straight photo." });
  }
});

app.post("/api/fill-marks/save", async (req, res) => {
  const {
    format_id,
    school_id,
    std,
    division,
    term,
    entry_mode = "division",
    examiner_name = "",
    examiner_signature_id = 0,
    marks = [],
    partial_save = false,
  } = req.body;

  // ── 1. Normalize term ──
  let normalizedTerm = term;
  if (term === "Term 1" || term === "1") normalizedTerm = "term1";
  else if (term === "Term 2" || term === "2") normalizedTerm = "term2";

  // ── 2. Validate ──
  if (!format_id || !school_id || !normalizedTerm || marks.length === 0) {
    return res.json({ success: false, message: "Missing required parameters" });
  }
  if (!["term1", "term2"].includes(normalizedTerm)) {
    return res.json({
      success: false,
      message: `Invalid term: ${normalizedTerm}`,
    });
  }

  // ── 2b. ROSTER AUTHORITY ──
  // The roster selected in the Fill Marks UI is authoritative. Marks may only be
  // written for students that belong to the selected school / standard / division.
  // Mirrors the roster query in GET /api/fill-marks/students (:7249-7316).
  if (!std || !division) {
    return res.json({
      success: false,
      message: "Missing required parameters",
    });
  }

  const requestedStudentIds = [
    ...new Set(marks.map((m) => parseInt(m.student_id)).filter(Boolean)),
  ];
  if (requestedStudentIds.length === 0) {
    return res.json({
      success: false,
      message: "No valid students to save",
    });
  }

  const [rosterRows] = await db.query(
    `SELECT id FROM students
     WHERE school_id = ?
       AND division = ?
       AND LOWER(TRIM(std)) = LOWER(TRIM(?))
       AND id IN (?)`,
    [school_id, division, String(std), requestedStudentIds],
  );

  const rosterIds = new Set(rosterRows.map((r) => r.id));
  const rejectedIds = requestedStudentIds.filter((id) => !rosterIds.has(id));

  if (rejectedIds.length > 0) {
    return res.json({
      success: false,
      message: `Save rejected: ${rejectedIds.length} student(s) do not belong to the selected school / standard / division. Only existing roster students can receive marks.`,
      rejected_student_ids: rejectedIds,
    });
  }

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    // ── 3. Fetch format info ──
    const [[format]] = await conn.query(
      "SELECT * FROM fitness_test_formats WHERE id = ? AND is_active = 1",
      [format_id],
    );
    if (!format) {
      conn.release();
      return res.json({
        success: false,
        message: "Test format not found or inactive",
      });
    }
    const academic_year = format.academic_year || getCurrentAcademicYear();

    // ── 4. Fetch format parameters (for Yes/No detection) ──
    const [params] = await conn.query(
      `
      SELECT fp.parameter_id, pi.title, pi.ctype
      FROM fitness_test_format_parameters fp
      JOIN parameter_info pi ON fp.parameter_id = pi.id
      WHERE fp.format_id = ?
    `,
      [format_id],
    );

    const paramMap = {};
    params.forEach((p) => {
      paramMap[p.parameter_id] = p;
    });

    // ── 5. Group marks by student ──
    const studentMarks = {};
    marks.forEach((m) => {
      const sid = parseInt(m.student_id);
      const pid = parseInt(m.parameter_id);
      if (!sid || !pid) return;
      if (!studentMarks[sid]) studentMarks[sid] = [];
      studentMarks[sid].push({ parameter_id: pid, value: m.value });
    });

    let savedCount = 0;
    let savedItems = [];
    const testDate = new Date().toISOString().slice(0, 10);

    // ── 6. Process each student ──
    for (const [studentIdStr, marksData] of Object.entries(studentMarks)) {
      const studentId = parseInt(studentIdStr);

      // Check if result already exists for this student + format + term + academic_year
      const [existingRows] = await conn.query(
        `SELECT id FROM fitness_test_results
         WHERE format_id = ? AND student_id = ? AND academic_year = ? AND term = ?`,
        [format_id, studentId, academic_year, normalizedTerm],
      );

      let resultId;

      if (existingRows.length > 0) {
        // ── UPDATE existing result ──
        resultId = existingRows[0].id;
        await conn.query(
          `UPDATE fitness_test_results SET examiner_name = ?, examiner_signature_id = ?, updated_at = NOW() WHERE id = ?`,
          [examiner_name, examiner_signature_id || null, resultId],
        );

        // Delete existing parameter values for clean re-insert
        await conn.query(
          "DELETE FROM fitness_test_result_values WHERE result_id = ?",
          [resultId],
        );
      } else {
        // ── INSERT new result ──
        const reportKey =
          "FT_" +
          testDate.replace(/-/g, "") +
          "_" +
          Math.random().toString(16).slice(2, 10).toUpperCase();
        const [insertRes] = await conn.query(
          `INSERT INTO fitness_test_results
           (format_id, student_id, academic_year, term, test_date, examiner_id, examiner_name, examiner_signature_id, report_key)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            format_id,
            studentId,
            academic_year,
            normalizedTerm,
            testDate,
            0,
            examiner_name,
            examiner_signature_id || null,
            reportKey,
          ],
        );
        resultId = insertRes.insertId;
      }

      // ── 7. Insert parameter values ──
      // Deduplicate by parameter_id
      const seen = {};
      const uniqueMarks = [];
      marksData.forEach((m) => {
        if (!seen[m.parameter_id]) {
          uniqueMarks.push(m);
          seen[m.parameter_id] = true;
        }
      });

      for (const mark of uniqueMarks) {
        let storageValue = mark.value;

        const paramInfo = paramMap[mark.parameter_id];
        const isYesNo =
          paramInfo &&
          (["yes/no", "boolean", "y/n", "true/false", "t/f"].includes(
            (paramInfo.ctype || "").toLowerCase(),
          ) ||
            isPrePrimaryYesNoParam(paramInfo));

        if (!isYesNo) {
          if (
            storageValue === "" ||
            storageValue === null ||
            storageValue === undefined
          )
            continue;

          const numeric = Number(storageValue);

          if (!Number.isFinite(numeric)) {
            throw new Error(
              `Invalid numeric mark for parameter "${paramInfo ? paramInfo.title : mark.parameter_id
              }": ${JSON.stringify(storageValue)}`
            );
          }

          storageValue = String(numeric);
        }

        // Yes/No → 1/0 conversion
        if (isYesNo) {
          if (
            storageValue === "" ||
            storageValue === null ||
            storageValue === undefined
          ) {
            storageValue = null; // NA stays NULL so it reloads as NA, not default YES
          } else if (String(storageValue).toLowerCase() === "yes")
            storageValue = "1";
          else if (String(storageValue).toLowerCase() === "no")
            storageValue = "0";
        }

        await conn.query(
          `INSERT INTO fitness_test_result_values (result_id, parameter_id, parameter_value, created_at)
           VALUES (?, ?, ?, NOW())`,
          [resultId, mark.parameter_id, storageValue],
        );

        savedItems.push({
          student_id: studentId,
          parameter_id: mark.parameter_id,
        });
      }

      savedCount++;
    }

    await conn.commit();

    await auditAction(req, {
      page: "Exams",
      type: "SAVE",
      action: `Saved test marks for "${format.test_name || "Exam"}" (${normalizedTerm}, ${std || "N/A"} ${division || ""}, ${savedCount} student(s), school #${school_id})`,
      entity: { type: "School", id: school_id },
    });

    const message = partial_save
      ? `Progress saved! ${savedItems.length} parameter values saved.`
      : `Successfully saved marks for ${savedCount} students.`;

    res.json({
      success: true,
      message,
      saved_count: savedCount,
      format_name: format.test_name,
      academic_year,
    });
  } catch (err) {
    await conn.rollback();
    console.error("SAVE FILL-MARKS ERROR:", err);
    res.json({ success: false, error: err.message });
  } finally {
    conn.release();
  }
});

// 🎓 GET STANDARDS

; // stripped /api/standards


// 🎓 GET PARAMETER GRADES

; // stripped /api/parameter-grades


// 🎓 POST PARAMETER GRADES

; // stripped /api/parameter-grades/save


// 🎓 GRADING HELPER (PHP Parity)
function calculateGrade(value, ranges) {
  if (
    value === null ||
    value === "" ||
    value === "AB" ||
    value === "ab" ||
    value === "Ab"
  ) {
    return "AB";
  }
  if (value === "NA" || value === "na" || value === "Na") {
    return "NA";
  }
  const val = parseFloat(value);
  if (isNaN(val)) return "--";

  if (!ranges || ranges.length === 0) {
    return "--";
  }

  for (const range of ranges) {
    if (val >= range.min_score && val <= range.max_score) {
      return range.grade;
    }
  }
  return "--";
}

// ⭐ PRE-PRIMARY YES/NO GRADING (code-level, format 41 params 259–264)
const PRE_PRIMARY_PARAM_IDS = [259, 260, 261, 262, 263, 264];

function getParamId(param) {
  if (!param) return null;
  return Number(param.id || param.parameter_id || null);
}

function isPrePrimaryYesNoParam(param) {
  const pid = getParamId(param);
  return pid && PRE_PRIMARY_PARAM_IDS.includes(pid);
}

// Yes → A+ (Excellent), No → B (Needs Improvement), NA → N/A
function gradeYesNo(value) {
  if (
    value === null ||
    value === "" ||
    value === "AB" ||
    value === "ab" ||
    value === "Ab"
  ) {
    return "--";
  }
  const val = parseFloat(value);
  if (isNaN(val)) return "--";
  if (val === 1) return "A+";
  if (val === 0) return "B";
  return "--";
}

// 🎓 GET STUDENTS FOR REPORT CARD
app.get("/api/reports/students", async (req, res) => {
  try {
    const { school_id, std, division, academic_year, term } = req.query;

    // Build WHERE clause once — used safely for both count + main query
    let whereClause = "WHERE 1=1";
    const params = [];
    if (school_id) { whereClause += " AND s.school_id = ?"; params.push(school_id); }
    if (std) { whereClause += " AND s.std = ?"; params.push(std); }
    if (division) { whereClause += " AND s.division = ?"; params.push(division); }
    if (academic_year) { whereClause += " AND ftr.academic_year = ?"; params.push(academic_year); }
    if (term) {
      let normalizedTerm = term;
      if (term === "1") normalizedTerm = "term1";
      if (term === "2") normalizedTerm = "term2";
      whereClause += " AND ftr.term = ?";
      params.push(normalizedTerm);
    }

    // ── Pagination ──
    const limit = parseInt(req.query.limit) || 10000;
    const offset = parseInt(req.query.offset) || 0;

    // Count query
    const countQuery = `SELECT COUNT(DISTINCT s.id) as total FROM students s JOIN fitness_test_results ftr ON s.id = ftr.student_id ${whereClause}`;
    const [[{ total }]] = await db.query(countQuery, params);

    // Main query — GROUP BY to avoid duplicate rows per student (term1 & term2)
    const mainQuery = `
      SELECT s.id, s.name, s.mq_id, s.std, s.division, MAX(ftr.id) as result_id
      FROM students s
      JOIN fitness_test_results ftr ON s.id = ftr.student_id
      ${whereClause}
      GROUP BY s.id, s.name, s.mq_id, s.std, s.division
      ORDER BY s.name ASC
      LIMIT ? OFFSET ?
    `;
    const [rows] = await db.query(mainQuery, [...params, limit, offset]);
    res.json({ success: true, students: rows, total });
  } catch (err) {
    console.error("REPORTS/STUDENTS ERROR:", err.message, err.sql || "");
    res.status(500).json({ success: false, error: err.message });
  }
});

// 📊 GET /api/reports/counts → generated report counts per school

; // stripped /api/reports/counts


// 📊 GET /api/reports/fitness-data/:result_id  →  FitnessReportData format for admin (no OTP)
//   Returns the exact same JSON shape that the QR-scan data endpoint returns, so the frontend
//   can use the same Plotly chart builders (generateFitnessReportPdfGraphs) to render graphs,
//   then POST them back to /api/reports/detail-pdf/:result_id.
app.get("/api/reports/fitness-data/:result_id", async (req, res) => {
  try {
    const resultId = Number(req.params.result_id);
    if (!resultId) return res.status(400).json({ success: false, message: "Invalid result_id" });

    // ── Fetch result + student ──
    const [[result]] = await db.query(
      `SELECT ftr.id, ftr.format_id, ftr.term, ftr.academic_year, ftr.student_id,
              s.name, s.mq_id, s.std, s.division, s.gender, s.id AS sid
       FROM fitness_test_results ftr
       JOIN students s ON ftr.student_id = s.id
       WHERE ftr.id = ?`,
      [resultId],
    );
    if (!result) return res.status(404).json({ success: false, message: "Result not found" });

    const student = { id: result.sid, name: result.name, mq_id: result.mq_id, std: result.std, division: result.division, gender: result.gender };

    // ── All term rows for this student/format/year ──
    const [termRows] = await db.query(
      `SELECT id, term, academic_year, test_date, examiner_name, pdf_file_name, pdf_status
       FROM fitness_test_results
       WHERE student_id = ? AND format_id = ? AND academic_year = ?
       ORDER BY id`,
      [result.student_id, result.format_id, result.academic_year],
    );
    const byTerm = {};
    for (const row of termRows) {
      const t = String(row.term || "").trim().toLowerCase().replace(/\s+/g, "");
      if (t === "term1" || t === "term2") byTerm[t] = row;
    }
    const term1Row = byTerm.term1 || null;
    const term2Row = byTerm.term2 || null;

    // ── Format parameters ──
    const [paramRows] = await db.query(
      `SELECT pi.id AS parameter_id, pi.title, pi.description, pi.video_link, pi.ctype, pi.clabel,
              pi.chart_format, pi.chart_heading, pi.parameter AS parameter_key,
              pi.test_display, fp.id AS fp_id, fp.parameter_order, fp.is_required
       FROM fitness_test_format_parameters fp
       JOIN parameter_info pi ON fp.parameter_id = pi.id
       WHERE fp.format_id = ?
       ORDER BY fp.parameter_order`,
      [result.format_id],
    );

    // ── Values for both terms ──
    const termIds = [term1Row && term1Row.id, term2Row && term2Row.id].filter(Boolean);
    const valueMap = {};
    if (termIds.length) {
      const [valueRows] = await db.query(
        `SELECT result_id, parameter_id, parameter_value FROM fitness_test_result_values WHERE result_id IN (${termIds.map(() => "?").join(",")})`,
        termIds,
      );
      for (const v of valueRows) {
        if (!valueMap[v.result_id]) valueMap[v.result_id] = {};
        valueMap[v.result_id][v.parameter_id] = v.parameter_value;
      }
    }
    const valueOf = (row, pid) => {
      if (!row) return 0;
      const pv = valueMap[row.id] && valueMap[row.id][pid];
      const n = Number(pv);
      return (pv === undefined || pv === null || !Number.isFinite(n)) ? 0 : n;
    };

    // ── Class averages ──
    const [avgRows] = await db.query(
      `SELECT ftrv.parameter_id,
              ROUND(AVG(CASE WHEN ftr.term = 'term1' THEN ftrv.parameter_value END), 2) AS term1_avg,
              ROUND(AVG(CASE WHEN ftr.term = 'term2' THEN ftrv.parameter_value END), 2) AS term2_avg
       FROM fitness_test_results ftr
       JOIN fitness_test_result_values ftrv ON ftr.id = ftrv.result_id
       JOIN students s ON s.id = ftr.student_id
       WHERE s.std = ? AND s.division = ? AND ftr.format_id = ? AND ftr.term IN ('term1','term2')
       GROUP BY ftrv.parameter_id`,
      [student.std, student.division, result.format_id],
    );
    const avgLookup = {};
    for (const a of avgRows) avgLookup[a.parameter_id] = a;

    // ── Grade bands (check Male / Female data based on student gender) ──
    const studentGender = String(student.gender || "").trim().toLowerCase();
    const isMale = studentGender === "male" || studentGender === "boy";
    const isFemale = studentGender === "female" || studentGender === "girl";
    const targetGender = isMale ? "Male" : (isFemale ? "Female" : "All");
    const stdCode = getGradeStd(student.std);

    const fetchGradeBands = async (paramKey, testDisplay, fpId) => {
      let [allRows] = await db.query(
        `SELECT * FROM parameter_grades WHERE parameter = ?`,
        [String(paramKey || "")],
      );
      if (!allRows.length && fpId) {
        [allRows] = await db.query(
          `SELECT * FROM parameter_grades WHERE parameter = ?`,
          [`param${fpId}`],
        );
      }
      if (!allRows.length) return [];

      // 1. Standard matching (stdCode -> '0' -> closest std -> all)
      let stdRows = allRows.filter((r) => String(r.std) === String(stdCode));
      if (!stdRows.length) {
        stdRows = allRows.filter((r) => String(r.std) === "0");
      }
      if (!stdRows.length) {
        const stdNum = parseInt(stdCode) || 0;
        const availableStds = [
          ...new Set(
            allRows
              .map((r) => parseInt(r.std))
              .filter((n) => !isNaN(n)),
          ),
        ];
        if (availableStds.length) {
          availableStds.sort(
            (a, b) => Math.abs(a - stdNum) - Math.abs(b - stdNum),
          );
          const bestStd = String(availableStds[0]);
          stdRows = allRows.filter((r) => String(r.std) === bestStd);
        }
      }
      if (!stdRows.length) stdRows = allRows;

      // 2. Gender matching (check gender-specific first; if not found, fallback to "All")
      let genderRows = stdRows.filter(
        (r) => (r.gender || "All").trim().toLowerCase() === targetGender.toLowerCase(),
      );
      if (!genderRows.length) {
        genderRows = stdRows.filter(
          (r) => (r.gender || "All").trim().toLowerCase() === "all",
        );
      }
      if (!genderRows.length) genderRows = stdRows;

      // 3. Test display matching (exact testDisplay -> empty test_display -> any)
      const tDisp = String(testDisplay || "").trim().toLowerCase();
      let testRows = tDisp
        ? genderRows.filter((r) => (r.test_display || "").trim().toLowerCase() === tDisp)
        : [];
      if (!testRows.length) {
        testRows = genderRows.filter((r) => !(r.test_display || "").trim());
      }
      if (!testRows.length) {
        testRows = genderRows;
      }

      const seenGrades = new Set();
      const uniqueRows = [];
      for (const r of testRows) {
        const g = String(r.grade || "").trim().toUpperCase();
        if (!seenGrades.has(g)) {
          seenGrades.add(g);
          uniqueRows.push({
            min_score: r.min_score != null ? Number(r.min_score) : null,
            max_score: r.max_score != null ? Number(r.max_score) : null,
            grade: r.grade ?? null,
            grade_label: r.grade_label ?? null,
          });
        }
      }
      return uniqueRows;
    };

    // ── Format meta ──
    const [formatRows] = await db.query("SELECT test_name, test_title FROM fitness_test_formats WHERE id = ?", [result.format_id]);
    const formatMeta = formatRows[0] || {};

    // ── Assemble parameters (ONLY include parameters where student has values) ──
    const parameters = [];
    for (const p of paramRows) {
      const v1 = valueMap[term1Row && term1Row.id] && valueMap[term1Row.id][p.parameter_id];
      const v2 = valueMap[term2Row && term2Row.id] && valueMap[term2Row.id][p.parameter_id];
      const hasVal1 = v1 !== undefined && v1 !== null && String(v1).trim() !== "" && String(v1).trim() !== "--";
      const hasVal2 = v2 !== undefined && v2 !== null && String(v2).trim() !== "" && String(v2).trim() !== "--";

      // Only create if we have values
      if (!hasVal1 && !hasVal2) continue;

      const t1 = valueOf(term1Row, p.parameter_id);
      const t2 = valueOf(term2Row, p.parameter_id);
      const avg = avgLookup[p.parameter_id];
      const class1 = avg && avg.term1_avg !== null ? Number(avg.term1_avg) : null;
      const class2 = avg && avg.term2_avg !== null ? Number(avg.term2_avg) : null;
      parameters.push({
        parameter_id: p.parameter_id,
        name: p.title,
        parameter_key: p.parameter_key,
        description: p.description,
        video_link: p.video_link,
        ctype: p.ctype,
        clabel: p.clabel,
        chart_format: p.chart_format,
        chart_heading: p.chart_heading,
        test_display: p.test_display,
        parameter_order: p.parameter_order,
        is_required: p.is_required,
        is_speed: String(p.title || p.parameter_key || "").toLowerCase() === "speed",
        student: { term1: t1, term2: t2 },
        class_average: {
          term1: class1 !== null ? class1 : (t1 ?? 0) + 5,
          term2: class2 !== null ? class2 : (t2 ?? 0) + 5,
        },
        grades: await fetchGradeBands(p.parameter_key, p.test_display, p.fp_id),
        has_both_terms: Boolean(hasVal1 && hasVal2),
      });
    }

    res.json({
      success: true,
      data: {
        report: {
          report_key: "",
          result_id: resultId,
          student_id: student.id,
          student_name: student.name,
          standard: String(student.std),
          division: student.division,
          mq_id: student.mq_id,
          format_id: result.format_id,
          format_test_name: formatMeta.test_name ?? null,
          test_title: formatMeta.test_title ?? null,
          academic_year: result.academic_year,
          term: term1Row && term2Row ? "term1_and_term2" : (term1Row ? "term1" : "term2"),
        },
        terms: {
          term1: term1Row ? { result_id: term1Row.id, term_label: "Term 1", test_date: term1Row.test_date, examiner_name: term1Row.examiner_name } : null,
          term2: term2Row ? { result_id: term2Row.id, term_label: "Term 2", test_date: term2Row.test_date, examiner_name: term2Row.examiner_name } : null,
        },
        parameters,
        grade_colors: ["#ff6b6b", "#f7e97e", "#8fd19e", "#6f79b8"],
      },
    });
  } catch (err) {
    console.error("[FITNESS-DATA] Error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// 🎓 GET DETAILED REPORT DATA
app.get("/api/reports/data/:result_id", async (req, res) => {
  try {
    const { result_id } = req.params;

    // 1. Get Result & Student & School Info
    const [[result]] = await db.query(
      `
            SELECT ftr.*, s.name as student_name, s.mq_id, s.std, s.division, s.gender,
                   sch.name as school_name, sch.school_logo
            FROM fitness_test_results ftr
            JOIN students s ON ftr.student_id = s.id
            JOIN schools sch ON s.school_id = sch.id
            WHERE ftr.id = ?
        `,
      [result_id],
    );

    if (!result)
      return res
        .status(404)
        .json({ success: false, message: "Result not found" });

    // 2. Get Parameters for this format
    const [params] = await db.query(
      `
            SELECT pi.id, pi.title, pi.parameter, pi.ctype, ftrv.parameter_value, ftrv.mark_status
            FROM fitness_test_format_parameters fp
            JOIN parameter_info pi ON fp.parameter_id = pi.id
            LEFT JOIN fitness_test_result_values ftrv ON pi.id = ftrv.parameter_id AND ftrv.result_id = ?
            WHERE fp.format_id = ?
            ORDER BY fp.parameter_order
        `,
      [result_id, result.format_id],
    );

    // 3. Get Grading Ranges for this standard
    const [ranges] = await db.query(
      `SELECT * FROM parameter_grades WHERE std IN (?, 0)`,
      [getStdCodeFromValue(result.std)],
    );

    // 4. Calculate Grades
    const reportData = params.map((p) => {
      const studentGender = (result.gender || "").trim().toLowerCase();
      let paramRanges = ranges.filter((r) => r.parameter === p.parameter);

      // Filter by gender if specific configurations exist
      const genderSpecificRanges = paramRanges.filter((r) => {
        const rGender = (r.gender || "All").trim().toLowerCase();
        if (studentGender === "male" || studentGender === "boy") {
          return rGender === "male" || rGender === "boy";
        } else if (studentGender === "female" || studentGender === "girl") {
          return rGender === "female" || rGender === "girl";
        }
        return false;
      });

      if (genderSpecificRanges.length > 0) {
        paramRanges = genderSpecificRanges;
      } else {
        // Fallback to 'All'
        paramRanges = paramRanges.filter((r) => {
          const rGender = (r.gender || "All").trim().toLowerCase();
          return rGender === "all";
        });
      }

      const grade = p.mark_status
        ? p.mark_status
        : isPrePrimaryYesNoParam(p)
          ? gradeYesNo(p.parameter_value)
          : calculateGrade(p.parameter_value, paramRanges);
      return {
        ...p,
        grade,
      };
    });

    res.json({
      success: true,
      student: {
        name: result.student_name,
        mq_id: result.mq_id,
        std: result.std,
        division: result.division,
        school: result.school_name,
      },
      results: reportData,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 🎫 PUBLIC REPORT ACCESS — resolves QR report_key → report header data.
// Public QR entry point (no JWT). Resolves:
//   fitness_test_report_access.report_key → result_id → fitness_test_results → students
// Links the future Vue reportcard route to a report WITHOUT exposing unrelated
// student data. Read-only in this phase: access_granted is returned, never updated.

; // stripped /api/report-access/:reportKey


// ─────────────────────────────────────────────────────────────────────────────
// 🔐 PUBLIC REPORT ACCESS — Parent OTP verification (Phase 3).
// PUBLIC (no JWT). Report_key comes only from the URL and is matched EXACTLY;
// result_id is never accepted from the client or parsed from the key.
// OTP behavior baseline (legacy): 6-digit, 5-minute expiry, 3 attempts.
// OTPs are stored hashed; delivery is dry-run unless REPORT_OTP_DELIVERY=live.
// ─────────────────────────────────────────────────────────────────────────────
function handleReportAccessError(res, err) {
  if (err && err.status && err.body) {
    return res.status(err.status).json(err.body);
  }
  console.error("REPORT-ACCESS OTP ERROR:", err);
  return res
    .status(500)
    .json({ success: false, message: "Internal server error" });
}


; // stripped /api/report-access/:reportKey/request-phone-otp



; // stripped /api/report-access/:reportKey/request-email-otp



; // stripped /api/report-access/:reportKey/verify-otp


// ─────────────────────────────────────────────────────────────────────────────
// 📊 PUBLIC REPORT DATA (Phase 4). Requires the Phase 3 report access token
// (Authorization: Bearer <token>). The report_key alone is never sufficient;
// the token is scoped to the exact report_key and result_id.
// ─────────────────────────────────────────────────────────────────────────────

; // stripped /api/report-access/:reportKey/data


// 📄 GENERATE + STREAM THE FITNESS REPORT PDF (token-scoped parent flow).
// Requires the Phase 3 report access token (Authorization: Bearer <token>),
// which is scoped to the exact report_key by reportAccessOtp.validateAccessToken.
// The result_id is resolved ONLY from that validated grant — never accepted from
// the client. Optional graph_images are raster PNGs produced by the existing
// Plotly builders (src/views/reportcard/utils/fitnessReportPdf.ts) and embedded
// verbatim by buildReportPDF().

; // stripped /api/report-access/:reportKey/pdf


// ─────────────────────────────────────────────────────────────────
// 📄 PDF GENERATION + ZIP DOWNLOAD
// ─────────────────────────────────────────────────────────────────

/* PDF_TEMP_DIR from ctx */
if (!fs.existsSync(PDF_TEMP_DIR))
  fs.mkdirSync(PDF_TEMP_DIR, { recursive: true });

// Helper: draw a rounded rectangle
function drawRoundedRect(page, x, y, w, h, color) {
  page.drawRectangle({
    x,
    y,
    width: w,
    height: h,
    color,
    borderColor: color,
    borderWidth: 0,
  });
}

// Helper: normalize std to numeric for grade lookup (same as PHP)
function normalizeStd(std) {
  const map = {
    Nursery: "-2",
    "Jr.Kg": "-1",
    "Jr Kg": "-1",
    JrKg: "-1",
    "Sr.Kg": "0",
    "Sr Kg": "0",
    SrKg: "0",
    I: "1",
    II: "2",
    III: "3",
    IV: "4",
    V: "5",
    VI: "6",
    VII: "7",
    VIII: "8",
    IX: "9",
    X: "10",
    XI: "11",
    XII: "12",
  };
  const match = String(std).match(/^([IVX]+|Nursery|Jr\.?Kg|Sr\.?Kg)/i);
  if (match && map[match[1]]) return map[match[1]];
  return String(std);
}

// Helper: get grade color as rgb
function gradeToColor(grade) {
  const g = (grade || "").toUpperCase();
  if (g === "A+") return rgb(0.243, 0.612, 0.882); // light blue
  if (g === "A") return rgb(0.243, 0.612, 0.882);
  if (g === "B+") return rgb(0.902, 0.569, 0.22); // orange
  if (g === "B") return rgb(0.902, 0.569, 0.22);
  return rgb(0.58, 0.65, 0.65);
}

// Helper: wrap text into lines based on maximum width
function wrapText(text, maxWidth, font, size) {
  if (!text) return [];
  const words = String(text).split(/\s+/);
  const lines = [];
  let currentLine = "";

  for (const word of words) {
    if (font.widthOfTextAtSize(word, size) <= maxWidth) {
      const testLine = currentLine ? `${currentLine} ${word}` : word;
      if (font.widthOfTextAtSize(testLine, size) <= maxWidth) {
        currentLine = testLine;
      } else {
        if (currentLine) lines.push(currentLine);
        currentLine = word;
      }
    } else {
      if (currentLine) lines.push(currentLine);
      currentLine = "";
      for (let i = 0; i < word.length; i++) {
        const testChar = currentLine + word[i];
        if (font.widthOfTextAtSize(testChar, size) <= maxWidth) {
          currentLine = testChar;
        } else {
          if (currentLine) lines.push(currentLine);
          currentLine = word[i];
        }
      }
    }
  }
  if (currentLine) lines.push(currentLine);
  return lines;
}

// ── Helper: Draw QR Code Section (Ported from PHP) ──
async function addQRCodeSection(pdfDoc, page, resultId, yMM, helpers) {
  const { px, py, fontBold, fontReg, black, white, gray, width, height } =
    helpers;

  // Box aligned with table (same x start and width as skills table)
  const marginX = 15;
  const boxW =
    helpers.totalW !== undefined ? helpers.totalW : 210 - marginX * 2;
  const boxH = 50; // Reduced from 60 to 50mm to save vertical space
  const boxX = px(marginX);
  const boxYMM = yMM + 3;

  const qrSize = 42; // Scaled down proportionally with box
  const logoSize = 11;
  const innerTopPad = 6;
  const radius = 3.5;
  const bgPadding = 2.0;

  // 1. Draw border box
  page.drawRectangle({
    x: boxX,
    y: py(boxYMM, boxH),
    width: px(boxW),
    height: px(boxH),
    borderColor: black,
    borderWidth: 0.7,
  });

  // 2. Generate QR Code
  const reportKey = await getOrCreateReportKey(resultId, db);
  const publicReportUrl = (
    process.env.PUBLIC_REPORTCARD_URL ||
    process.env.FRONTEND_URL ||
    "https://coach.marcosquay.com"
  ).replace(/\/+$/, "");
  const qrUrl = `${publicReportUrl}/reportcard?k=${encodeURIComponent(reportKey)}`;
  console.log(`[PDF] Generated QR URL for result_id ${resultId}: ${qrUrl}`);
  try {
    const qrDataUri = await QRCode.toDataURL(qrUrl, {
      margin: 1,
      errorCorrectionLevel: "H",
    });
    const qrImageBytes = Buffer.from(qrDataUri.split(",")[1], "base64");
    const qrImg = await pdfDoc.embedPng(qrImageBytes);

    const qrX = boxX + px(6);
    const qrY =
      py(boxYMM, boxH) +
      px(innerTopPad + (boxH - innerTopPad * 2 - qrSize) / 2);

    page.drawImage(qrImg, {
      x: qrX,
      y: qrY,
      width: px(qrSize),
      height: px(qrSize),
    });

    // ── MQ Logo in center of QR ──
    const mqLogoPath = path.join(__dirname, "../src/assets/new_logo.png");
    if (fs.existsSync(mqLogoPath)) {
      const mqBytes = fs.readFileSync(mqLogoPath);
      const mqLogo = await pdfDoc.embedPng(mqBytes);

      const qrCenterX = qrX + px(qrSize / 2);
      const qrCenterY = qrY + px(qrSize / 2);
      const bgW = px(logoSize + 2 * bgPadding);

      // White background for logo (rounded-ish)
      page.drawRectangle({
        x: qrCenterX - bgW / 2,
        y: qrCenterY - bgW / 2,
        width: bgW,
        height: bgW,
        color: white,
        opacity: 1,
      });

      const mqDims = mqLogo.scaleToFit(px(logoSize), px(logoSize));
      page.drawImage(mqLogo, {
        x: qrCenterX - mqDims.width / 2,
        y: qrCenterY - mqDims.height / 2,
        width: mqDims.width,
        height: mqDims.height,
      });
    }
  } catch (err) {
    console.error("QR Error:", err);
  }

  // 3. Text content
  const textX = boxX + px(qrSize + 14);
  const textW = px(boxW - (qrSize + 20));
  const lineH = 5.5;

  const subtitles = [
    "Simple explanations of each activity",
    "Videos showing how each test works",
    "Progress tracking across the year",
  ];

  const textTitle = "Scan the QR code to unlock:";
  const totalLines = 1 + subtitles.length + 1;
  const textHeightTotal = lineH * totalLines;

  let textY =
    py(boxYMM, boxH) + px(boxH) - px((boxH - textHeightTotal) / 2 + lineH);

  // Title (14pt Bold)
  page.drawText(textTitle, {
    x: textX,
    y: textY,
    size: 14,
    font: fontBold,
    color: rgb(0.15, 0.15, 0.15),
  });

  textY -= px(lineH * 2);

  // Subtitles (12pt Bold)
  for (const sub of subtitles) {
    page.drawText("• " + sub, {
      x: textX,
      y: textY,
      size: 12,
      font: fontBold,
      color: rgb(0.15, 0.15, 0.15),
    });
    textY -= px(lineH);
  }

  return boxYMM + boxH + 3;
}
// 📄 BUILD PDF FOR ONE RESULT — with optional simplified options
async function buildReportPDF(resultId, options = {}) {
  const {
    selectedTerm = "both", // 'term1', 'term2', or 'both'
    showScanner = false,
    graphImages = [], // optional [{ data_url: "data:image/png;base64,..." }]
  } = options;

  // ── 1. Fetch result + student + school ──
  const [[result]] = await db.query(
    `
        SELECT ftr.*, ft.test_name, ft.test_title, ft.academic_year,
               s.name as student_name, s.mq_id, s.std, s.division, s.gender, s.school_id,
               sch.name as school_name, sch.school_logo,
               sch.show_principal_signature, sch.principal_name, sch.principal_designation, sch.principal_signature_image,
               sch.head_coach_name, sch.head_coach_designation,
               sch.show_head_coach_signature, sch.head_coach_signature_image
        FROM fitness_test_results ftr
        JOIN fitness_test_formats ft ON ftr.format_id = ft.id
        JOIN students s ON ftr.student_id = s.id
        JOIN schools sch ON s.school_id = sch.id
        WHERE ftr.id = ?
    `,
    [resultId],
  );

  console.log(`[PDF] Result fetched for ID: ${resultId}, Found: ${!!result}`);
  if (!result) throw new Error(`Result ${resultId} not found`);

  // Fallback academic year if missing in format
  if (!result.academic_year) {
    result.academic_year = getCurrentAcademicYear();
  }

  // ── 2. Detect which terms have data ──
  let hasTerm1 = false;
  let hasTerm2 = false;

  {
    const [t1check] = await db.query(
      `SELECT 1 FROM fitness_test_results WHERE student_id = ? AND format_id = ? AND term = 'term1' LIMIT 1`,
      [result.student_id, result.format_id],
    );
    hasTerm1 = t1check.length > 0;

    const [t2check] = await db.query(
      `SELECT 1 FROM fitness_test_results WHERE student_id = ? AND format_id = ? AND term = 'term2' LIMIT 1`,
      [result.student_id, result.format_id],
    );
    hasTerm2 = t2check.length > 0;
  }

  let isMultiTerm = hasTerm1 && hasTerm2;
  let singleTermLabel = hasTerm1 ? "Term 1" : "Term 2";

  // ── 3. Fetch parameters ──
  const [params] = await db.query(
    `
        SELECT pi.id, pi.title, pi.parameter, pi.ctype, pi.test_display, pi.description, pi.video_link,
               ftrv.parameter_value, fp.parameter_order
        FROM fitness_test_format_parameters fp
        JOIN parameter_info pi ON fp.parameter_id = pi.id
        LEFT JOIN fitness_test_result_values ftrv
          ON pi.id = ftrv.parameter_id
          AND ftrv.result_id = ?
        WHERE fp.format_id = ?
        ORDER BY fp.parameter_order
    `,
    [resultId, result.format_id],
  );

  // ── 4. Grading ranges ──
  const stdCode = getStdCodeFromValue(result.std);

  const [ranges] = await db.query(
    `SELECT * FROM parameter_grades WHERE std IN (?, 0)`,
    [stdCode],
  );

  console.log(`[PDF] Grading ranges fetched: ${ranges.length}`);

  // ── 5. Build PDF ──
  const pdfDoc = await PDFDocument.create();

  const page = pdfDoc.addPage([595.28, 841.89]); // A4
  const { width, height } = page.getSize();

  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const fontReg = await pdfDoc.embedFont(StandardFonts.Helvetica);

  console.log(`[PDF] Fonts embedded`);

  // ── BACKGROUND IMAGE ──
  try {
    const bgPath = path.join(
      __dirname,
      "../src/assets/background_of_report_card.png",
    );

    if (fs.existsSync(bgPath)) {
      const bgBytes = fs.readFileSync(bgPath);
      const bgImg = await pdfDoc.embedPng(bgBytes);

      if (bgImg) {
        page.drawImage(bgImg, {
          x: 0,
          y: 0,
          width: width,
          height: height,
          opacity: 1,
        });

        console.log(`[PDF] Background image embedded: ${bgPath}`);
      }
    } else {
      console.warn(`[PDF] Background image NOT found at: ${bgPath}`);
    }
  } catch (err) {
    console.error(`[PDF] Error embedding background image:`, err);
  }

  // mm → points helpers (pdf-lib origin = bottom-left)
  const MM = 2.835;

  const px = (mm) => mm * MM;

  const py = (mm, hMM = 0) => height - (mm + hMM) * MM;

  // ── COLORS ──
  const titleBg = rgb(0.655, 0.729, 0.882);
  const tableHeaderBg = rgb(0.553, 0.678, 0.859);
  const rowBg = rgb(0.922, 0.945, 0.976);
  const blueBorder = rgb(0.204, 0.471, 0.757);
  const black = rgb(0, 0, 0);
  const white = rgb(1, 1, 1);
  const textDark = rgb(0.129, 0.129, 0.129);
  const textMed = rgb(0.173, 0.243, 0.314);
  const gray = rgb(0.42, 0.42, 0.42);

  // ── MARCOS QUAY LOGO ──
  // Both header logos (Marcos Quay left, school right) are forced to this
  // exact same rendered size.
  const headerLogoW = px(38);
  const headerLogoH = px(22);
  let mqLogoRightX = px(15);

  try {
    const mqLogoPath = path.join(__dirname, "../src/assets/new_logo.png");

    if (fs.existsSync(mqLogoPath)) {
      const mqBytes = fs.readFileSync(mqLogoPath);
      const mqEmb = await pdfDoc.embedPng(mqBytes);

      if (mqEmb) {
        const mqX = px(15);

        page.drawImage(mqEmb, {
          x: mqX,
          y: py(8) - headerLogoH,
          width: headerLogoW,
          height: headerLogoH,
        });

        mqLogoRightX = mqX + headerLogoW;
      }
    }
  } catch (err) { }

  // ── SCHOOL LOGO ──
  let schoolLogoLeftX = px(195);

  if (result.school_logo) {
    try {
      const logoPath = path.join(__dirname, "uploads", result.school_logo);

      if (fs.existsSync(logoPath)) {
        const logoBytes = fs.readFileSync(logoPath);

        let embeddedLogo;

        if (logoPath.toLowerCase().endsWith(".png")) {
          embeddedLogo = await pdfDoc.embedPng(logoBytes);
        } else if (logoPath.toLowerCase().match(/\.(jpg|jpeg)$/)) {
          embeddedLogo = await pdfDoc.embedJpg(logoBytes);
        }

        if (embeddedLogo) {
          const slX = width - headerLogoW - px(15);

          page.drawImage(embeddedLogo, {
            x: slX,
            y: py(8) - headerLogoH,
            width: headerLogoW,
            height: headerLogoH,
          });

          schoolLogoLeftX = slX;
        }
      }
    } catch (err) { }
  }

  // ── CENTERED HEADER & SUB-HEADER ──
  let stdClean = String(result.std || "").trim();
  let displayStd = stdClean;

  if (stdClean === "-3" || stdClean.toLowerCase() === "nursery") displayStd = "Nursery";
  else if (stdClean === "-2" || stdClean.toLowerCase().includes("jr")) displayStd = "Jr. KG";
  else if (stdClean === "-1" || stdClean.toLowerCase().includes("sr")) displayStd = "Sr. KG";
  else if (/^\d+$/.test(stdClean)) displayStd = `Grade ${stdClean}`;
  else if (!/^grade|^std/i.test(stdClean) && stdClean) displayStd = `Grade ${stdClean}`;

  const divClean = String(result.division || "")
    .trim()
    .toUpperCase()
    .replace(/^DIV(ISION)?\s*/i, "");

  const fullGradeDiv = divClean ? `${displayStd} - ${divClean}` : displayStd;

  // Derive exam type:
  // 1. Check student's std first:
  //    - Nursery / Jr.Kg / Sr.Kg (-3, -2, -1, codes 1, 2, 13) → PRE-PRIMARY REPORT CARD
  //    - Std 1 to 4                                            → PRIMARY REPORT CARD
  //    - Std 5 to 10+                                           → SECONDARY REPORT CARD
  // 2. Fallback to format_id / test_name if std is missing or unmapped
  let headerText = "FITNESS REPORT CARD";
  const stdCleanLower = String(result.std || "").trim().toLowerCase();
  const stdCodeForHeader = getStdCodeFromValue(result.std);
  const testName = String(result.test_name || "").toLowerCase();

  const numMatch = stdCleanLower.match(/\d+/);
  const stdNum = numMatch ? parseInt(numMatch[0]) : null;

  if (
    stdCleanLower === "-3" ||
    stdCleanLower === "-2" ||
    stdCleanLower === "-1" ||
    stdCodeForHeader === 1 ||
    stdCodeForHeader === 2 ||
    stdCodeForHeader === 13 ||
    /nursery|jr|junior|sr|senior|kg|kinder|kids|play|lkg|ukg/i.test(stdCleanLower)
  ) {
    headerText = "PRE-PRIMARY REPORT CARD";
  } else if (
    (stdCodeForHeader >= 3 && stdCodeForHeader <= 6) ||
    (stdNum !== null && stdNum >= 1 && stdNum <= 4) ||
    /^(1|2|3|4|1st|2nd|3rd|4th|i|ii|iii|iv|class\s*[i-iv]|class\s*[1-4])$/i.test(stdCleanLower)
  ) {
    headerText = "PRIMARY REPORT CARD";
  } else if (
    stdCodeForHeader >= 7 ||
    (stdNum !== null && stdNum >= 5) ||
    /^(v|vi|vii|viii|ix|x|class\s*[v-x]|class\s*([5-9]|10))$/i.test(stdCleanLower)
  ) {
    headerText = "SECONDARY REPORT CARD";
  } else if (
    result.format_id === 41 ||
    testName.includes("pre - primary") ||
    testName.includes("pre-primary") ||
    testName.includes("pre primary")
  ) {
    headerText = "PRE-PRIMARY REPORT CARD";
  } else if (
    result.format_id === 39 ||
    (testName.includes("primary") && !testName.includes("pre"))
  ) {
    headerText = "PRIMARY REPORT CARD";
  } else if (
    result.format_id === 40 ||
    testName.includes("secondary")
  ) {
    headerText = "SECONDARY REPORT CARD";
  }
  const subHeaderText = "AB SIRF DEKHEGA NAHI, KHELEGA INDIA";

  const maxCenterWidth = width - 2 * (px(15) + headerLogoW + px(3));

  let headerSize = 18;
  while (headerSize > 12 && fontBold.widthOfTextAtSize(headerText, headerSize) > maxCenterWidth) {
    headerSize -= 1;
  }
  const headerW = fontBold.widthOfTextAtSize(headerText, headerSize);

  // Exactly centered on the page
  const headerX = (width - headerW) / 2;
  page.drawText(headerText, {
    x: headerX,
    y: py(38) - headerSize * 0.35,
    size: headerSize,
    font: fontBold,
    color: rgb(0, 0.11, 0.32),
  });

  const subHeaderSize = 11;

  const subHeaderW = fontBold.widthOfTextAtSize(subHeaderText, subHeaderSize);

  // Exactly centered on the page
  const subHeaderX = (width - subHeaderW) / 2;
  // "AB SIRF DEKHEGA NAHI, " in blue | "KHELEGA INDIA" in red
  {
    const bluePart = "AB SIRF DEKHEGA NAHI, ";
    const redPart = "KHELEGA INDIA";
    const blueW = fontBold.widthOfTextAtSize(bluePart, subHeaderSize);
    const redW = fontBold.widthOfTextAtSize(redPart, subHeaderSize);
    const subY = py(47) - subHeaderSize * 0.35;
    page.drawText(bluePart, {
      x: subHeaderX,
      y: subY,
      size: subHeaderSize,
      font: fontBold,
      color: rgb(0, 0.27, 0.68), // Bold blue
    });
    page.drawText(redPart, {
      x: subHeaderX + blueW,
      y: subY,
      size: subHeaderSize,
      font: fontBold,
      color: rgb(0.85, 0.07, 0.07), // Bold red
    });
  }

  // ── TITLE BAR ──
  const ay = result.academic_year || "";

  const titleText = `ACADEMIC YEAR : ${ay}`.toUpperCase();

  // Academic Year bar
  page.drawRectangle({
    x: px(15),
    y: py(54, 10),
    width: px(180),
    height: px(10),
    color: titleBg,
  });

  const titleSize = 12;

  const titleW = fontBold.widthOfTextAtSize(titleText, titleSize);

  const titleX = px(15) + (px(180) - titleW) / 2;

  page.drawText(titleText, {
    x: titleX,
    y: py(54, 10) + px(10) / 2 - titleSize * 0.35,
    size: titleSize,
    font: fontBold,
    color: black,
  });

  // ── STUDENT INFO ──
  const classText = divClean
    ? `${displayStd} - Div ${divClean}`
    : displayStd;

  // Student info positioned just below the academic year bar
  const studentInfoY = py(68) - 6;

  // ── STUDENT NAME ──
  const studentNameLabel = "Student Name :";
  page.drawText(studentNameLabel, {
    x: px(15),
    y: studentInfoY,
    size: 11,
    font: fontBold,
    color: black,
  });

  const studentNameStr = String(result.student_name || "").trim().toUpperCase();
  const nameLabelWidth = fontBold.widthOfTextAtSize(studentNameLabel, 11);
  page.drawText(studentNameStr, {
    x: px(15) + nameLabelWidth + px(3),
    y: studentInfoY,
    size: 11,
    font: fontBold,
    color: textDark,
  });

  // ── CLASS ──
  const classLabel = "Class :";
  const classLabelWidth = fontBold.widthOfTextAtSize(classLabel, 11);
  const classValWidth = fontBold.widthOfTextAtSize(classText, 11);
  const classTotalWidth = classLabelWidth + px(2) + classValWidth;
  const classRightMarginX = px(195);
  const classStartX = classRightMarginX - classTotalWidth;

  page.drawText(classLabel, {
    x: classStartX,
    y: studentInfoY,
    size: 11,
    font: fontBold,
    color: black,
  });

  page.drawText(classText, {
    x: classStartX + classLabelWidth + px(2),
    y: studentInfoY,
    size: 11,
    font: fontBold,
    color: textDark,
  });

  // ── TABLE CONFIG ──
  // Compacted heights to ensure everything fits on one A4 page (297mm)
  // Both with and without QR code.
  const skillsHdrH = 11;

  // Column header height
  const colHdrH = showScanner ? 10 : 12;

  // Skills table starts just below student info line
  const tableY = showScanner ? 79 : 81;

  const colTableY = tableY + skillsHdrH;

  const paramW = 58;

  // Row height - increased for better readability
  const rowH = showScanner ? 14 : 16;

  let testW, descW, gradeW, term2W;

  let headers;

  if (isMultiTerm) {
    testW = 40;
    descW = 44;
    gradeW = 18;
    term2W = 18;

    headers = ["Parameters", "Tests", "Description", "Term 1", "Term 2"];
  } else {
    testW = 42;
    descW = 54;
    gradeW = 24;
    term2W = 0;

    headers = ["Parameters", "Tests", "Description", singleTermLabel];
  }

  const totalW = paramW + testW + descW + gradeW + term2W;

  const descStart = 15 + paramW + testW;

  const gradeStart = descStart + descW;

  const term2Start = gradeStart + gradeW;

  // ── SKILLS ASSESSMENT HEADER ──
  page.drawRectangle({
    x: px(15),
    y: py(tableY, skillsHdrH),
    width: px(totalW),
    height: px(skillsHdrH),
    color: tableHeaderBg,
  });

  page.drawLine({
    start: {
      x: px(15),
      y: py(tableY, skillsHdrH),
    },
    end: {
      x: px(15 + totalW),
      y: py(tableY, skillsHdrH),
    },
    color: blueBorder,
    thickness: 1.5,
  });

  page.drawLine({
    start: {
      x: px(15),
      y: py(tableY),
    },
    end: {
      x: px(15 + totalW),
      y: py(tableY),
    },
    color: blueBorder,
    thickness: 1.5,
  });

  page.drawLine({
    start: {
      x: px(15),
      y: py(tableY, skillsHdrH),
    },
    end: {
      x: px(15),
      y: py(tableY),
    },
    color: blueBorder,
    thickness: 1.5,
  });

  page.drawLine({
    start: {
      x: px(15 + totalW),
      y: py(tableY, skillsHdrH),
    },
    end: {
      x: px(15 + totalW),
      y: py(tableY),
    },
    color: blueBorder,
    thickness: 1.5,
  });

  const skillsTitle = "SKILLS ASSESSMENT";

  const skillsSize = 12;

  const skillsW = fontBold.widthOfTextAtSize(skillsTitle, skillsSize);

  page.drawText(skillsTitle, {
    x: px(15) + (px(totalW) - skillsW) / 2,
    y: py(tableY, skillsHdrH) + px(skillsHdrH) / 2 - skillsSize * 0.35,
    size: skillsSize,
    font: fontBold,
    color: black,
  });

  // ── COLUMN HEADER ROW ──
  page.drawRectangle({
    x: px(15),
    y: py(colTableY, colHdrH),
    width: px(totalW),
    height: px(colHdrH),
    color: tableHeaderBg,
  });

  // Top border
  page.drawLine({
    start: {
      x: px(15),
      y: py(colTableY, colHdrH),
    },
    end: {
      x: px(15 + totalW),
      y: py(colTableY, colHdrH),
    },
    color: blueBorder,
    thickness: 1.5,
  });

  // Left border
  page.drawLine({
    start: {
      x: px(15),
      y: py(colTableY, colHdrH),
    },
    end: {
      x: px(15),
      y: py(colTableY),
    },
    color: blueBorder,
    thickness: 1.5,
  });

  // Right border
  page.drawLine({
    start: {
      x: px(15 + totalW),
      y: py(colTableY, colHdrH),
    },
    end: {
      x: px(15 + totalW),
      y: py(colTableY),
    },
    color: blueBorder,
    thickness: 1.5,
  });

  // Bottom border
  page.drawLine({
    start: {
      x: px(15),
      y: py(colTableY),
    },
    end: {
      x: px(15 + totalW),
      y: py(colTableY),
    },
    color: blueBorder,
    thickness: 1.5,
  });

  // Inner column borders
  page.drawLine({
    start: {
      x: px(15 + paramW),
      y: py(colTableY, colHdrH),
    },
    end: {
      x: px(15 + paramW),
      y: py(colTableY),
    },
    color: blueBorder,
    thickness: 1.5,
  });

  page.drawLine({
    start: {
      x: px(15 + paramW + testW),
      y: py(colTableY, colHdrH),
    },
    end: {
      x: px(15 + paramW + testW),
      y: py(colTableY),
    },
    color: blueBorder,
    thickness: 1.5,
  });

  page.drawLine({
    start: {
      x: px(descStart),
      y: py(colTableY, colHdrH),
    },
    end: {
      x: px(descStart),
      y: py(colTableY),
    },
    color: blueBorder,
    thickness: 1.5,
  });

  if (isMultiTerm) {
    page.drawLine({
      start: {
        x: px(gradeStart),
        y: py(colTableY, colHdrH),
      },
      end: {
        x: px(gradeStart),
        y: py(colTableY),
      },
      color: blueBorder,
      thickness: 1.5,
    });

    page.drawLine({
      start: {
        x: px(term2Start),
        y: py(colTableY, colHdrH),
      },
      end: {
        x: px(term2Start),
        y: py(colTableY),
      },
      color: blueBorder,
      thickness: 1.5,
    });
  } else {
    page.drawLine({
      start: {
        x: px(gradeStart),
        y: py(colTableY, colHdrH),
      },
      end: {
        x: px(gradeStart),
        y: py(colTableY),
      },
      color: blueBorder,
      thickness: 1.5,
    });
  }

  // Header text
  const hdrY = py(colTableY, colHdrH) + px(colHdrH) / 2 - 10 * 0.35;

  page.drawText(headers[0], {
    x: px(15) + (px(paramW) - fontBold.widthOfTextAtSize(headers[0], 10)) / 2,

    y: hdrY,
    size: 11,
    font: fontBold,
    color: textDark,
  });

  page.drawText(headers[1], {
    x:
      px(15 + paramW) +
      (px(testW) - fontBold.widthOfTextAtSize(headers[1], 11)) / 2,

    y: hdrY,
    size: 11,
    font: fontBold,
    color: textDark,
  });

  page.drawText(headers[2], {
    x:
      px(descStart) +
      (px(descW) - fontBold.widthOfTextAtSize(headers[2], 11)) / 2,

    y: hdrY,
    size: 11,
    font: fontBold,
    color: textDark,
  });

  page.drawText(headers[3], {
    x:
      px(gradeStart) +
      (px(gradeW) - fontBold.widthOfTextAtSize(headers[3], 11)) / 2,
    y: hdrY,
    size: 11,
    font: fontBold,
    color: textDark,
  });

  if (isMultiTerm) {
    page.drawText(headers[4], {
      x:
        px(term2Start) +
        (px(term2W) - fontBold.widthOfTextAtSize(headers[4], 11)) / 2,
      y: hdrY,
      size: 11,
      font: fontBold,
      color: textDark,
    });
  }

  // ── TABLE ROWS ──
  let yMM = tableY + skillsHdrH + colHdrH;

  // ── MULTI-TERM VALUES ──
  let termValMap = {};

  if (hasTerm1) {
    const [t1rows] = await db.query(
      `
          SELECT ftrv.parameter_id, ftrv.parameter_value, ftrv.mark_status
          FROM fitness_test_results ftr
          JOIN fitness_test_result_values ftrv
            ON ftr.id = ftrv.result_id
          WHERE ftr.student_id = ?
            AND ftr.format_id = ?
            AND ftr.term = 'term1'
        `,
      [result.student_id, result.format_id],
    );

    t1rows.forEach((r) => {
      termValMap[r.parameter_id] = termValMap[r.parameter_id] || {};
      termValMap[r.parameter_id].term1 = {
        value: r.parameter_value,
        status: r.mark_status || null,
      };
    });
  }

  if (hasTerm2) {
    const [t2rows] = await db.query(
      `
          SELECT ftrv.parameter_id, ftrv.parameter_value, ftrv.mark_status
          FROM fitness_test_results ftr
          JOIN fitness_test_result_values ftrv
            ON ftr.id = ftrv.result_id
          WHERE ftr.student_id = ?
            AND ftr.format_id = ?
            AND ftr.term = 'term2'
        `,
      [result.student_id, result.format_id],
    );

    t2rows.forEach((r) => {
      termValMap[r.parameter_id] = termValMap[r.parameter_id] || {};
      termValMap[r.parameter_id].term2 = {
        value: r.parameter_value,
        status: r.mark_status || null,
      };
    });
  }

  // ── DRAW TABLE ROWS ──
  for (let idx = 0; idx < params.length; idx++) {
    const param = params[idx];

    const singleVal = param.parameter_value;

    if (
      !isMultiTerm &&
      (singleVal === null || singleVal === "") &&
      !isPrePrimaryYesNoParam(param)
    ) {
      const termKey = hasTerm1 ? "term1" : "term2";
      const tv = (termValMap[param.id] || {})[termKey];
      if (!tv) continue;
      if (
        (tv.value === null || tv.value === undefined || tv.value === "") &&
        !tv.status
      )
        continue;
    }

    const titleStr = (param.title || "").slice(0, 26);

    // Tests column - wrap text to fit cell width, clamped to max 2 lines
    const testRawText = param.test_display || "";
    const allTestLines = wrapText(testRawText, px(testW) - 6, fontReg, 9);
    const testLines = allTestLines.slice(0, 2); // max 2 lines

    // Description - wrap text to fit cell width, clamped to max 2 lines
    const descText = param.description || "";
    const allDescLines = wrapText(descText, px(descW) - 6, fontReg, 8.5);
    const descLines = allDescLines.slice(0, 2); // max 2 lines

    const descLineSpacingPt = 10; // px between baselines
    const descPadPt = 6; // equal top & bottom padding (pt)
    // Row height based on whichever column (Tests or Description) needs more lines
    const lineCount = Math.max(descLines.length, testLines.length, 1);
    const totalTextHeightPt = lineCount * descLineSpacingPt;
    // Row must be tall enough for text + equal padding on both sides
    const minRowHPt = totalTextHeightPt + descPadPt * 2;
    const dynamicRowH = Math.max(rowH, minRowHPt / MM);

    const bg = idx % 2 === 0 ? rowBg : white;

    // Redraw row background and borders with dynamic height
    page.drawRectangle({
      x: px(15),
      y: py(yMM, dynamicRowH),
      width: px(totalW),
      height: px(dynamicRowH),
      color: bg,
    });

    // Left border
    page.drawLine({
      start: { x: px(15), y: py(yMM, dynamicRowH) },
      end: { x: px(15), y: py(yMM) },
      color: blueBorder,
      thickness: 1.5,
    });
    // Right border
    page.drawLine({
      start: { x: px(15 + totalW), y: py(yMM, dynamicRowH) },
      end: { x: px(15 + totalW), y: py(yMM) },
      color: blueBorder,
      thickness: 1.5,
    });
    // Parameter border
    page.drawLine({
      start: { x: px(15 + paramW), y: py(yMM, dynamicRowH) },
      end: { x: px(15 + paramW), y: py(yMM) },
      color: blueBorder,
      thickness: 1.5,
    });
    // Test border
    page.drawLine({
      start: { x: px(15 + paramW + testW), y: py(yMM, dynamicRowH) },
      end: { x: px(15 + paramW + testW), y: py(yMM) },
      color: blueBorder,
      thickness: 1.5,
    });
    // Description border
    page.drawLine({
      start: { x: px(descStart), y: py(yMM, dynamicRowH) },
      end: { x: px(descStart), y: py(yMM) },
      color: blueBorder,
      thickness: 1.5,
    });
    if (isMultiTerm) {
      page.drawLine({
        start: { x: px(gradeStart), y: py(yMM, dynamicRowH) },
        end: { x: px(gradeStart), y: py(yMM) },
        color: blueBorder,
        thickness: 1.5,
      });
      page.drawLine({
        start: { x: px(term2Start), y: py(yMM, dynamicRowH) },
        end: { x: px(term2Start), y: py(yMM) },
        color: blueBorder,
        thickness: 1.5,
      });
    } else {
      page.drawLine({
        start: { x: px(gradeStart), y: py(yMM, dynamicRowH) },
        end: { x: px(gradeStart), y: py(yMM) },
        color: blueBorder,
        thickness: 1.5,
      });
    }
    // Bottom border
    page.drawLine({
      start: { x: px(15), y: py(yMM) },
      end: { x: px(15 + totalW), y: py(yMM) },
      color: blueBorder,
      thickness: 1.5,
    });

    const rowTextY = py(yMM, dynamicRowH) + px(dynamicRowH) / 2 - 9 * 0.35;

    page.drawText(titleStr, {
      x: px(15) + 3,
      y: rowTextY,
      size: 9.5,
      font: fontBold,
      color: textDark,
    });

    // Tests column - draw wrapped lines, vertically centered like Description
    const rowBottomPtTest = py(yMM, dynamicRowH);
    const rowHeightPtTest = px(dynamicRowH);
    const testBlockHeightPt = testLines.length * descLineSpacingPt;
    const firstTestBaselineY =
      rowBottomPtTest +
      (rowHeightPtTest + testBlockHeightPt) / 2 -
      descLineSpacingPt * 0.8;
    testLines.forEach((tLine, tli) => {
      const tLineY = firstTestBaselineY - tli * descLineSpacingPt;
      // Center each line horizontally within the testW column
      const tLineW = fontReg.widthOfTextAtSize(tLine, 9);
      page.drawText(tLine, {
        x: px(15 + paramW) + (px(testW) - tLineW) / 2,
        y: tLineY,
        size: 9,
        font: fontReg,
        color: textDark,
      });
    });

    // Description - center text block vertically: same space above first line and below last line
    // py(yMM, dynamicRowH) = bottom of row in PDF pts; px(dynamicRowH) = row height in pts
    const rowBottomPt = py(yMM, dynamicRowH);
    const rowHeightPt = px(dynamicRowH);
    // Top of text block (first baseline) — centered
    const blockHeightPt = lineCount * descLineSpacingPt;
    const firstBaselineY =
      rowBottomPt + (rowHeightPt + blockHeightPt) / 2 - descLineSpacingPt * 0.8;
    descLines.forEach((line, li) => {
      const lineY = firstBaselineY - li * descLineSpacingPt;
      page.drawText(line, {
        x: px(descStart) + 3,
        y: lineY,
        size: 8.5,
        font: fontReg,
        color: textDark,
      });
    });

    // Grade calculation
    const studentGender = (result.gender || "").trim().toLowerCase();

    let paramRanges = ranges.filter((r) => r.parameter === param.parameter);

    const genderSpecificRanges = paramRanges.filter((r) => {
      const rGender = (r.gender || "All").trim().toLowerCase();

      if (studentGender === "male" || studentGender === "boy") {
        return rGender === "male" || rGender === "boy";
      } else if (studentGender === "female" || studentGender === "girl") {
        return rGender === "female" || rGender === "girl";
      }

      return false;
    });

    if (genderSpecificRanges.length > 0) {
      paramRanges = genderSpecificRanges;
    } else {
      paramRanges = paramRanges.filter((r) => {
        const rGender = (r.gender || "All").trim().toLowerCase();

        return rGender === "all";
      });
    }

    if (isMultiTerm) {
      const tv1 = (termValMap[param.id] || {}).term1 || {};

      const grade1 = tv1.status
        ? tv1.status
        : isPrePrimaryYesNoParam(param)
          ? gradeYesNo(tv1.value)
          : calculateGrade(tv1.value, paramRanges);

      const color1 = gradeToColor(grade1);

      const gw1 = fontBold.widthOfTextAtSize(grade1, 10);

      page.drawText(grade1, {
        x: px(gradeStart) + (px(gradeW) - gw1) / 2,
        y: rowTextY,
        size: 10,
        font: fontBold,
        color: black,
      });

      const tv2 = (termValMap[param.id] || {}).term2 || {};

      const grade2 = tv2.status
        ? tv2.status
        : isPrePrimaryYesNoParam(param)
          ? gradeYesNo(tv2.value)
          : calculateGrade(tv2.value, paramRanges);

      const color2 = gradeToColor(grade2);

      const gw2 = fontBold.widthOfTextAtSize(grade2, 10);

      page.drawText(grade2, {
        x: px(term2Start) + (px(term2W) - gw2) / 2,
        y: rowTextY,
        size: 10,
        font: fontBold,
        color: black,
      });
    } else {
      const termKey = hasTerm1 ? "term1" : "term2";
      const tv = (termValMap[param.id] || {})[termKey] || {};
      const tvVal =
        tv.value !== undefined && tv.value !== null ? tv.value : singleVal;
      const grade = tv.status
        ? tv.status
        : isPrePrimaryYesNoParam(param)
          ? gradeYesNo(tvVal)
          : calculateGrade(tvVal, paramRanges);

      const gradeColor = gradeToColor(grade);

      const gw = fontBold.widthOfTextAtSize(grade, 10);

      const gx = px(gradeStart) + (px(gradeW) - gw) / 2;

      page.drawText(grade, {
        x: gx,
        y: rowTextY,
        size: 10,
        font: fontBold,
        color: black,
      });
    }

    yMM += dynamicRowH;
  }

  // ── FINAL TABLE BORDER ──
  page.drawLine({
    start: {
      x: px(15),
      y: py(yMM),
    },
    end: {
      x: px(15 + totalW),
      y: py(yMM),
    },
    color: blueBorder,
    thickness: 1.5,
  });

  // ── LEGEND ──
  const legendText =
    "A+ - Excellent  /  A - Good  /  B+ - Developing  /  B - Needs Improvement  /  AB - Absent";

  const legendSize = 8;

  const legendW = fontBold.widthOfTextAtSize(legendText, legendSize);

  const legendX = px(15) + (px(180) - legendW) / 2;

  // Tighter spacing after activities table
  const legendYmm = yMM + (showScanner ? 5 : 7);

  page.drawText(legendText, {
    x: legendX,
    y: py(legendYmm) - 8,
    size: legendSize,
    font: fontBold,
    color: textMed,
  });

  // ── FITNESS GRAPH PAGES ──
  // One A4 page per graph, inserted after the parameter table + legend and
  // before the footer/QR/signature page. Optional: only present when the
  // caller supplies rasterized Plotly PNGs (token-scoped parent flow).
  for (const graphImage of graphImages) {
    const dataUrl = String((graphImage && graphImage.data_url) || "");
    const commaIdx = dataUrl.indexOf(",");
    if (commaIdx === -1) continue;
    const imgBytes = Buffer.from(dataUrl.slice(commaIdx + 1), "base64");
    if (imgBytes.length === 0) continue;

    let embeddedGraph = null;
    try {
      embeddedGraph = await pdfDoc.embedPng(imgBytes);
    } catch (e) {
      console.warn("[PDF] Skipping unembeddable graph image:", e.message);
      continue;
    }

    const graphPage = pdfDoc.addPage([595.28, 841.89]); // A4
    const pageW = graphPage.getWidth();
    const pageH = graphPage.getHeight();
    const graphMarginPx = px(12);
    const availW = pageW - graphMarginPx * 2;

    // Match the parameter backing this graph image so its name, description
    // and video link can be drawn above the chart.
    const graphParam = params.find(
      (p) => String(p.parameter) === String(graphImage.parameter_key),
    );
    const graphParamTitle = graphParam ? String(graphParam.title || "") : "";
    const graphParamDesc = graphParam
      ? String(graphParam.description || "")
      : "";
    const graphVideoLink = graphParam
      ? String(graphParam.video_link || "")
      : "";

    const titleSize = 18;
    const bodySize = 11;
    const bodyLeading = bodySize * 1.35;
    const blockGap = bodySize;
    let cursorY = pageH - graphMarginPx;

    // 1) Parameter name at the top (parameter_info.title).
    if (graphParamTitle) {
      graphPage.drawText(graphParamTitle, {
        x: graphMarginPx,
        y: cursorY - titleSize,
        size: titleSize,
        font: fontBold,
        color: textDark,
      });
      cursorY -= titleSize + blockGap;
    }

    // 2) Parameter description below it, wrapped to the page width.
    if (graphParamDesc) {
      const descLines = wrapText(graphParamDesc, availW, fontReg, bodySize);
      for (const line of descLines) {
        graphPage.drawText(line, {
          x: graphMarginPx,
          y: cursorY - bodySize,
          size: bodySize,
          font: fontReg,
          color: textDark,
        });
        cursorY -= bodyLeading;
      }
    }

    // 3) One line break after the description.
    cursorY -= blockGap;

    // 4) YouTube video URL below the description — plain text + a genuine
    // clickable /Link URI annotation covering the drawn URL rectangle.
    if (graphVideoLink) {
      const urlY = cursorY - bodySize;
      const urlWidth = fontReg.widthOfTextAtSize(graphVideoLink, bodySize);
      graphPage.drawText(graphVideoLink, {
        x: graphMarginPx,
        y: urlY,
        size: bodySize,
        font: fontReg,
        color: blueBorder,
      });

      const linkAnnot = pdfDoc.context.obj({
        Type: "Annot",
        Subtype: "Link",
        Rect: [
          graphMarginPx,
          urlY - 2,
          graphMarginPx + urlWidth,
          urlY + bodySize + 2,
        ],
        Border: [0, 0, 0],
        A: {
          Type: "Action",
          S: "URI",
          URI: PDFString.of(graphVideoLink),
        },
      });
      const linkAnnotRef = pdfDoc.context.register(linkAnnot);
      graphPage.node.addAnnot(linkAnnotRef);

      cursorY -= bodyLeading + blockGap;
    }

    // 5) Existing graph below the parameter information, centered in the
    // remaining vertical space so it stays fully visible on the A4 page.
    const graphBottomY = graphMarginPx;
    const availH = Math.max(cursorY - graphBottomY, 60);
    const scaled = embeddedGraph.scaleToFit(availW, availH);
    graphPage.drawImage(embeddedGraph, {
      x: (pageW - scaled.width) / 2,
      y: graphBottomY + (availH - scaled.height) / 2,
      width: scaled.width,
      height: scaled.height,
    });
  }

  // ── FOOTER AREA ──
  // footerY is dynamically set based on content
  let footerY = legendYmm + (showScanner ? 4 : 6);

  // ── QR SCANNER ──
  if (showScanner) {
    console.log(`[PDF] Adding QR Code at Y: ${footerY}`);

    await addQRCodeSection(pdfDoc, page, resultId, footerY, {
      px,
      py,
      fontBold,
      fontReg,
      black,
      white,
      gray,
      width,
      height,
      totalW,
    });

    // QR box height in addQRCodeSection is boxH=50 + 3 gap + 5 return offset = 58
    footerY += 53;
  }

  // ── SIGNATURES ──
  const sigLineW = 60;

  // Clamp footerY so signatures NEVER get pushed off the bottom of the A4 page (297mm).
  // Total signature block height is ~23mm (image 18mm + name + designation).
  // Max footerY is clamped to 260mm so that footerY + 23mm = 283mm (< 297mm).
  footerY = Math.min(Math.max(footerY, showScanner ? 250 : 242), 260);

  const isEnabled = (val) => val === true || val === 'true' || val === 1 || val === '1';
  const showHeadCoach = isEnabled(result.show_head_coach_signature);
  const showPrincipal = isEnabled(result.show_principal_signature);

  // ── HEAD COACH SIGNATURE ──
  if (showHeadCoach) {
    const startX = 10;
    const centerX = startX + sigLineW / 2;

    if (result.head_coach_signature_image) {
      try {
        const hcSigPath = path.join(
          __dirname,
          "uploads",
          result.head_coach_signature_image,
        );

        if (fs.existsSync(hcSigPath)) {
          const hcSigBytes = fs.readFileSync(hcSigPath);

          let hcSigImg;

          if (hcSigPath.toLowerCase().endsWith(".png")) {
            hcSigImg = await pdfDoc.embedPng(hcSigBytes);
          } else if (hcSigPath.toLowerCase().match(/\.(jpg|jpeg)$/)) {
            hcSigImg = await pdfDoc.embedJpg(hcSigBytes);
          }

          if (hcSigImg) {
            const dims = hcSigImg.scaleToFit(px(45), px(18));

            page.drawImage(hcSigImg, {
              x: px(centerX) - dims.width / 2,
              y: py(footerY, 18) + (px(18) - dims.height) / 2,
              width: dims.width,
              height: dims.height,
            });
          }
        }
      } catch (e) { }
    }

    const hcName = result.head_coach_name || "Head Coach";

    const hcNameLines = wrapText(hcName, px(60), fontReg, 9);

    let hcTextY = footerY + 18.5;

    for (const line of hcNameLines) {
      const lineW = fontReg.widthOfTextAtSize(line, 9);

      page.drawText(line, {
        x: px(centerX) - lineW / 2,
        y: py(hcTextY),
        size: 9,
        font: fontReg,
        color: textMed,
      });

      hcTextY += 4;
    }

    const hcDesig = result.head_coach_designation || "Head Coach";

    const hcDesigLines = wrapText(hcDesig, px(60), fontBold, 10);

    for (const line of hcDesigLines) {
      const lineW = fontBold.widthOfTextAtSize(line, 10);

      page.drawText(line, {
        x: px(centerX) - lineW / 2,
        y: py(hcTextY + 1),
        size: 10,
        font: fontBold,
        color: black,
      });

      hcTextY += 5;
    }
  }

  // ── PRINCIPAL SIGNATURE ──
  if (showPrincipal) {
    const startX = 200 - sigLineW;

    const centerX = startX + sigLineW / 2;

    if (result.principal_signature_image) {
      try {
        const pSigPath = path.join(
          __dirname,
          "uploads",
          result.principal_signature_image,
        );

        if (fs.existsSync(pSigPath)) {
          const pSigBytes = fs.readFileSync(pSigPath);

          let pSigImg;

          if (pSigPath.toLowerCase().endsWith(".png")) {
            pSigImg = await pdfDoc.embedPng(pSigBytes);
          } else if (pSigPath.toLowerCase().match(/\.(jpg|jpeg)$/)) {
            pSigImg = await pdfDoc.embedJpg(pSigBytes);
          }

          if (pSigImg) {
            const dims = pSigImg.scaleToFit(px(50), px(18));

            page.drawImage(pSigImg, {
              x: px(centerX) - dims.width / 2,
              y: py(footerY, 18) + (px(18) - dims.height) / 2,
              width: dims.width,
              height: dims.height,
            });
          }
        }
      } catch (e) { }
    }

    const pName = result.principal_name || "Principal";

    const pNameLines = wrapText(pName, px(60), fontReg, 9);

    let pTextY = footerY + 18.5;

    for (const line of pNameLines) {
      const lineW = fontReg.widthOfTextAtSize(line, 9);

      page.drawText(line, {
        x: px(centerX) - lineW / 2,
        y: py(pTextY),
        size: 9,
        font: fontReg,
        color: textMed,
      });

      pTextY += 4;
    }

    const pDesig = result.principal_designation || "Principal";

    const pDesigLines = wrapText(pDesig, px(60), fontBold, 10);

    for (const line of pDesigLines) {
      const lineW = fontBold.widthOfTextAtSize(line, 10);

      page.drawText(line, {
        x: px(centerX) - lineW / 2,
        y: py(pTextY + 1),
        size: 10,
        font: fontBold,
        color: black,
      });

      pTextY += 5;
    }
  }

  // ── FOOTER (Removed as requested) ──

  const pdfBytes = await pdfDoc.save();

  return pdfBytes;
}

// 📄 SEPARATE FITNESS REPORT PDF BUILDER
// Page 1: Cover Page
// Page 2: Summary / Skill Assessment Table + Badges + Legend + Note
// Page 3+: Fitness Graph Pages
async function buildFitnessReportPDF(resultId, options = {}) {
  const { graphImages = [] } = options;

  // ── 1. Fetch result + student + school ──
  const [[result]] = await db.query(
    `
        SELECT ftr.*, ft.test_name, ft.test_title, ft.academic_year,
               s.name as student_name, s.mq_id, s.std, s.division, s.gender, s.school_id,
               sch.name as school_name, sch.school_logo,
               sch.show_principal_signature, sch.principal_name, sch.principal_designation, sch.principal_signature_image,
               sch.head_coach_name, sch.head_coach_designation,
               sch.show_head_coach_signature, sch.head_coach_signature_image
        FROM fitness_test_results ftr
        JOIN fitness_test_formats ft ON ftr.format_id = ft.id
        JOIN students s ON ftr.student_id = s.id
        JOIN schools sch ON s.school_id = sch.id
        WHERE ftr.id = ?
    `,
    [resultId],
  );

  console.log(
    `[FITNESS PDF] Result fetched for ID: ${resultId}, Found: ${!!result}`,
  );
  if (!result) throw new Error(`Result ${resultId} not found`);

  if (!result.academic_year) {
    result.academic_year = getCurrentAcademicYear();
  }

  // ── 2. Term checks ──
  let hasTerm1 = false;
  let hasTerm2 = false;

  {
    const [t1check] = await db.query(
      `SELECT 1 FROM fitness_test_results WHERE student_id = ? AND format_id = ? AND term = 'term1' LIMIT 1`,
      [result.student_id, result.format_id],
    );
    hasTerm1 = t1check.length > 0;

    const [t2check] = await db.query(
      `SELECT 1 FROM fitness_test_results WHERE student_id = ? AND format_id = ? AND term = 'term2' LIMIT 1`,
      [result.student_id, result.format_id],
    );
    hasTerm2 = t2check.length > 0;
  }

  let isMultiTerm = hasTerm1 && hasTerm2;

  // ── 3. Fetch parameters ──
  const [params] = await db.query(
    `
        SELECT pi.id, pi.title, pi.parameter, pi.ctype, pi.test_display, pi.description, pi.video_link,
               ftrv.parameter_value, fp.parameter_order, fp.id AS fp_id
        FROM fitness_test_format_parameters fp
        JOIN parameter_info pi ON fp.parameter_id = pi.id
        LEFT JOIN fitness_test_result_values ftrv
          ON pi.id = ftrv.parameter_id
          AND ftrv.result_id = ?
        WHERE fp.format_id = ?
        ORDER BY fp.parameter_order
    `,
    [resultId, result.format_id],
  );

  // Term value map
  let termValMap = {};
  if (hasTerm1) {
    const [t1rows] = await db.query(
      `
          SELECT ftrv.parameter_id, ftrv.parameter_value
          FROM fitness_test_results ftr
          JOIN fitness_test_result_values ftrv
            ON ftr.id = ftrv.result_id
          WHERE ftr.student_id = ?
            AND ftr.format_id = ?
            AND ftr.term = 'term1'
        `,
      [result.student_id, result.format_id],
    );

    t1rows.forEach((r) => {
      termValMap[r.parameter_id] = termValMap[r.parameter_id] || {};
      termValMap[r.parameter_id].term1 = r.parameter_value;
    });
  }

  if (hasTerm2) {
    const [t2rows] = await db.query(
      `
          SELECT ftrv.parameter_id, ftrv.parameter_value
          FROM fitness_test_results ftr
          JOIN fitness_test_result_values ftrv
            ON ftr.id = ftrv.result_id
          WHERE ftr.student_id = ?
            AND ftr.format_id = ?
            AND ftr.term = 'term2'
        `,
      [result.student_id, result.format_id],
    );

    t2rows.forEach((r) => {
      termValMap[r.parameter_id] = termValMap[r.parameter_id] || {};
      termValMap[r.parameter_id].term2 = r.parameter_value;
    });
  }

  // ── 4. Grading ranges ──
  const stdCode = getGradeStd(result.std);
  const [ranges] = await db.query(`SELECT * FROM parameter_grades`);

  // ── 5. Setup PDF Document ──
  const pdfDoc = await PDFDocument.create();
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const fontReg = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontOblique = await pdfDoc.embedFont(StandardFonts.HelveticaOblique);

  // Asset paths — stored in server/assets/ so they work on live server too
  const assetDir = path.join(__dirname, "assets");
  const patternPath = path.join(assetDir, "fitness_report_pattern_a4.png");
  const coverGraphicPath = path.join(assetDir, "fitness_report_cover_graphic_2026_2027.png");
  const studentFieldsPath = path.join(assetDir, "fitness_report_student_fields.png");
  const watermarkPath = path.join(assetDir, "pdf-watermark-page.png");
  const mqLogoPath = path.join(assetDir, "marcos_quay_logo.png");
  const badgeExcellentPath = path.join(assetDir, "trophyexcellent.png");
  const badgeGoodPath = path.join(assetDir, "goldgood.png");
  const badgeDevelopingPath = path.join(assetDir, "silverdeveloping.png");
  const badgeNeedsImpPath = path.join(assetDir, "bronzeimpneed.png");

  let patternImg = null;
  let coverImg = null;
  let studentFieldsImg = null;
  let watermarkImg = null;
  let mqLogoImg = null;

  let badgeExcellentImg = null;
  let badgeGoodImg = null;
  let badgeDevelopingImg = null;
  let badgeNeedsImpImg = null;

  if (fs.existsSync(patternPath)) {
    patternImg = await pdfDoc.embedPng(fs.readFileSync(patternPath));
  }
  if (fs.existsSync(coverGraphicPath)) {
    coverImg = await pdfDoc.embedPng(fs.readFileSync(coverGraphicPath));
  }
  if (fs.existsSync(studentFieldsPath)) {
    studentFieldsImg = await pdfDoc.embedPng(
      fs.readFileSync(studentFieldsPath),
    );
  }
  if (fs.existsSync(watermarkPath)) {
    watermarkImg = await pdfDoc.embedPng(fs.readFileSync(watermarkPath));
  }
  if (fs.existsSync(mqLogoPath)) {
    mqLogoImg = await pdfDoc.embedPng(fs.readFileSync(mqLogoPath));
  }

  if (fs.existsSync(badgeExcellentPath)) {
    badgeExcellentImg = await pdfDoc.embedPng(
      fs.readFileSync(badgeExcellentPath),
    );
  }
  if (fs.existsSync(badgeGoodPath)) {
    badgeGoodImg = await pdfDoc.embedPng(fs.readFileSync(badgeGoodPath));
  }
  if (fs.existsSync(badgeDevelopingPath)) {
    badgeDevelopingImg = await pdfDoc.embedPng(
      fs.readFileSync(badgeDevelopingPath),
    );
  }
  if (fs.existsSync(badgeNeedsImpPath)) {
    badgeNeedsImpImg = await pdfDoc.embedPng(
      fs.readFileSync(badgeNeedsImpPath),
    );
  }

  // Helper to add A4 page with background pattern and watermark
  const headerDividerY = 765.89;
  const prepareA4Page = (isCover = false) => {
    const page = pdfDoc.addPage([595.28, 841.89]);
    if (patternImg) {
      page.drawImage(patternImg, { x: 0, y: 0, width: 595.28, height: 841.89 });
    }
    if (!isCover && watermarkImg) {
      const wmScale = watermarkImg.scaleToFit(580, 230);
      page.drawImage(watermarkImg, {
        x: 595.28 - wmScale.width - 7, //move right
        y: headerDividerY - 85,
        width: wmScale.width,
        height: wmScale.height,
      });
    }
    return page;
  };

  // ═════════════════════════════════════════════════════════════════
  // PAGE 1: COVER PAGE
  // ═════════════════════════════════════════════════════════════════
  const page1 = prepareA4Page(true);

  // TOP-LEFT Marcos Quay Logo on Page 1 (Slightly larger)
  if (mqLogoImg) {
    const logoScale = mqLogoImg.scaleToFit(220, 80);
    page1.drawImage(mqLogoImg, {
      x: 38,
      y: 841.89 - 25 - logoScale.height,
      width: logoScale.width,
      height: logoScale.height,
    });
  }

  // Cover Graphic (Visually centered horizontally and vertically balanced)
  if (coverImg) {
    const coverScale = coverImg.scaleToFit(540, 370);
    const coverX = (595.28 - coverScale.width) / 2;
    const coverY = 841.89 - 220 - coverScale.height;
    page1.drawImage(coverImg, {
      x: coverX,
      y: coverY,
      width: coverScale.width,
      height: coverScale.height,
    });
  }

  // Student Fields Card & Dynamic Values
  if (studentFieldsImg) {
    const fieldsScale = studentFieldsImg.scaleToFit(500, 310);
    const fieldsX = (595.28 - fieldsScale.width) / 2;
    const fieldsY = 55;
    page1.drawImage(studentFieldsImg, {
      x: fieldsX,
      y: fieldsY,
      width: fieldsScale.width,
      height: fieldsScale.height,
    });
    const fontRegular = await pdfDoc.embedFont(StandardFonts.Helvetica);
    // Student fields text placement over card
    const cardTopY = fieldsY + fieldsScale.height;
    const valueX = fieldsX + 145;
    const textColor = rgb(0.8, 0.12, 0.12);
    const textFont = fontRegular;
    const baseTextSize = 20;

    const fieldValues = [
      {
        value: String(result.student_name || "").toUpperCase(),
        y: cardTopY - 29,
      },
      {
        // Class → only the standard number
        value: result.std ? String(result.std) : "-",
        y: cardTopY - 63,
      },
      {
        // Grade → only the division
        value: result.division ? String(result.division) : "-",
        y: cardTopY - 95,
      },
      {
        value: isMultiTerm ? "Term 1 & Term 2" : hasTerm1 ? "Term 1" : "Term 2",
        y: cardTopY - 125,
      },
      {
        value: String(result.school_name || "-"),
        y: cardTopY - 155,
      },
    ];

    for (const field of fieldValues) {
      page1.drawText(field.value, {
        x: valueX,
        y: field.y,
        size: baseTextSize,
        font: textFont,
        color: textColor,
      });
    }
  }

  // ═════════════════════════════════════════════════════════════════
  // PAGE 2: SKILL ASSESSMENT / SUMMARY
  // ═════════════════════════════════════════════════════════════════
  const page2 = prepareA4Page(false);

  // SUMMARY Title & Blue Divider
  page2.drawText("SUMMARY", {
    x: 45,
    y: 775,
    size: 16,
    font: fontBold,
    color: rgb(0.8, 0.12, 0.12),
  });

  page2.drawLine({
    start: { x: 45, y: headerDividerY },
    end: { x: 555, y: headerDividerY },
    color: rgb(0.204, 0.471, 0.757),
    thickness: 2,
  });

  // Filter params: ONLY create table rows where we have values in Term 1 or Term 2
  const activeParams = params.filter((p) => {
    const v1 = (termValMap[p.id] || {}).term1;
    const v2 = (termValMap[p.id] || {}).term2;
    const has1 = v1 !== undefined && v1 !== null && String(v1).trim() !== "" && String(v1).trim() !== "--";
    const has2 = v2 !== undefined && v2 !== null && String(v2).trim() !== "" && String(v2).trim() !== "--";
    return has1 || has2;
  });

  const hasAnyTerm1Value = activeParams.some((p) => {
    const v1 = (termValMap[p.id] || {}).term1;
    return v1 !== undefined && v1 !== null && String(v1).trim() !== "" && String(v1).trim() !== "--";
  });

  const hasAnyTerm2Value = activeParams.some((p) => {
    const v2 = (termValMap[p.id] || {}).term2;
    return v2 !== undefined && v2 !== null && String(v2).trim() !== "" && String(v2).trim() !== "--";
  });

  const showTerm1Col = hasAnyTerm1Value;
  const showTerm2Col = hasAnyTerm2Value;

  let colMeasurementW = 255;
  let colTerm1W = 125;
  let colTerm2W = 125;

  if (showTerm1Col && !showTerm2Col) {
    // Only Term 1 has values → ONLY Measurement and Term 1 columns!
    colMeasurementW = 325;
    colTerm1W = 180;
    colTerm2W = 0;
  } else if (!showTerm1Col && showTerm2Col) {
    // Only Term 2 has values → ONLY Measurement and Term 2 columns!
    colMeasurementW = 325;
    colTerm1W = 0;
    colTerm2W = 180;
  }

  const summarySubtitle = (showTerm1Col && showTerm2Col)
    ? "Summary of Academic Performance for Term 1 and Term 2"
    : showTerm2Col
      ? "Summary of Academic Performance for Term 2"
      : "Summary of Academic Performance for Term 1";

  page2.drawText(summarySubtitle, {
    x: 45,
    y: 725,
    size: 11,
    font: fontBold,
    color: rgb(0, 0, 0),
  });

  // Table setup
  const tableLeft = 45;
  const tableWidth = 505;
  let currentY = 710;
  const rowH = 48;

  // Header Row
  page2.drawRectangle({
    x: tableLeft,
    y: currentY - rowH,
    width: tableWidth,
    height: rowH,
    color: rgb(0.82, 0.82, 0.82),
    borderColor: rgb(0, 0, 0),
    borderWidth: 1.5,
  });

  // Header Column Divider 1 (always between Measurement and first term col)
  page2.drawLine({
    start: { x: tableLeft + colMeasurementW, y: currentY },
    end: { x: tableLeft + colMeasurementW, y: currentY - rowH },
    color: rgb(0, 0, 0),
    thickness: 1.2,
  });

  // Header Column Divider 2 (ONLY if both Term 1 and Term 2 are shown)
  if (showTerm1Col && showTerm2Col) {
    page2.drawLine({
      start: { x: tableLeft + colMeasurementW + colTerm1W, y: currentY },
      end: { x: tableLeft + colMeasurementW + colTerm1W, y: currentY - rowH },
      color: rgb(0, 0, 0),
      thickness: 1.2,
    });
  }

  const headerTextY = currentY - rowH / 2 - 3;
  const headerSize = 11;
  const measurementCenterX = tableLeft + colMeasurementW / 2;
  const measurementLabel = "Measurement";
  page2.drawText(measurementLabel, {
    x:
      measurementCenterX -
      fontBold.widthOfTextAtSize(measurementLabel, headerSize) / 2,
    y: headerTextY,
    size: headerSize,
    font: fontBold,
    color: rgb(0.1, 0.2, 0.4),
  });

  if (showTerm1Col && showTerm2Col) {
    const t1Cx = tableLeft + colMeasurementW + colTerm1W / 2;
    const t2Cx = tableLeft + colMeasurementW + colTerm1W + colTerm2W / 2;
    page2.drawText("Term 1", {
      x: t1Cx - fontBold.widthOfTextAtSize("Term 1", headerSize) / 2,
      y: headerTextY,
      size: headerSize,
      font: fontBold,
      color: rgb(0.1, 0.2, 0.4),
    });
    page2.drawText("Term 2", {
      x: t2Cx - fontBold.widthOfTextAtSize("Term 2", headerSize) / 2,
      y: headerTextY,
      size: headerSize,
      font: fontBold,
      color: rgb(0.1, 0.2, 0.4),
    });
  } else if (showTerm1Col) {
    const t1Cx = tableLeft + colMeasurementW + colTerm1W / 2;
    page2.drawText("Term 1", {
      x: t1Cx - fontBold.widthOfTextAtSize("Term 1", headerSize) / 2,
      y: headerTextY,
      size: headerSize,
      font: fontBold,
      color: rgb(0.1, 0.2, 0.4),
    });
  } else if (showTerm2Col) {
    const t2Cx = tableLeft + colMeasurementW + colTerm2W / 2;
    page2.drawText("Term 2", {
      x: t2Cx - fontBold.widthOfTextAtSize("Term 2", headerSize) / 2,
      y: headerTextY,
      size: headerSize,
      font: fontBold,
      color: rgb(0.1, 0.2, 0.4),
    });
  }

  currentY -= rowH;

  // Helper to map grade text to badge image
  const getBadgeImageForGrade = (gradeStr) => {
    const g = String(gradeStr || "")
      .trim()
      .toUpperCase();
    if (g === "A+" || g === "EXCELLENT") return badgeExcellentImg;
    if (g === "A" || g === "GOOD") return badgeGoodImg;
    if (g === "B+" || g === "DEVELOPING") return badgeDevelopingImg;
    if (g === "B" || g === "NEEDS IMPROVEMENT" || g === "NEEDS IMP.")
      return badgeNeedsImpImg;
    return null;
  };

  // Student gender check (Male vs Female vs All)
  const studentGender = (result.gender || "").trim().toLowerCase();

  // Helper to find matching range text based on male/female data
  const getRangeTextForGrade = (pRanges, gradeStr) => {
    if (!pRanges || !pRanges.length || !gradeStr || gradeStr === "--" || gradeStr === "AB" || gradeStr === "NA") return "";
    const match = pRanges.find((r) => String(r.grade || "").trim().toUpperCase() === String(gradeStr || "").trim().toUpperCase());
    if (match && match.min_score !== null && match.max_score !== null) {
      return `${match.min_score} - ${match.max_score}`;
    }
    return "";
  };

  // Draw Cell with Badge, Value, and Range based on Male/Female data
  const drawCellWithValAndRange = (pPage, hasVal, val, clabel, gradeStr, rangeStr, centerX, centerY) => {
    if (!hasVal) {
      const dashW = fontReg.widthOfTextAtSize("-", 12);
      pPage.drawText("-", {
        x: centerX - dashW / 2,
        y: centerY - 4,
        size: 12,
        font: fontReg,
        color: rgb(0.4, 0.4, 0.4),
      });
      return;
    }

    // Badge icon centered in cell
    const bImg = getBadgeImageForGrade(gradeStr);
    if (bImg) {
      const bScale = bImg.scaleToFit(24, 24);
      pPage.drawImage(bImg, {
        x: centerX - bScale.width / 2,
        y: centerY - bScale.height / 2,
        width: bScale.width,
        height: bScale.height,
      });
    }

  };

  // Draw Parameter Rows (ONLY parameters with values)
  for (let i = 0; i < activeParams.length; i++) {
    const param = activeParams[i];
    const paramTitle = String(
      param.title || param.test_display || param.parameter || "",
    );

    // Filter parameter grade ranges (check paramKey or fpKey, test_display compatibility, std matching with fallback, gender matching with fallback to All)
    const paramKey = String(param.parameter || "");
    const fpKey = param.fp_id ? `param${param.fp_id}` : "";
    const testDisp = String(param.test_display || "").trim().toLowerCase();

    let allForParam = ranges.filter((r) => r.parameter === paramKey);
    if (!allForParam.length && fpKey) {
      allForParam = ranges.filter((r) => r.parameter === fpKey);
    }

    // 1. Filter by test_display compatibility first (matching test_display or empty)
    let compatibleRows = testDisp
      ? allForParam.filter((r) => (r.test_display || "").trim().toLowerCase() === testDisp)
      : [];
    if (!compatibleRows.length) {
      compatibleRows = allForParam.filter((r) => !(r.test_display || "").trim());
    }
    if (!compatibleRows.length) {
      compatibleRows = allForParam;
    }

    // 2. Standard matching (stdCode -> '0' -> closest available std -> any)
    let stdRows = compatibleRows.filter((r) => String(r.std) === String(stdCode));
    if (!stdRows.length) {
      stdRows = compatibleRows.filter((r) => String(r.std) === "0");
    }
    if (!stdRows.length) {
      const stdNum = parseInt(stdCode) || 0;
      const availableStds = [
        ...new Set(
          compatibleRows
            .map((r) => parseInt(r.std))
            .filter((n) => !isNaN(n)),
        ),
      ];
      if (availableStds.length) {
        availableStds.sort(
          (a, b) => Math.abs(a - stdNum) - Math.abs(b - stdNum),
        );
        const bestStd = String(availableStds[0]);
        stdRows = compatibleRows.filter((r) => String(r.std) === bestStd);
      }
    }
    if (!stdRows.length) stdRows = compatibleRows;

    // 3. Gender matching: target gender (Male / Female) -> Fallback to "All" -> any
    const isMale = studentGender === "male" || studentGender === "boy";
    const isFemale = studentGender === "female" || studentGender === "girl";
    const targetGender = isMale ? "male" : isFemale ? "female" : "all";

    let genderRows = stdRows.filter(
      (r) => (r.gender || "All").trim().toLowerCase() === targetGender,
    );
    if (!genderRows.length) {
      genderRows = stdRows.filter(
        (r) => (r.gender || "All").trim().toLowerCase() === "all",
      );
    }
    if (!genderRows.length) genderRows = stdRows;

    let paramRanges = genderRows;

    // Term values & grades
    const rawVal1 = (termValMap[param.id] || {}).term1;
    const hasVal1 = rawVal1 !== undefined && rawVal1 !== null && String(rawVal1).trim() !== "" && String(rawVal1).trim() !== "--";
    const grade1 = hasVal1
      ? (isPrePrimaryYesNoParam(param) ? gradeYesNo(rawVal1) : calculateGrade(rawVal1, paramRanges))
      : "--";
    const range1 = hasVal1 ? getRangeTextForGrade(paramRanges, grade1) : "";

    const rawVal2 = (termValMap[param.id] || {}).term2;
    const hasVal2 = rawVal2 !== undefined && rawVal2 !== null && String(rawVal2).trim() !== "" && String(rawVal2).trim() !== "--";
    const grade2 = hasVal2
      ? (isPrePrimaryYesNoParam(param) ? gradeYesNo(rawVal2) : calculateGrade(rawVal2, paramRanges))
      : "--";
    const range2 = hasVal2 ? getRangeTextForGrade(paramRanges, grade2) : "";

    // Row Container
    page2.drawRectangle({
      x: tableLeft,
      y: currentY - rowH,
      width: tableWidth,
      height: rowH,
      borderColor: rgb(0, 0, 0),
      borderWidth: 1,
    });

    // Divider 1 (after Measurement column)
    page2.drawLine({
      start: { x: tableLeft + colMeasurementW, y: currentY },
      end: { x: tableLeft + colMeasurementW, y: currentY - rowH },
      color: rgb(0, 0, 0),
      thickness: 1,
    });

    // Divider 2 (ONLY if both Term 1 and Term 2 are shown)
    if (showTerm1Col && showTerm2Col) {
      page2.drawLine({
        start: { x: tableLeft + colMeasurementW + colTerm1W, y: currentY },
        end: { x: tableLeft + colMeasurementW + colTerm1W, y: currentY - rowH },
        color: rgb(0, 0, 0),
        thickness: 1,
      });
    }

    // Measurement Title
    const nameSize =
      fontBold.widthOfTextAtSize(paramTitle, 9.5) > colMeasurementW - 20 ? 8.5 : 9.5;
    page2.drawText(paramTitle, {
      x:
        measurementCenterX -
        fontBold.widthOfTextAtSize(paramTitle, nameSize) / 2,
      y: currentY - rowH / 2 - 3,
      size: nameSize,
      font: fontBold,
      color: rgb(0.15, 0.15, 0.15),
    });

    // Draw Term Cells dynamically
    const centerY = currentY - rowH / 2;
    if (showTerm1Col && showTerm2Col) {
      drawCellWithValAndRange(page2, hasVal1, rawVal1, param.clabel, grade1, range1, tableLeft + colMeasurementW + colTerm1W / 2, centerY);
      drawCellWithValAndRange(page2, hasVal2, rawVal2, param.clabel, grade2, range2, tableLeft + colMeasurementW + colTerm1W + colTerm2W / 2, centerY);
    } else if (showTerm1Col) {
      drawCellWithValAndRange(page2, hasVal1, rawVal1, param.clabel, grade1, range1, tableLeft + colMeasurementW + colTerm1W / 2, centerY);
    } else if (showTerm2Col) {
      drawCellWithValAndRange(page2, hasVal2, rawVal2, param.clabel, grade2, range2, tableLeft + colMeasurementW + colTerm2W / 2, centerY);
    }

    currentY -= rowH;
  }

  // Legend Area
  const legendY = currentY - 25;
  const drawLegendItem = (pPage, bImg, labelText, startX, startY) => {
    if (bImg) {
      const bScale = bImg.scaleToFit(18, 18);
      pPage.drawImage(bImg, {
        x: startX,
        y: startY - bScale.height / 2,
        width: bScale.width,
        height: bScale.height,
      });
    }
    pPage.drawText(labelText, {
      x: startX + 22,
      y: startY - 3.5,
      size: 9,
      font: fontBold,
      color: rgb(0.2, 0.2, 0.2),
    });
    return 22 + fontBold.widthOfTextAtSize(labelText, 9);
  };

  const separator = "/";
  const sepW = fontBold.widthOfTextAtSize(separator, 9);
  const legendItems = [
    { img: badgeExcellentImg, label: "Excellent" },
    { img: badgeGoodImg, label: "Good" },
    { img: badgeDevelopingImg, label: "Developing" },
    { img: badgeNeedsImpImg, label: "Needs Improvement" },
  ];
  const totalLegendWidth = legendItems.reduce((acc, item, i) => {
    let itemW = 22 + fontBold.widthOfTextAtSize(item.label, 9);
    if (i < legendItems.length - 1) itemW += 9 + sepW + 9;
    return acc + itemW;
  }, 0);
  let legendX = tableLeft + (tableWidth - totalLegendWidth) / 2;
  for (let li = 0; li < legendItems.length; li++) {
    const item = legendItems[li];
    legendX += drawLegendItem(page2, item.img, item.label, legendX, legendY);
    if (li < legendItems.length - 1) {
      legendX += 9;
      page2.drawText(separator, {
        x: legendX,
        y: legendY - 3.5,
        size: 9,
        font: fontBold,
        color: rgb(0.35, 0.35, 0.35),
      });
      legendX += sepW + 9;
    }
  }

  // ── SIGNATURES ON PAGE 2 ──
  const isEnabled = (val) => val === true || val === 'true' || val === 1 || val === '1';
  const showHeadCoach = isEnabled(result.show_head_coach_signature);
  const showPrincipal = isEnabled(result.show_principal_signature);

  if (showHeadCoach || showPrincipal) {
    const sigBaseY = Math.max(noteY + 35, Math.min(legendY - 55, 95));

    if (showHeadCoach) {
      const hcCenterX = tableLeft + 80;
      if (result.head_coach_signature_image) {
        try {
          const hcSigPath = path.join(__dirname, "uploads", result.head_coach_signature_image);
          if (fs.existsSync(hcSigPath)) {
            const hcSigBytes = fs.readFileSync(hcSigPath);
            let hcSigImg;
            if (hcSigPath.toLowerCase().endsWith(".png")) {
              hcSigImg = await pdfDoc.embedPng(hcSigBytes);
            } else if (hcSigPath.toLowerCase().match(/\.(jpg|jpeg)$/)) {
              hcSigImg = await pdfDoc.embedJpg(hcSigBytes);
            }
            if (hcSigImg) {
              const dims = hcSigImg.scaleToFit(110, 32);
              page2.drawImage(hcSigImg, {
                x: hcCenterX - dims.width / 2,
                y: sigBaseY + 16,
                width: dims.width,
                height: dims.height,
              });
            }
          } else {
            console.warn(`[FITNESS PDF] Head coach signature file not found: ${hcSigPath}`);
          }
        } catch (e) {
          console.error("[FITNESS PDF] Error embedding head coach signature:", e.message);
        }
      }

      const hcName = result.head_coach_name || "Head Coach";
      const hcNameW = fontReg.widthOfTextAtSize(hcName, 9);
      page2.drawText(hcName, {
        x: hcCenterX - hcNameW / 2,
        y: sigBaseY + 7,
        size: 9,
        font: fontReg,
        color: rgb(0.2, 0.2, 0.2),
      });

      const hcDesig = result.head_coach_designation || "Head Coach";
      const hcDesigW = fontBold.widthOfTextAtSize(hcDesig, 9.5);
      page2.drawText(hcDesig, {
        x: hcCenterX - hcDesigW / 2,
        y: sigBaseY - 4,
        size: 9.5,
        font: fontBold,
        color: rgb(0, 0, 0),
      });
    }

    if (showPrincipal) {
      const pCenterX = tableLeft + tableWidth - 80;
      if (result.principal_signature_image) {
        try {
          const pSigPath = path.join(__dirname, "uploads", result.principal_signature_image);
          if (fs.existsSync(pSigPath)) {
            const pSigBytes = fs.readFileSync(pSigPath);
            let pSigImg;
            if (pSigPath.toLowerCase().endsWith(".png")) {
              pSigImg = await pdfDoc.embedPng(pSigBytes);
            } else if (pSigPath.toLowerCase().match(/\.(jpg|jpeg)$/)) {
              pSigImg = await pdfDoc.embedJpg(pSigBytes);
            }
            if (pSigImg) {
              const dims = pSigImg.scaleToFit(110, 32);
              page2.drawImage(pSigImg, {
                x: pCenterX - dims.width / 2,
                y: sigBaseY + 16,
                width: dims.width,
                height: dims.height,
              });
            }
          } else {
            console.warn(`[FITNESS PDF] Principal signature file not found: ${pSigPath}`);
          }
        } catch (e) {
          console.error("[FITNESS PDF] Error embedding principal signature:", e.message);
        }
      }

      const pName = result.principal_name || "Principal";
      const pNameW = fontReg.widthOfTextAtSize(pName, 9);
      page2.drawText(pName, {
        x: pCenterX - pNameW / 2,
        y: sigBaseY + 7,
        size: 9,
        font: fontReg,
        color: rgb(0.2, 0.2, 0.2),
      });

      const pDesig = result.principal_designation || "Principal";
      const pDesigW = fontBold.widthOfTextAtSize(pDesig, 9.5);
      page2.drawText(pDesig, {
        x: pCenterX - pDesigW / 2,
        y: sigBaseY - 4,
        size: 9.5,
        font: fontBold,
        color: rgb(0, 0, 0),
      });
    }
  }

  // Disclaimer Note
  const noteY = 55;
  const disclaimerText =
    "Note :- This comparison is intended only to highlight the child's developmental progress and is not meant for comparison with other students, as each child has unique abilities and potential.";
  const noteLines = wrapText(disclaimerText, tableWidth, fontBold, 8.5);

  let curNoteY = noteY;
  for (const line of noteLines) {
    page2.drawText(line, {
      x: tableLeft,
      y: curNoteY,
      size: 8.5,
      font: fontBold,
      color: rgb(0, 0, 0),
    });
    curNoteY -= 11;
  }

  // ═════════════════════════════════════════════════════════════════
  // PAGE 3+: FITNESS GRAPH PAGES
  // ═════════════════════════════════════════════════════════════════
  for (const graphImage of graphImages) {
    const dataUrl = String((graphImage && graphImage.data_url) || "");
    const commaIdx = dataUrl.indexOf(",");
    if (commaIdx === -1) continue;
    const imgBytes = Buffer.from(dataUrl.slice(commaIdx + 1), "base64");
    if (imgBytes.length === 0) continue;

    let embeddedGraph = null;
    try {
      embeddedGraph = await pdfDoc.embedPng(imgBytes);
    } catch (e) {
      console.warn("[PDF] Skipping unembeddable graph image:", e.message);
      continue;
    }

    const graphPage = prepareA4Page(false);
    const pageW = 595.28;
    const pageH = 841.89;
    const margin = 28;
    const availW = pageW - margin * 2;

    const graphParam = params.find(
      (p) => String(p.parameter) === String(graphImage.parameter_key),
    );
    const graphParamTitle = graphParam ? String(graphParam.title || "") : "";
    const graphParamDesc = graphParam
      ? String(graphParam.description || "")
      : "";
    const graphVideoLink = graphParam
      ? String(graphParam.video_link || "")
      : "";

    const titleSize = 18;
    const bodySize = 10.5;
    const bodyLeading = bodySize * 1.35;
    const blockGap = bodySize;
    let cursorY = pageH - margin - 20;

    // 1) Parameter Title + Blue Divider
    if (graphParamTitle) {
      graphPage.drawText(graphParamTitle.toUpperCase(), {
        x: margin,
        y: cursorY - titleSize,
        size: 16,
        font: fontBold,
        color: rgb(0.8, 0.12, 0.12),
      });

      graphPage.drawLine({
        start: { x: margin, y: headerDividerY },
        end: { x: pageW - margin, y: headerDividerY },
        color: rgb(0.204, 0.471, 0.757),
        thickness: 2,
      });

      cursorY -= titleSize + blockGap + 12;
    }

    // 2) Parameter Description
    if (graphParamDesc) {
      const descLines = wrapText(graphParamDesc, availW, fontReg, bodySize);
      for (const line of descLines) {
        graphPage.drawText(line, {
          x: margin,
          y: cursorY - bodySize,
          size: bodySize,
          font: fontReg,
          color: rgb(0.129, 0.129, 0.129),
        });
        cursorY -= bodyLeading;
      }
    }

    cursorY -= blockGap;

    // 3) Video Link
    if (graphVideoLink) {
      const urlY = cursorY - bodySize;
      const urlWidth = fontReg.widthOfTextAtSize(graphVideoLink, bodySize);
      graphPage.drawText(graphVideoLink, {
        x: margin,
        y: urlY,
        size: bodySize,
        font: fontReg,
        color: rgb(0.204, 0.471, 0.757),
      });

      const linkAnnot = pdfDoc.context.obj({
        Type: "Annot",
        Subtype: "Link",
        Rect: [margin, urlY - 2, margin + urlWidth, urlY + bodySize + 2],
        Border: [0, 0, 0],
        A: {
          Type: "Action",
          S: "URI",
          URI: PDFString.of(graphVideoLink),
        },
      });
      const linkAnnotRef = pdfDoc.context.register(linkAnnot);
      graphPage.node.addAnnot(linkAnnotRef);

      cursorY -= bodyLeading + blockGap;
    }

    // 4) Graph Image
    const graphBottomY = margin;
    const availH = Math.max(cursorY - graphBottomY, 60);
    const scaled = embeddedGraph.scaleToFit(availW, availH);
    graphPage.drawImage(embeddedGraph, {
      x: (pageW - scaled.width) / 2,
      y: graphBottomY + (availH - scaled.height) / 2,
      width: scaled.width,
      height: scaled.height,
    });
  }

  const pdfBytes = await pdfDoc.save();
  return pdfBytes;
}

function stdCodeOfStd(stdVal) {
  if (!stdVal) return 0;
  const clean = String(stdVal).trim().toLowerCase();
  if (clean === "nursery") return 1;
  if (clean.includes("junior") || clean.includes("jr") || clean === "jkg")
    return 2;
  if (clean.includes("senior") || clean.includes("sr") || clean === "skg")
    return 13;
  const romanOrNumericMap = {
    i: 3,
    1: 3,
    "1st": 3,
    ii: 4,
    2: 4,
    "2nd": 4,
    iii: 5,
    3: 5,
    "3rd": 5,
    iv: 6,
    4: 6,
    "4th": 6,
    v: 7,
    5: 7,
    "5th": 7,
    vi: 8,
    6: 8,
    "6th": 8,
    vii: 9,
    7: 9,
    "7th": 9,
    viii: 10,
    8: 10,
    "8th": 10,
    ix: 11,
    9: 11,
    "9th": 11,
    x: 12,
    10: 12,
    "10th": 12,
  };
  if (romanOrNumericMap[clean]) return romanOrNumericMap[clean];
  const match = clean.match(/\d+/);
  if (match) {
    const num = parseInt(match[0]);
    if (num >= 1 && num <= 10) return num + 2;
  }
  return parseInt(stdVal) || 0;
}

async function getOutOfRangeMarks(resultId) {
  const [[result]] = await db.query(
    `SELECT ftr.*, s.std, s.gender
     FROM fitness_test_results ftr
     JOIN students s ON s.id = ftr.student_id
     WHERE ftr.id = ?`,
    [resultId],
  );
  if (!result) return [];

  const [termRows] = await db.query(
    `SELECT id, term FROM fitness_test_results
     WHERE student_id = ? AND format_id = ? AND term IN ('term1', 'term2')`,
    [result.student_id, result.format_id],
  );
  if (termRows.length === 0) return [];

  const [params] = await db.query(
    `SELECT fp.parameter_id, pi.parameter, pi.test_display, pi.ctype, pi.clabel
     FROM fitness_test_format_parameters fp
     JOIN parameter_info pi ON pi.id = fp.parameter_id
     WHERE fp.format_id = ?`,
    [result.format_id],
  );

  const targetStdCode = stdCodeOfStd(result.std);
  const studentGender = String(result.gender || "")
    .trim()
    .toLowerCase();

  const resolveRange = async (p) => {
    const [rangeRows] = await db.query(
      `SELECT * FROM parameter_grades WHERE parameter = ? AND std IN (?, 0) ORDER BY std DESC`,
      [p.parameter, targetStdCode],
    );
    if (rangeRows.length === 0) return null;

    const firstStd = rangeRows[0].std;
    let sameStd = rangeRows.filter((r) => r.std === firstStd);

    const testDisp = String(p.test_display || "").trim();
    const testDispRows = sameStd.filter(
      (r) => String(r.test_display || "").trim() === testDisp,
    );
    if (testDispRows.length > 0) sameStd = testDispRows;

    let genderRanges = sameStd.filter((r) => {
      const rg = String(r.gender || "All")
        .trim()
        .toLowerCase();
      if (studentGender === "male" || studentGender === "boy")
        return rg === "male" || rg === "boy";
      if (studentGender === "female" || studentGender === "girl")
        return rg === "female" || rg === "girl";
      return false;
    });
    if (genderRanges.length === 0) {
      genderRanges = sameStd.filter(
        (r) =>
          String(r.gender || "All")
            .trim()
            .toLowerCase() === "all",
      );
    }
    if (genderRanges.length === 0) return null;

    const minVal = Math.min(
      ...genderRanges
        .map((r) => parseFloat(r.min_score))
        .filter((x) => !isNaN(x)),
    );
    const maxVal = Math.max(
      ...genderRanges
        .map((r) => parseFloat(r.max_score))
        .filter((x) => !isNaN(x)),
    );
    if (isNaN(minVal) || isNaN(maxVal)) return null;

    return { minVal, maxVal };
  };

  const hasValue = (pv) =>
    pv !== null && pv !== undefined && String(pv).trim() !== "";

  const outOfRange = [];

  for (const termRow of termRows) {
    const [values] = await db.query(
      `SELECT parameter_id, parameter_value, mark_status FROM fitness_test_result_values WHERE result_id = ?`,
      [termRow.id],
    );

    const isMarkedStatus = (v) =>
      v && v.mark_status && (v.mark_status === "AB" || v.mark_status === "NA");

    const populated = new Set(
      values
        .filter((v) => hasValue(v.parameter_value) || isMarkedStatus(v))
        .map((v) => v.parameter_id),
    );

    for (const v of values) {
      if (isMarkedStatus(v)) continue;
      if (!hasValue(v.parameter_value)) continue;
      const strVal = String(v.parameter_value).trim();
      const num = parseFloat(strVal);
      if (isNaN(num)) continue;

      const p = params.find((x) => x.parameter_id == v.parameter_id);
      if (!p || !p.parameter) continue;
      const ctype = String(p.ctype || "").toLowerCase();
      if (ctype === "yes/no" || ctype === "boolean" || ctype === "text")
        continue;

      const range = await resolveRange(p);
      if (!range) continue;

      if (num < range.minVal || num > range.maxVal) {
        outOfRange.push({
          term: termRow.term,
          parameter_id: p.parameter_id,
          parameter: p.parameter,
          test_display: p.test_display || "",
          parameter_value: strVal,
          min_score: range.minVal,
          max_score: range.maxVal,
          unit: p.clabel || "",
        });
      }
    }

    for (const p of params) {
      if (!p.parameter) continue;
      if (populated.has(p.parameter_id)) continue;
      const ctype = String(p.ctype || "").toLowerCase();
      if (ctype === "yes/no" || ctype === "boolean" || ctype === "text")
        continue;

      const range = await resolveRange(p);
      if (!range) continue;

      outOfRange.push({
        term: termRow.term,
        parameter_id: p.parameter_id,
        parameter: p.parameter,
        test_display: p.test_display || "",
        parameter_value: "",
        min_score: range.minVal,
        max_score: range.maxVal,
        unit: p.clabel || "",
        missing: true,
      });
    }
  }

  return outOfRange;
}

// 📄 POST /api/reports/generate-pdf  →  generate & cache PDF for one result_id
// GET /api/reports/check?ids=1,2,3 -> { results: { [result_id]: { ready, out_of_range, missing, items } } } (read-only pre-check for the mobile app)
app.get("/api/reports/check", async (req, res) => {
  try {
    const ids = String(req.query.ids || "").split(",").map((x) => parseInt(x)).filter(Boolean).slice(0, 500);
    const results = {};
    for (const id of ids) {
      const items = await getOutOfRangeMarks(id);
      const missing = items.filter((i) => i.missing).length;
      results[id] = { ready: items.length === 0, out_of_range: items.length - missing, missing, items: items.slice(0, 20) };
    }
    res.json({ success: true, results });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.post("/api/reports/generate-pdf", async (req, res) => {
  const { result_id, options } = req.body;
  if (!result_id)
    return res
      .status(400)
      .json({ success: false, message: "result_id required" });

  try {
    const outOfRange = await getOutOfRangeMarks(result_id);
    if (outOfRange.length > 0) {
      const [[studentRow]] = await db.query(
        `SELECT s.name FROM fitness_test_results ftr JOIN students s ON s.id = ftr.student_id WHERE ftr.id = ?`,
        [result_id],
      );
      const studentName = studentRow ? studentRow.name : `#${result_id}`;
      return res.json({
        success: false,
        message: `${studentName}'s marks were filled out of range.`,
        studentName,
        result_id,
        outOfRange,
      });
    }

    const pdfBytes = await buildReportPDF(result_id, options);
    const filePath = path.join(PDF_TEMP_DIR, `report_${result_id}.pdf`);
    fs.writeFileSync(filePath, pdfBytes);

    // ── Update PDF status in database (Legacy Parity) ──
    try {
      const [[student]] = await db.query(
        `
        SELECT s.name, s.std, s.division FROM fitness_test_results ftr 
        JOIN students s ON ftr.student_id = s.id WHERE ftr.id = ?
      `,
        [result_id],
      );
      const safeName = student
        ? student.name.replace(/[^a-z0-9]/gi, "_")
        : "Result";
      const filename = `Fitness_Test_${safeName}_${result_id}.pdf`;
      await db.query(
        "UPDATE fitness_test_results SET pdf_status = 1, pdf_file_name = ? WHERE id = ?",
        [filename, result_id],
      );
    } catch (dbErr) {
      console.warn("[PDF] Failed to update DB status:", dbErr.message);
    }

    await auditAction(req, () => ({
      page: "Reports",
      type: "GENERATE",
      action: `Generated report-card PDF for result #${result_id}`,
      entity: { type: "Result", id: result_id },
    }));

    res.json({ success: true, filename: `report_${result_id}.pdf` });
  } catch (err) {
    console.error("PDF GEN ERROR:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 📝 POST /api/reports/save-mark-status → persist Absent (AB) / NA for an untouched parameter

; // stripped /api/reports/save-mark-status


// 📥 GET /api/reports/download-zip?ids=1,2,3&overrides=...
// → stream ZIP of fresh-generated PDFs
app.get("/api/reports/download-zip", async (req, res) => {
  const { ids } = req.query;

  if (!ids) {
    return res.status(400).json({
      success: false,
      message: "ids required",
    });
  }

  // Read the same report options used by single PDF download
  let options = {};

  try {
    options = req.query.overrides
      ? JSON.parse(String(req.query.overrides))
      : {};
  } catch (err) {
    return res.status(400).json({
      success: false,
      message: "Invalid overrides parameter",
    });
  }

  console.log("[ZIP] Report options:", options);

  const idList = String(ids)
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);

  const divisionByResultId = new Map();
  if (idList.length > 0) {
    let divisionRows;
    try {
      [divisionRows] = await db.query(
        `SELECT ftr.id AS result_id, s.division
         FROM fitness_test_results ftr
         JOIN students s ON s.id = ftr.student_id
         WHERE ftr.id IN (?)`,
        [idList],
      );
    } catch (err) {
      console.error("[ZIP] Failed to load student divisions:", err);
      return res.status(500).json({
        success: false,
        message: "Failed to load student divisions.",
      });
    }

    for (const row of divisionRows) {
      divisionByResultId.set(String(row.result_id), row.division);
    }
  }

  // Fetch student info for PDF names and division folders.
  let studentMap = new Map();
  try {
    const [students] = await db.query(
      `
      SELECT ftr.id, s.name as student_name, s.std, s.division
      FROM fitness_test_results ftr
      JOIN students s ON ftr.student_id = s.id
      WHERE ftr.id IN (?)
    `,
      [idList],
    );
    for (const s of students) {
      studentMap.set(String(s.id), s);
    }
  } catch (dbErr) {
    console.warn(
      "[ZIP] Failed to query student details for folder hierarchy:",
      dbErr.message,
    );
  }

  const zipName = `MQ_ReportCards_${Date.now()}.zip`;

  res.setHeader("Content-Type", "application/zip");
  res.setHeader("Content-Disposition", `attachment; filename="${zipName}"`);

  const archive = archiver("zip", {
    zlib: { level: 6 },
  });

  archive.on("error", (err) => {
    console.error("ZIP ERROR:", err);
    res.end();
  });

  archive.pipe(res);

  let found = 0;
  const usedEntryPaths = new Set();

  for (const id of idList) {
    try {
      // Generate the PDF using the selected QR/term options
      const pdfBytes = await buildReportPDF(id, options);

      const student = studentMap.get(String(id));
      const stdRaw = student?.std ? String(student.std).trim() : "Other";
      let cleanGradeFolder = stdRaw;
      if (stdRaw === "-3" || stdRaw.toLowerCase() === "nursery") cleanGradeFolder = "Nursery";
      else if (stdRaw === "-2" || stdRaw.toLowerCase().includes("jr")) cleanGradeFolder = "Jr. KG";
      else if (stdRaw === "-1" || stdRaw.toLowerCase().includes("sr")) cleanGradeFolder = "Sr. KG";
      else if (/^\d+$/.test(stdRaw)) cleanGradeFolder = `Grade ${stdRaw}`;
      else if (!/^grade|^std/i.test(stdRaw) && stdRaw !== "Other") cleanGradeFolder = `Grade ${stdRaw}`;
      cleanGradeFolder = cleanGradeFolder.replace(/[/\\?%*:|"<>]/g, "_").trim();

      const divRaw = student?.division
        ? String(student.division).trim().toUpperCase().replace(/^DIV(ISION)?\s*/i, "")
        : "";
      const folderDivision = divisionByResultId.get(id) ?? student?.division;
      const folderDivRaw = folderDivision
        ? String(folderDivision).trim().toUpperCase().replace(/^DIV(ISION)?\s*/i, "")
        : "";
      const cleanDivisionFolder = folderDivRaw
        ? `Division ${folderDivRaw}`.replace(/[/\\?%*:|"<>]/g, "_").trim()
        : "Division_Unassigned";

      const safeStudentName = student?.student_name
        ? student.student_name.trim().replace(/[/\\?%*:|"<>]/g, "_")
        : `report_${id}`;

      // File name format: StudentName_Grade_Div.pdf (e.g. John_Doe_Grade_1_Div_A.pdf)
      const fileNameBase = divRaw
        ? `${safeStudentName}_${cleanGradeFolder}_Div_${divRaw}`
        : `${safeStudentName}_${cleanGradeFolder}`;
      const cleanFileName = fileNameBase.replace(/[/\\?%*:|"<>]/g, "_").trim();

      let zipEntryPath = `${cleanDivisionFolder}/${cleanFileName}.pdf`;

      if (usedEntryPaths.has(zipEntryPath)) {
        zipEntryPath = `${cleanDivisionFolder}/${cleanFileName}_${id}.pdf`;
      }
      usedEntryPaths.add(zipEntryPath);

      archive.append(Buffer.from(pdfBytes), {
        name: zipEntryPath,
      });

      found++;
    } catch (err) {
      console.warn(`[ZIP] Failed to generate PDF for ID ${id}:`, err.message);
    }
  }

  if (found === 0) {
    archive.abort();

    return res.status(404).json({
      success: false,
      message: "No PDFs could be generated.",
    });
  }

  auditAction(req, () => ({
    page: "Reports",
    type: "DOWNLOAD",
    action: `Downloaded report-card ZIP "${zipName}" (${found} PDF(s))`,
  }));

  archive.finalize();
});

// 📥 GET /api/reports/download-single/:result_id  →  download one PDF with potential overrides
app.get("/api/reports/download-single/:result_id", async (req, res) => {
  const { result_id } = req.params;
  const options = req.query.overrides ? JSON.parse(req.query.overrides) : {};

  try {
    console.log(`[PDF] Starting single download for ID: ${result_id}`, options);
    const pdfBytes = await buildReportPDF(result_id, options);
    console.log(
      `[PDF] Success generating for ID: ${result_id}, size: ${pdfBytes.length}`,
    );

    // ── Update PDF status in database (Legacy Parity) ──
    let filename = `report_${result_id}.pdf`;
    try {
      const [[student]] = await db.query(
        `
        SELECT s.name, s.std, s.division FROM fitness_test_results ftr 
        JOIN students s ON ftr.student_id = s.id WHERE ftr.id = ?
      `,
        [result_id],
      );
      if (student) {
        const safeName = String(student.name || "Student").trim().replace(/[/\\?%*:|"<>]/g, "_");
        let stdStr = String(student.std || "").trim();
        if (stdStr === "-3" || stdStr.toLowerCase() === "nursery") stdStr = "Nursery";
        else if (stdStr === "-2" || stdStr.toLowerCase().includes("jr")) stdStr = "Jr_KG";
        else if (stdStr === "-1" || stdStr.toLowerCase().includes("sr")) stdStr = "Sr_KG";
        else if (/^\d+$/.test(stdStr)) stdStr = `Grade_${stdStr}`;
        const divClean = String(student.division || "")
          .trim()
          .toUpperCase()
          .replace(/^DIV(ISION)?\s*/i, "");
        const divStr = divClean ? `_Div_${divClean}` : "";
        filename = `${safeName}_${stdStr}${divStr}_ReportCard.pdf`;
      }
      await db.query(
        "UPDATE fitness_test_results SET pdf_status = 1, pdf_file_name = ? WHERE id = ?",
        [filename, result_id],
      );
    } catch (dbErr) {
      console.warn("[PDF] Failed to update DB status:", dbErr.message);
    }

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${filename}"`);
    res.send(Buffer.from(pdfBytes));
  } catch (err) {
    console.error("Single Download Error:", err);
    // Send 500 but as text so the user can see the error message in the browser if it fails
    res
      .status(500)
      .send(`Error generating PDF: ${err.message}\n\nStack: ${err.stack}`);
  }
});

// 📥 GET /api/reports/detail-pdf/:result_id  →  download the detailed fitness report PDF
//   Same PDF that parents get after QR scan + OTP, but accessible directly by admin/coach.
//   No OTP required — caller must be authenticated (session/JWT) like any other admin endpoint.
app.all("/api/reports/detail-pdf/:result_id", async (req, res) => {
  const { result_id } = req.params;
  try {
    const graphImages = Array.isArray(req.body && req.body.graph_images)
      ? req.body.graph_images.filter((gi) => gi && typeof gi.data_url === "string")
      : [];
    console.log(`[DETAIL-PDF] Generating detail fitness PDF (${graphImages.length} graphs) for result_id: ${result_id}`);
    const pdfBytes = await buildFitnessReportPDF(Number(result_id), { graphImages });
    console.log(`[DETAIL-PDF] Generated ${pdfBytes.length} bytes for result_id: ${result_id}`);

    // Build a clean filename
    let filename = `DetailReport_${result_id}.pdf`;
    try {
      const [[student]] = await db.query(
        `SELECT s.name, s.std, s.division
         FROM fitness_test_results ftr
         JOIN students s ON ftr.student_id = s.id
         WHERE ftr.id = ?`,
        [result_id],
      );
      if (student) {
        const safeName = String(student.name || "Student").trim().replace(/[/\\?%*:|"<>]/g, "_");
        let stdStr = String(student.std || "").trim();
        if (stdStr === "-3" || stdStr.toLowerCase() === "nursery") stdStr = "Nursery";
        else if (stdStr === "-2" || stdStr.toLowerCase().includes("jr")) stdStr = "Jr_KG";
        else if (stdStr === "-1" || stdStr.toLowerCase().includes("sr")) stdStr = "Sr_KG";
        else if (/^\d+$/.test(stdStr)) stdStr = `Grade_${stdStr}`;
        const divClean = String(student.division || "").trim().toUpperCase().replace(/^DIV(ISION)?\s*/i, "");
        const divStr = divClean ? `_Div_${divClean}` : "";
        filename = `${safeName}_${stdStr}${divStr}_DetailReport.pdf`;
      }
    } catch (dbErr) {
      console.warn("[DETAIL-PDF] Failed to build filename:", dbErr.message);
    }

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(Buffer.from(pdfBytes));
  } catch (err) {
    console.error("[DETAIL-PDF] Error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// 🎓 HELPERS for ID Generation
function incrementStringId(id) {
  if (!id) return "";
  const match = id.match(/^(.*?)(\d+)$/);
  if (!match) return id + "1";
  const prefix = match[1];
  const number = parseInt(match[2]);
  return prefix + (number + 1);
}

// 🎓 GET NEXT STUDENT IDs (FOR AUTO-FILL)

; // stripped /api/students/next-ids


// 🎓 BULK STUDENT UPLOAD (Auto-ID Enabled)

; // stripped /api/students/bulk


// ============================================================
// 📦 STOCK & EQUIPMENT ORDER APIS
// ============================================================

// 📦 GET EQUIPMENT ORDERS

; // stripped /api/equipment-orders


// 📦 CREATE EQUIPMENT ORDER (with optional image upload)

; // stripped /api/equipment-orders


// 📅 WEEKLY REPORT CARD REMINDER

; // stripped /api/admin/trigger-weekly-reminder


// 📦 UPDATE EQUIPMENT ORDER STATUS (Approve / Reject)

; // stripped /api/equipment-orders/:id/status



; // stripped /api/stock-reports


// 📄 ADD STOCK REPORT (with file upload)

; // stripped /api/stock-reports



; // stripped /api/curriculums


// 🎯 GET UNIQUE GRADES FOR A SPORT

; // stripped /api/curriculum/grades/:sport


// 🎯 GET LEVELS (grades from year_lp_master) FOR MULTIPLE SPORTS

; // stripped /api/curriculum/levels-by-sports


// 🏅 GET ALL DISTINCT SPORTS (for Curriculum Builder Generator sport selection)

; // stripped /api/curriculum/sports-by-grade


// 🎯 GET ALL LESSON PLANS for sport + grade from year_lp_master

; // stripped /api/curriculum/lesson-plans


// ⚡ GET LESSON PLANS BY SPECIFIC IDs (fast lookup for rotational templates)

; // stripped /api/curriculum/lesson-plans/by-ids


// ─── SDP CURRICULUM ENDPOINTS ────────────────────────────────────────────────

// 📋 LIST ALL SDP CURRICULUMS

; // stripped /api/curriculum/sdp/list


// 📋 LIST ALL MSFC CURRICULUMS

; // stripped /api/curriculum/msfc/list


// 🎯 UNIFIED CURRICULUM LIST (ISP + SDP, newest first)

; // stripped /api/curriculum/all


// 🎯 GET UNIQUE GRADES FOR AN SDP SPORT
app.get("/api/curriculum/sdp/grades/:sport", async (req, res) => {
  const { sport } = req.params;
  try {
    const [rows] = await db.query(
      "SELECT DISTINCT grade FROM sdp_lp_master WHERE sport = ? ORDER BY grade ASC",
      [sport],
    );
    res.json({ success: true, grades: rows.map((r) => r.grade) });
  } catch (err) {
    console.error("FETCH SDP GRADES ERROR:", err);
    res
      .status(500)
      .json({ success: false, message: "Error fetching SDP grades" });
  }
});

// 🎯 GET SDP LESSON PLANS for sport + grade

; // stripped /api/curriculum/sdp/lesson-plans


// 🏅 GET SDP SPORTS (distinct sports from SDP curriculum)
app.get("/api/curriculum/sdp/sports", async (req, res) => {
  try {
    const [rows] = await db.query(
      "SELECT DISTINCT sport FROM sdp_lp_master WHERE sport IS NOT NULL AND sport != '' ORDER BY sport ASC",
    );
    const sports = rows.map((r) => r.sport);
    res.json({ success: true, sports });
  } catch (err) {
    console.error("FETCH SDP SPORTS ERROR:", err);
    res
      .status(500)
      .json({ success: false, message: "Error fetching SDP sports" });
  }
});

// 🎯 GET SDP SPORT LESSON PLANS
app.get("/api/curriculum/sdp/sport-lesson-plans", async (req, res) => {
  const { sport, grade } = req.query;
  if (!sport) {
    return res
      .status(400)
      .json({ success: false, message: "sport is required" });
  }
  try {
    const selectFields = `id, lp_unique_id as unique_id, lp_no, sport, grade, skill, sub_skill, objective, warm_up, skill_implementation,
              teaching_aids, cool_down, summarization, life_skill, picture, created_at`;

    let query;
    let params;
    if (grade) {
      query = `SELECT ${selectFields}
       FROM sdp_lp_master
       WHERE sport = ? AND grade = ?
       ORDER BY
         CAST(lp_no AS UNSIGNED) ASC,
         id ASC`;
      params = [sport, grade];
    } else {
      query = `SELECT ${selectFields}
       FROM sdp_lp_master
       WHERE sport = ?
       ORDER BY
         CAST(lp_no AS UNSIGNED) ASC,
         id ASC`;
      params = [sport];
    }

    let [rows] = await db.query(query, params);

    res.json({
      success: true,
      lesson_plans: rows,
      source: "sdp_lp_master",
    });
  } catch (err) {
    console.error("FETCH SDP SPORT LESSON PLANS ERROR:", err);
    res
      .status(500)
      .json({ success: false, message: "Error fetching SDP lesson plans" });
  }
});

// 🎯 GET UNIQUE GRADES FOR AN MSFC SPORT
app.get("/api/curriculum/msfc/grades/:sport", async (req, res) => {
  const { sport } = req.params;
  try {
    const [rows] = await db.query(
      "SELECT DISTINCT grade FROM msfc_lp_master WHERE sport = ? ORDER BY grade ASC",
      [sport],
    );
    res.json({ success: true, grades: rows.map((r) => r.grade) });
  } catch (err) {
    console.error("FETCH MSFC GRADES ERROR:", err);
    res
      .status(500)
      .json({ success: false, message: "Error fetching MSFC grades" });
  }
});

// 🎯 GET MSFC SPORTS
app.get("/api/curriculum/msfc/sports", async (req, res) => {
  try {
    const [rows] = await db.query(
      "SELECT DISTINCT sport FROM msfc_lp_master WHERE sport IS NOT NULL AND sport != '' ORDER BY sport ASC",
    );
    const sports = rows.map((r) => r.sport);
    res.json({ success: true, sports });
  } catch (err) {
    console.error("FETCH MSFC SPORTS ERROR:", err);
    res
      .status(500)
      .json({ success: false, message: "Error fetching MSFC sports" });
  }
});

// 🎯 GET MSFC SPORT LESSON PLANS
app.get("/api/curriculum/msfc/sport-lesson-plans", async (req, res) => {
  const { sport, grade } = req.query;
  if (!sport) {
    return res
      .status(400)
      .json({ success: false, message: "sport is required" });
  }
  try {
    const selectFields = `id, lp_unique_id as unique_id, lp_no, sport, grade, skill, sub_skill, objective, warm_up, skill_implementation,
              teaching_aids, cool_down, summarization, life_skill, picture, created_at`;

    let query;
    let params;
    if (grade) {
      query = `SELECT ${selectFields}
       FROM msfc_lp_master
       WHERE sport = ? AND grade = ?
       ORDER BY
         CAST(lp_no AS UNSIGNED) ASC,
         id ASC`;
      params = [sport, grade];
    } else {
      query = `SELECT ${selectFields}
       FROM msfc_lp_master
       WHERE sport = ?
       ORDER BY
         CAST(lp_no AS UNSIGNED) ASC,
         id ASC`;
      params = [sport];
    }

    let [rows] = await db.query(query, params);

    res.json({
      success: true,
      lesson_plans: rows,
      source: "msfc_lp_master",
    });
  } catch (err) {
    console.error("FETCH MSFC SPORT LESSON PLANS ERROR:", err);
    res
      .status(500)
      .json({ success: false, message: "Error fetching MSFC lesson plans" });
  }
});

// 🗑️ DELETE SDP CURRICULUM MASTER

; // stripped /api/curriculum/sdp/delete/:id


// 🗑️ DELETE MSFC CURRICULUM MASTER

; // stripped /api/curriculum/msfc/delete/:id


// 🗑️ DELETE SINGLE SDP LESSON PLAN

; // stripped /api/curriculum/sdp/master/:id


// ─── CURRICULUM BUILDER TABLES ───────────────────────────────────────────────
(async () => {
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS curriculum_builder_plans (
        id INT AUTO_INCREMENT PRIMARY KEY,
        school_id INT NOT NULL,
        school_name VARCHAR(255) DEFAULT NULL,
        plan_type VARCHAR(20) NOT NULL,
        sports_json TEXT,
        user_id INT DEFAULT NULL,
        weeks_per_year INT DEFAULT 40,
        total_yearly_sport INT DEFAULT 0,
        total_yearly_pe INT DEFAULT 0,
        total_lp_count INT DEFAULT 0,
        rotational_start_level VARCHAR(60) NULL,
        rotational_end_level VARCHAR(60) NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_cbp_school (school_id),
        INDEX idx_cbp_user (user_id)
      )
    `);
    await db.query(`
      CREATE TABLE IF NOT EXISTS curriculum_builder_entries (
        id INT AUTO_INCREMENT PRIMARY KEY,
        plan_id INT NOT NULL,
        std_id INT DEFAULT NULL,
        grade_name VARCHAR(60) DEFAULT NULL,
        sport VARCHAR(100) NOT NULL,
        weekly_sport INT DEFAULT 0,
        weekly_pe INT DEFAULT 0,
        yearly_sport INT DEFAULT 0,
        yearly_pe INT DEFAULT 0,
        level_grade VARCHAR(60) DEFAULT NULL,
        level_label VARCHAR(60) DEFAULT NULL,
        lp_count INT DEFAULT 0,
        month INT DEFAULT NULL,
        month_anchor TIMESTAMP NULL DEFAULT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_cbe_plan (plan_id),
        INDEX idx_cbe_sport (sport)
      )
    `);
    try {
      await db.query(
        `ALTER TABLE curriculum_builder_entries ADD COLUMN month INT DEFAULT NULL`,
      );
    } catch (e) {
      // Column month already exists
    }

    try {
      await db.query(
        `ALTER TABLE curriculum_builder_entries ADD COLUMN month_anchor TIMESTAMP NULL DEFAULT NULL`,
      );
    } catch (e) {
      // Column month_anchor already exists
    }

    try {
      await db.query(
        `ALTER TABLE curriculum_builder_entries ADD COLUMN selected_lp_ids TEXT NULL DEFAULT NULL`,
      );
    } catch (e) {
      // Column selected_lp_ids already exists
    }

    try {
      await db.query(
        `ALTER TABLE curriculum_builder_plans ADD COLUMN rotational_start_level VARCHAR(60) NULL DEFAULT NULL`,
      );
    } catch (e) {
      // Column rotational_start_level already exists
    }

    try {
      await db.query(
        `ALTER TABLE curriculum_builder_plans ADD COLUMN rotational_end_level VARCHAR(60) NULL DEFAULT NULL`,
      );
    } catch (e) {
      // Column rotational_end_level already exists
    }

    // Canonical runtime cursor: which Sports Level (master grade) a school is
    // CURRENTLY on for a given school grade + sport. The Builder's level_grade
    // is only the initial configuration; the weekly seeder advances this when a
    // level's LP pool is exhausted. Key = school_id + normalized school_grade + sport.
    await db.query(`
      CREATE TABLE IF NOT EXISTS curriculum_level_progress (
        id INT AUTO_INCREMENT PRIMARY KEY,
        school_id INT NOT NULL,
        school_grade VARCHAR(60) NOT NULL,
        sport VARCHAR(100) NOT NULL,
        current_level_grade VARCHAR(60) NOT NULL,
        current_level_started_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uq_curriculum_level_progress (school_id, school_grade, sport),
        INDEX idx_clp_school_sport (school_id, sport)
      )
    `);

    // Rotational Sport Templates & Level Mappings
    await db.query(`
      CREATE TABLE IF NOT EXISTS rotational_sport_templates (
        id INT AUTO_INCREMENT PRIMARY KEY,
        sport VARCHAR(100) NOT NULL,
        name VARCHAR(255) DEFAULT NULL,
        status VARCHAR(20) DEFAULT 'active',
        created_by INT DEFAULT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uq_rotational_sport (sport),
        INDEX idx_rst_sport (sport)
      )
    `);

    await db.query(`
      CREATE TABLE IF NOT EXISTS rotational_sport_template_levels (
        id INT AUTO_INCREMENT PRIMARY KEY,
        template_id INT NOT NULL,
        sport VARCHAR(100) NOT NULL,
        level_grade VARCHAR(60) NOT NULL,
        level_label VARCHAR(60) DEFAULT NULL,
        selected_lp_ids TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uq_template_level (template_id, level_grade),
        INDEX idx_rstl_sport_level (sport, level_grade),
        INDEX idx_rstl_template (template_id)
      )
    `);

    console.log("✅ Curriculum Builder tables initialized");
  } catch (e) {
    console.error("Curriculum Builder table init error:", e.message);
  }
})();

// POST save or update curriculum builder plan + entries

; // stripped /api/curriculum/builder/save


// GET curriculum builder plans for a school

; // stripped /api/curriculum/builder/plans


// GET single plan with entries

; // stripped /api/curriculum/builder/plans/:id


// ═════════════════════════════════════════════════════════════════════════════
// 🔄 ROTATIONAL SPORT TEMPLATE APIS (Rotational Plan ONLY — Year Plan untouched)
// ═════════════════════════════════════════════════════════════════════════════

// 📋 GET all rotational templates with their level configurations

; // stripped /api/curriculum/rotational-templates


// 🗺️ GET all active rotational templates mapped by "sport|level_grade" for ultra-fast lookup
// LP skill/sub_skill data is embedded directly — no second fetch needed on the frontend

; // stripped /api/curriculum/rotational-templates/map



// 🔍 GET template and levels for a specific sport

; // stripped /api/curriculum/rotational-templates/sport/:sport


// 🎯 RESOLVE: Get configured LP IDs for a sport + level

; // stripped /api/curriculum/rotational-templates/resolve


// 💾 POST save/update a rotational template with all its levels

; // stripped /api/curriculum/rotational-templates/save


// 🗑️ DELETE a rotational template and its levels

; // stripped /api/curriculum/rotational-templates/:id



// 🧼 GRADE NORMALIZATION HELPER
function normalizeGrade(grade) {
  if (!grade) return grade;
  let g = String(grade).toLowerCase().trim();

  if (g === "na" || g === "n/a") return "NA";

  // Remove suffixes like 1st, 2nd, 3rd, 4th...
  g = g.replace(/(\d+)(st|nd|rd|th)/, "$1");

  // Remove "grade " or "std " prefix
  g = g.replace(/^(grade|std|standard)\s+/, "");

  // Map common foundation variations
  if (
    g.includes("nursery") ||
    g.includes("playgroup") ||
    g.includes("playschool")
  )
    return "Nursery";
  if (
    g.includes("jr") ||
    g.includes("junior") ||
    g.includes("lkg") ||
    g.includes("k1")
  )
    return "Jr. Kg";
  if (
    g.includes("sr") ||
    g.includes("senior") ||
    g.includes("ukg") ||
    g.includes("hkg") ||
    g.includes("k2")
  )
    return "Sr. Kg";

  // Handle Roman Numerals
  const romanMap = {
    i: "1",
    ii: "2",
    iii: "3",
    iv: "4",
    v: "5",
    vi: "6",
    vii: "7",
    viii: "8",
    ix: "9",
    x: "10",
  };
  if (romanMap[g]) return romanMap[g];

  // If it's a number after cleanup
  const numMatch = g.match(/\d+/);
  if (numMatch) return `Grade ${numMatch[0]}`;

  return grade; // Fallback to original if no rule matches
}

// 🎯 GET SPORTS ASSIGNED TO A SCHOOL (from curriculum builder plan, then fallbacks)
app.get("/api/curriculum/school-sports", async (req, res) => {
  const { school_id } = req.query;
  if (!school_id) {
    return res
      .status(400)
      .json({ success: false, message: "school_id is required" });
  }
  try {
    let sports = [];

    const [plans] = await db.query(
      "SELECT sports_json FROM curriculum_builder_plans WHERE school_id = ? ORDER BY created_at DESC LIMIT 1",
      [school_id],
    );
    if (plans.length && plans[0].sports_json) {
      try {
        const parsed = JSON.parse(plans[0].sports_json);
        if (Array.isArray(parsed)) sports = parsed.filter(Boolean);
      } catch (_) {
        /* ignore bad json */
      }
    }

    if (sports.length === 0) {
      const [rows] = await db.query(
        "SELECT DISTINCT sport FROM year_lp_master_new WHERE school_id = ? AND sport IS NOT NULL ORDER BY sport ASC",
        [school_id],
      );
      sports = rows.map((r) => r.sport);
    }

    if (sports.length === 0) {
      const [rows] = await db.query(
        "SELECT DISTINCT sport FROM year_lp_master WHERE sport IS NOT NULL ORDER BY sport ASC",
      );
      sports = rows.map((r) => r.sport);
    }

    res.json({ success: true, sports });
  } catch (err) {
    console.error("FETCH SCHOOL SPORTS ERROR:", err);
    res
      .status(500)
      .json({ success: false, message: "Error fetching school sports" });
  }
});

// 🎯 GET ALL LESSON PLANS for school + sport (all levels, no grade filter)
app.get("/api/curriculum/sport-lesson-plans", async (req, res) => {
  const { sport, school_id, grade } = req.query;
  if (!sport) {
    return res
      .status(400)
      .json({ success: false, message: "sport is required" });
  }
  if (!school_id) {
    return res
      .status(400)
      .json({ success: false, message: "school_id is required" });
  }
  try {
    const selectFields = `id, unique_id, lp_no, sport, grade, skill, sub_skill, objective, warm_up, skill_implementation,
              teaching_aids, cool_down, summarization, life_skill, picture, month_year, week, created_at`;

    // year_lp_master has no month_year/week columns (those live on year_lp_master_new)
    const masterSelectFields = `id, lp_unique_id, lp_no, sport, grade, skill, sub_skill, objective, warm_up, skill_implementation,
              teaching_aids, cool_down, summarization, life_skill, picture, NULL as month_year, NULL as week, created_at`;

    const gradeFilter = (() => {
      const g = grade ? String(grade).trim() : "";
      const sg = req.query.school_grade ? String(req.query.school_grade).trim() : "";
      if (!g || g.toLowerCase() === "all") {
        return { sql: "", params: [] };
      }
      const possibleGrades = new Set();
      const addGradeVariants = (val) => {
        if (!val) return;
        possibleGrades.add(val);
        const norm = normalizeGrade(val);
        if (norm) possibleGrades.add(norm);
        const m = String(val).match(/\d+/);
        if (m) {
          possibleGrades.add(`Grade ${m[0]}`);
          possibleGrades.add(m[0]);
        }
      };
      addGradeVariants(g);
      if (sg) addGradeVariants(sg);

      const gradeList = Array.from(possibleGrades).filter(Boolean);
      return {
        sql: ` AND (grade IN (${gradeList.map(() => "?").join(",")}))`,
        params: gradeList,
      };
    })();

    // 0. Check Rotational Plan: If this school has a rotational curriculum plan covering this sport,
    // or if an active rotational sport template exists, use the configured selected_lp_ids.
    const parseSelectedLpIds = (value) => {
      if (Array.isArray(value)) {
        return value.map((v) => String(v ?? "").trim()).filter(Boolean);
      }
      if (value === null || value === undefined) return [];
      const raw = String(value).trim();
      if (!raw) return [];
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          return parsed.map((v) => String(v ?? "").trim()).filter(Boolean);
        }
      } catch (_) { }
      if (raw.includes(",")) {
        return raw.split(",").map((v) => String(v ?? "").trim()).filter(Boolean);
      }
      return raw.split(/\r?\n/).map((v) => String(v ?? "").trim()).filter(Boolean);
    };

    const [builderPlans] = await db.query(
      `SELECT id, plan_type, sports_json, rotational_start_level, rotational_end_level
       FROM curriculum_builder_plans 
       WHERE school_id = ? ORDER BY created_at DESC`,
      [school_id],
    );
    const rotPlan = builderPlans.find((p) => {
      if (p.plan_type !== "rotational") return false;
      try {
        const s = JSON.parse(p.sports_json || "[]");
        return s.map((x) => String(x).trim().toLowerCase()).includes(String(sport).trim().toLowerCase());
      } catch {
        return false;
      }
    }) || builderPlans.find((p) => p.plan_type === "rotational");

    let rotStartLevel = rotPlan?.rotational_start_level || null;
    let rotEndLevel = rotPlan?.rotational_end_level || null;

    const levelRank = (grade) => {
      if (!grade) return 9999;
      const g = String(grade).trim().toLowerCase();
      if (g.includes("nursery")) return 1;
      if (g.includes("jr") && g.includes("kg")) return 2;
      if (g.includes("sr") && g.includes("kg")) return 3;
      const m = grade.match(/grade\s*(\d+)/i) || String(grade).match(/^(\d+)$/);
      if (m) return 4 + parseInt(m[1] || m[0]);
      const num = parseInt(String(grade).replace(/\D/g, ""), 10);
      if (!isNaN(num)) return 4 + num;
      return 9999;
    };
    const inRotRange = (lvl) => {
      if (!rotStartLevel || !rotEndLevel) return true;
      const rs = levelRank(rotStartLevel);
      const re = levelRank(rotEndLevel);
      const r = levelRank(lvl);
      if (rs > re) return true;
      return r >= rs && r <= re;
    };

    // Rotational builder entries for this school + sport (plan_type = rotational)
    const [rotEntries] = await db.query(
      `SELECT e.grade_name, e.level_grade, e.level_label, e.selected_lp_ids
         FROM curriculum_builder_entries e
         INNER JOIN curriculum_builder_plans p ON p.id = e.plan_id
        WHERE p.school_id = ?
          AND p.plan_type = 'rotational'
          AND TRIM(LOWER(e.sport)) = TRIM(LOWER(?))
        ORDER BY p.created_at DESC, e.id ASC`,
      [school_id, sport],
    );

    // Active rotational sport-template rows (configured on the Rotational Templates page)
    const [tmplRows] = await db.query(
      `SELECT rstl.level_grade, rstl.level_label, rstl.selected_lp_ids
         FROM rotational_sport_template_levels rstl
         INNER JOIN rotational_sport_templates rst ON rst.id = rstl.template_id
        WHERE TRIM(LOWER(rstl.sport)) = TRIM(LOWER(?))
          AND rst.status = 'active'
        ORDER BY rstl.id ASC`,
      [sport],
    );

    const [builderEntries] = await db.query(
      `SELECT e.id, e.grade_name, e.level_grade, e.level_label, e.selected_lp_ids, p.plan_type
         FROM curriculum_builder_entries e
         INNER JOIN curriculum_builder_plans p ON p.id = e.plan_id
        WHERE p.school_id = ?
          AND TRIM(LOWER(e.sport)) = TRIM(LOWER(?))
        ORDER BY p.created_at DESC, e.id ASC`,
      [school_id, sport],
    );

    const sportPlan = builderPlans.find((p) => {
      try {
        const s = JSON.parse(p.sports_json || "[]");
        return s.map((x) => String(x).trim().toLowerCase()).includes(String(sport).trim().toLowerCase());
      } catch {
        return false;
      }
    }) || builderPlans[0];

    const hasYearEntry = builderEntries.some((e) => e.plan_type === "year");
    const hasRotEntry = builderEntries.some((e) => e.plan_type === "rotational");
    const isYearPlan =
      sportPlan?.plan_type === "year" ||
      (!sportPlan && builderPlans[0]?.plan_type === "year") ||
      hasYearEntry;

    const hasBuilderRotational = !isYearPlan && rotEntries.some(
      (e) => parseSelectedLpIds(e.selected_lp_ids).length > 0,
    );
    const hasTmplRotational = !isYearPlan && (hasRotEntry || sportPlan?.plan_type === "rotational") && tmplRows.some(
      (t) => parseSelectedLpIds(t.selected_lp_ids).length > 0,
    );

    if (hasBuilderRotational || hasTmplRotational) {
      // ─────────────────────────────────────────────────────────────────
      // PUBLISHED WINDOW (Year-Plan-like behavior)
      // ─────────────────────────────────────────────────────────────────
      // Rotational plans must NOT auto-advance when a lesson is marked
      // complete. Like the Year Plan, the visible lessons are the
      // "published window" in year_lp_master_new (current_show_status = 0).
      // update_lp_status.cjs is the ONLY thing that advances the window.
      //
      // Only when NOTHING has been published yet (before the first script
      // run) do we fall back to the live sequence computation below.
      const [publishedRows] = await db.query(
        `SELECT ${selectFields}
         FROM year_lp_master_new
         WHERE school_id = ? AND TRIM(LOWER(sport)) = TRIM(LOWER(?))
           AND (current_show_status = 0 OR current_show_status IS NULL)
         ORDER BY
           CASE
             WHEN grade = 'Nursery' THEN 1
             WHEN grade = 'Jr. Kg' THEN 2
             WHEN grade = 'Sr. Kg' THEN 3
             WHEN grade LIKE 'Grade %' THEN 4 + CAST(SUBSTRING(grade, 7) AS UNSIGNED)
             ELSE 999
           END ASC,
           CAST(lp_no AS UNSIGNED) ASC,
           id ASC`,
        [school_id, sport],
      );

      const reqGrade = grade ? String(grade).trim() : "";
      const isAllGrades = !reqGrade || reqGrade.toLowerCase() === "all";

      let publishedToReturn = publishedRows;
      if (!isAllGrades) {
        const normReq = normGradeName(reqGrade);
        const gradeFiltered = publishedRows.filter((r) => {
          const g = String(r.grade || "").trim();
          return (
            g === reqGrade ||
            normGradeName(g) === normReq ||
            (r.school_grade &&
              (r.school_grade === reqGrade ||
                normGradeName(r.school_grade) === normReq))
          );
        });
        publishedToReturn = gradeFiltered;
      } else {
        if (
          rotPlan &&
          (rotPlan.rotational_start_level || rotPlan.rotational_end_level)
        ) {
          const rs = levelRank(rotPlan.rotational_start_level);
          const re = levelRank(rotPlan.rotational_end_level);
          if (
            rotPlan.rotational_start_level &&
            rotPlan.rotational_end_level &&
            rs <= re
          ) {
            publishedToReturn = publishedRows.filter((r) => {
              const rr = levelRank(r.grade);
              return rr >= rs && rr <= re;
            });
          }
        }
      }

      // Only use the published window when something is actually published for this scope.
      // Otherwise fall through to the live selected_lp_ids sequence below.
      if (publishedToReturn.length > 0) {
        // Mark completion from coach_lesson_tracking (display only —
        // does NOT change which LPs are visible).
        const pubUids = publishedToReturn
          .map((r) => r.unique_id)
          .filter(Boolean);
        if (pubUids.length > 0) {
          const [pubCompletions] = await db.query(
            `SELECT DISTINCT unique_id FROM coach_lesson_tracking
               WHERE school_id = ? AND unique_id IN (?)
                 AND LOWER(status) IN ('complete', 'done', 'completed')`,
            [school_id, pubUids],
          );
          const pubCompletedSet = new Set(
            pubCompletions.map((c) =>
              String(c.unique_id || "").trim().toLowerCase()
            )
          );
          publishedToReturn.forEach((r) => {
            r.is_done = pubCompletedSet.has(
              String(r.unique_id || "").trim().toLowerCase()
            );
          });
        }

        console.log(
          `School ${school_id} • ${sport} • ${reqGrade || "all"} → rotational PUBLISHED window (${publishedToReturn.length} LPs) from year_lp_master_new`
        );

        return res.json({
          success: true,
          lesson_plans: publishedToReturn,
          count: publishedToReturn.length,
          total: publishedToReturn.length,
          sequence_total: publishedToReturn.length,
          source: "rotational_published_window",
        });
      }
    }

    console.log(
      `School ${school_id} • ${sport} → no published rotational window yet, using live sequence`
    );

    const [masterRows] = await db.query(
      `SELECT ${masterSelectFields}
         FROM year_lp_master
         WHERE TRIM(LOWER(sport)) = TRIM(LOWER(?))`,
      [sport],
    );

    const byUid = new Map(
      masterRows.map((row) => [
        String(row.lp_unique_id || "").trim().toLowerCase(),
        row,
      ])
    );
    const byMasterId = new Map(
      masterRows.map((row) => [String(row.id).trim(), row])
    );

    function resolveSelectedLP(value) {
      if (value === null || value === undefined) return null;
      const key = String(value).trim();
      return byUid.get(key.toLowerCase()) || byMasterId.get(key) || null;
    }

    const [completions] = await db.query(
      `SELECT DISTINCT unique_id FROM coach_lesson_tracking 
         WHERE school_id = ? AND TRIM(LOWER(sport)) = TRIM(LOWER(?))
           AND LOWER(status) IN ('complete', 'done', 'completed')`,
      [school_id, sport],
    );
    const completedUidSet = new Set(
      completions
        .map((c) => String(c.unique_id || "").trim().toLowerCase())
        .filter(Boolean)
    );

    const reqGrade = grade ? String(grade).trim() : "";
    const isAllGrades = !reqGrade || reqGrade.toLowerCase() === "all";


    // ─────────────────────────────────────────────────────────────────
    // LIVE FALLBACK: no published window yet in year_lp_master_new.
    // IMPORTANT: This fallback must NOT auto-advance based on completion.
    // Always show the first 2 LPs from the rotational sequence, and only
    // mark is_done from coach_lesson_tracking (display only).
    // The window only advances when update_lp_status.cjs is run.
    // ─────────────────────────────────────────────────────────────────
    const processRotationalSequence = (rotationalSequence, gradeLabelForLog) => {
      // FIX: resolve all IDs upfront then sort by numeric lp_no so the
      // sequence is always 1, 3, 5, 9 regardless of click/storage order.
      // Always start from index 0 — never shift based on what's been completed.
      // is_done is set for display purposes only; it does NOT move the window.
      // The window only advances when update_lp_status.cjs is run.

      // Step 1: resolve all IDs
      const resolvedAll = rotationalSequence
        .map((id) => resolveSelectedLP(id))
        .filter(Boolean);

      // Step 2: sort by numeric lp_no (1, 3, 5, 9 …)
      resolvedAll.sort((a, b) => {
        const numA = parseInt(String(a.lp_no || "0").match(/\d+/)?.[0] || "0", 10);
        const numB = parseInt(String(b.lp_no || "0").match(/\d+/)?.[0] || "0", 10);
        return numA - numB || Number(a.id || 0) - Number(b.id || 0);
      });

      // Step 3: take first 2 in sorted order
      const nextLps = resolvedAll.slice(0, 2).map((lp) => ({
        ...lp,
        unique_id: lp.lp_unique_id,
        is_done: completedUidSet.has(
          String(lp.lp_unique_id || "").trim().toLowerCase()
        ),
      }));

      console.log(
        `School ${school_id} • ${sport} • ${gradeLabelForLog || "All"} → rotational FALLBACK — sorted sequence: ${resolvedAll.map((l) => l.lp_no).join(" → ")} — showing first 2, is_done from tracking`
      );
      if (nextLps.length > 0) {
        nextLps.forEach((lp) =>
          console.log(`  LP${lp.lp_no} is_done=${lp.is_done}`)
        );
      } else {
        console.log("  NONE");
      }

      return {
        nextLps,
        totalSequenceLength: rotationalSequence.length,
      };
    };

    if (!isAllGrades) {
      const normReq = normGradeName(reqGrade);
      let matchedEntry = rotEntries.find((e) => {
        return (
          String(e.grade_name || "").trim() === reqGrade ||
          String(e.level_grade || "").trim() === reqGrade ||
          String(e.level_label || "").trim() === reqGrade ||
          normGradeName(e.grade_name || "") === normReq ||
          normGradeName(e.level_grade || "") === normReq ||
          (e.level_label && levelLabel(normReq) === e.level_label)
        );
      });

      let rotationalSequence = matchedEntry
        ? parseSelectedLpIds(matchedEntry.selected_lp_ids)
        : [];
      let source = "rotational_builder_plan";

      if (rotationalSequence.length === 0) {
        const matchedTmpl = tmplRows.find((row) => {
          return (
            String(row.level_grade || "").trim() === reqGrade ||
            String(row.level_label || "").trim() === reqGrade ||
            normGradeName(row.level_grade || "") === normReq ||
            (row.level_label && levelLabel(normReq) === row.level_label)
          );
        });
        if (matchedTmpl) {
          rotationalSequence = parseSelectedLpIds(matchedTmpl.selected_lp_ids);
          source = "rotational_sport_template";
        }
      }

      if (rotationalSequence.length > 0) {
        const displayGrade =
          matchedEntry?.grade_name ||
          matchedEntry?.level_grade ||
          reqGrade;
        const { nextLps, totalSequenceLength } =
          processRotationalSequence(rotationalSequence, displayGrade);

        return res.json({
          success: true,
          lesson_plans: nextLps,
          count: nextLps.length,
          total: totalSequenceLength,
          sequence_total: totalSequenceLength,
          source,
        });
      }
    } else {
      let allNextLps = [];
      let totalCount = 0;
      let source = "rotational_builder_plan";

      const entriesToProcess = [];
      const seenGrades = new Set();

      for (const e of rotEntries) {
        const seq = parseSelectedLpIds(e.selected_lp_ids);
        const gKey = normGradeName(e.grade_name || e.level_grade || "");
        if (seq.length > 0 && !seenGrades.has(gKey)) {
          seenGrades.add(gKey);
          entriesToProcess.push({
            sequence: seq,
            grade: e.grade_name || e.level_grade,
            source: "rotational_builder_plan",
          });
        }
      }

      for (const t of tmplRows) {
        const seq = parseSelectedLpIds(t.selected_lp_ids);
        const gKey = normGradeName(t.level_grade || "");
        if (seq.length > 0 && !seenGrades.has(gKey)) {
          seenGrades.add(gKey);
          entriesToProcess.push({
            sequence: seq,
            grade: t.level_grade,
            source: "rotational_sport_template",
          });
        }
      }

      if (entriesToProcess.length > 0) {
        for (const item of entriesToProcess) {
          const { nextLps, totalSequenceLength } =
            processRotationalSequence(item.sequence, item.grade);
          const tagged = nextLps.map((lp) => ({
            ...lp,
            school_grade: item.grade,
          }));
          allNextLps.push(...tagged);
          totalCount += totalSequenceLength;
          source = item.source;
        }

        return res.json({
          success: true,
          lesson_plans: allNextLps,
          count: allNextLps.length,
          total: totalCount,
          sequence_total: totalCount,
          source,
        });
      }
    }


    // 1. Published lessons assigned to this school + sport (Year Plan)
    let [rows] = await db.query(
      `SELECT ${selectFields}
       FROM year_lp_master_new
       WHERE school_id = ? AND sport = ?
         AND (current_show_status = 0 OR current_show_status IS NULL)${gradeFilter.sql}
       ORDER BY 
         CASE 
           WHEN grade = 'Nursery' THEN 1
           WHEN grade = 'Jr. Kg' THEN 2
           WHEN grade = 'Sr. Kg' THEN 3
           WHEN grade LIKE 'Grade %' THEN 4 + CAST(SUBSTRING(grade, 7) AS UNSIGNED)
           ELSE 999
         END ASC,
         CAST(lp_no AS UNSIGNED) ASC, 
         id ASC`,
      [school_id, sport, ...gradeFilter.params],
    );

    let source = "year_lp_master_new";

    // 2. Fallback: all master LPs for this sport (no grade/level constraint)
    if (rows.length === 0) {
      [rows] = await db.query(
        `SELECT id, lp_unique_id as unique_id, lp_no, sport, grade, skill, sub_skill, objective, warm_up, skill_implementation,
                teaching_aids, cool_down, summarization, life_skill, picture, NULL as month_year, NULL as week, created_at
         FROM year_lp_master
         WHERE sport = ?${gradeFilter.sql}
         ORDER BY 
           CASE 
             WHEN grade = 'Nursery' THEN 1
             WHEN grade = 'Jr. Kg' THEN 2
             WHEN grade = 'Sr. Kg' THEN 3
             WHEN grade LIKE 'Grade %' THEN 4 + CAST(SUBSTRING(grade, 7) AS UNSIGNED)
             ELSE 999
           END ASC,
           CAST(lp_no AS UNSIGNED) ASC, 
           id ASC`,
        [sport, ...gradeFilter.params],
      );
      source = "year_lp_master_sport_all";
    }

    // 3. Fallback: any published for school+sport without status filter
    if (rows.length === 0) {
      [rows] = await db.query(
        `SELECT ${selectFields}
         FROM year_lp_master_new
         WHERE school_id = ? AND sport = ?${gradeFilter.sql}
         ORDER BY 
           CASE 
             WHEN grade = 'Nursery' THEN 1
             WHEN grade = 'Jr. Kg' THEN 2
             WHEN grade = 'Sr. Kg' THEN 3
             WHEN grade LIKE 'Grade %' THEN 4 + CAST(SUBSTRING(grade, 7) AS UNSIGNED)
             ELSE 999
           END ASC,
           CAST(lp_no AS UNSIGNED) ASC, 
           id ASC`,
        [school_id, sport, ...gradeFilter.params],
      );
      source = "year_lp_master_new_all";
    }

    if (rows.length > 0 && school_id) {
      const uids = rows.map((r) => r.unique_id).filter(Boolean);
      if (uids.length > 0) {
        const [completions] = await db.query(
          `SELECT DISTINCT unique_id FROM coach_lesson_tracking 
           WHERE school_id = ? AND unique_id IN (?) AND LOWER(status) IN ('complete', 'done')`,
          [school_id, uids],
        );
        const completedUids = new Set(completions.map((c) => c.unique_id));
        rows.forEach((r) => {
          r.is_done = completedUids.has(r.unique_id);
        });
      }
    }

    res.json({ success: true, lesson_plans: rows, count: rows.length, source });
  } catch (err) {
    console.error("FETCH SPORT LESSON PLANS ERROR:", err);
    res
      .status(500)
      .json({ success: false, message: "Error fetching lesson plans" });
  }
});

// 🎯 GET ALL LESSON PLANS for school + sport + grade (resolves LP level from curriculum builder)

; // stripped /api/curriculum/school-lesson-plans


// 🎯 GET GRADE → LEVEL_GRADE MAP for a school + sport (from curriculum builder entries)
// Returns: { "Grade 1": "Grade 8", "Grade 2": "Grade 3", ... }
app.get("/api/curriculum/grade-level-map", async (req, res) => {
  const { school_id, sport } = req.query;

  if (!school_id || !sport) {
    return res.status(400).json({
      success: false,
      message: "school_id and sport are required",
    });
  }

  try {
    /*
     * ============================================================
     * 1. GET CURRICULUM BUILDER ENTRIES
     * ============================================================
     */
    const [entries] = await db.query(
      `SELECT
          e.grade_name,
          e.level_grade,
          e.level_label,
          p.plan_type,
          p.created_at
       FROM curriculum_builder_entries e
       INNER JOIN curriculum_builder_plans p
         ON p.id = e.plan_id
       WHERE p.school_id = ?
         AND TRIM(LOWER(e.sport)) = TRIM(LOWER(?))
       ORDER BY p.created_at DESC`,
      [school_id, sport]
    );

    const [planRows] = await db.query(
      `SELECT id, plan_type, sports_json,
              rotational_start_level, rotational_end_level
       FROM curriculum_builder_plans
       WHERE school_id = ?
       ORDER BY created_at DESC`,
      [school_id]
    );

    const sportPlan = planRows.find((p) => {
      try {
        const s = JSON.parse(p.sports_json || "[]");
        return s.map((x) => String(x).trim().toLowerCase()).includes(String(sport).trim().toLowerCase());
      } catch {
        return false;
      }
    }) || planRows[0];

    const hasYearEntry = entries.some((e) => e.plan_type === "year");
    const hasRotEntry = entries.some((e) => e.plan_type === "rotational");
    const isYearPlan =
      sportPlan?.plan_type === "year" ||
      (!sportPlan && planRows[0]?.plan_type === "year") ||
      hasYearEntry;

    const getGradeKey = (gradeName) => {
      const value = String(gradeName || "").trim();
      if (!value) return null;
      const match = value.match(/\d+/);
      if (match) return match[0];
      return value.toLowerCase();
    };

    /*
     * If this school is on a YEAR PLAN:
     * Show ALL school grades (1 to 10), and for every grade show the configured level's data.
     * Rotational templates DO NOT apply to Year Plan schools!
     */
    if (isYearPlan) {
      const [schoolStds] = await db.query(
        `SELECT DISTINCT sm.name, sm.std_code
         FROM school_stds ss
         JOIN stds_master sm ON sm.id = ss.std_id
         WHERE ss.school_id = ?
         ORDER BY sm.std_code ASC`,
        [school_id],
      );
      const schoolStdNames = schoolStds.map((s) => String(s.name).trim()).filter(Boolean);
      const fromEntries = entries.map((e) => String(e.grade_name || "").trim()).filter(Boolean);

      // Combine grades configured in the Curriculum Builder entries with school standards
      let combined = Array.from(new Set([...fromEntries, ...schoolStdNames]));

      let stdNames = combined;
      console.log(`[grade-level-map] school=${school_id} sport=${sport} | fromEntries=${JSON.stringify(fromEntries)} | schoolStdNames=${JSON.stringify(schoolStdNames)} | combined=${JSON.stringify(combined)} | isYearPlan=${isYearPlan}`);
      if (stdNames.length <= 1) {
        // Fallback: If 0 or 1 grade found (e.g. school_stds only had 1 grade in Live DB),
        // load full standard list from stds_master so all school grades 1 to 10 appear in Year Plan
        const [allMasterStds] = await db.query(
          "SELECT name, std_code FROM stds_master WHERE is_active = 1 ORDER BY std_code ASC",
        );
        const masterNames = allMasterStds.map((s) => String(s.name).trim()).filter(Boolean);
        stdNames = masterNames.length > 0
          ? masterNames
          : ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"];
        console.log(`[grade-level-map] FALLBACK to stds_master: stdNames=${JSON.stringify(stdNames)}`);
      }

      // Selected level configured for this sport (e.g. Level 2)
      const validEntry = entries.find((e) => isUsableLevel(e.level_grade)) || entries[0];
      const defaultLevel = validEntry && isUsableLevel(validEntry.level_grade)
        ? String(validEntry.level_grade).trim()
        : "Grade 1";
      const defaultLabel = validEntry?.level_label || levelLabel(defaultLevel);

      const map = {};
      const schoolGradeMap = {};

      for (const stdName of stdNames) {
        const gradeKey = getGradeKey(stdName);
        if (!gradeKey) continue;

        const specificEntry = entries.find(
          (e) => getGradeKey(e.grade_name) === gradeKey && isUsableLevel(e.level_grade)
        );
        const level = specificEntry ? String(specificEntry.level_grade).trim() : defaultLevel;
        const label = specificEntry?.level_label || (level === defaultLevel ? defaultLabel : levelLabel(level));

        map[gradeKey] = {
          grade_name: stdName,
          level_grade: level,
          level_label: label,
        };
        schoolGradeMap[gradeKey] = {
          grade_name: stdName,
          level_grade: level,
          level_label: label,
        };
      }

      return res.json({
        success: true,
        map,
        school_grade_map: schoolGradeMap,
        plan_type: "year",
      });
    }

    /*
     * ============================================================
     * 2. GET ACTIVE ROTATIONAL TEMPLATE LEVELS
     *
     * IMPORTANT:
     * A rotational grade is considered configured ONLY when
     * selected_lp_ids contains at least one lesson plan.
     * ============================================================
     */
    const [tmplLevelRows] = await db.query(
      `SELECT
          rstl.id,
          rstl.level_grade,
          rstl.level_label,
          rstl.selected_lp_ids
       FROM rotational_sport_template_levels rstl
       INNER JOIN rotational_sport_templates rst
         ON rst.id = rstl.template_id
       WHERE TRIM(LOWER(rst.sport)) = TRIM(LOWER(?))
         AND rst.status = 'active'
       ORDER BY rstl.id ASC`,
      [sport]
    );

    /*
     * Set containing ONLY rotational levels that actually
     * have lesson plans assigned.
     *
     * Example:
     * Grade 1 -> selected_lp_ids = [1,2,3]
     * Grade 2 -> selected_lp_ids = [4,5]
     * Grade 3 -> selected_lp_ids = []
     *
     * configuredLevels will contain:
     * Grade 1
     * Grade 2
     */
    const configuredLevels = new Set();

    /*
     * Keep complete configured template rows as well.
     * This helps us build the fallback map.
     */
    const configuredTemplateRows = [];

    for (const row of tmplLevelRows) {
      let selectedLpIds = [];

      try {
        selectedLpIds = JSON.parse(row.selected_lp_ids || "[]");
      } catch (error) {
        selectedLpIds = [];
      }

      /*
       * Ignore levels that have no lesson plans assigned.
       */
      if (
        !Array.isArray(selectedLpIds) ||
        selectedLpIds.length === 0
      ) {
        continue;
      }

      const levelGrade = String(row.level_grade || "").trim();

      if (!levelGrade) {
        continue;
      }

      configuredLevels.add(levelGrade);

      configuredTemplateRows.push({
        level_grade: levelGrade,
        level_label:
          row.level_label || levelLabel(levelGrade),
      });
    }

    const templateControlsVisibility =
      configuredLevels.size > 0;

    /*
     * ============================================================
     * 3. BUILD FINAL MAP
     * ============================================================
     */
    const map = {};


    /*
     * ============================================================
     * 4. PROCESS BUILDER ENTRIES
     *
     * The grades shown on the In-School Program (ISP) Select
     * Grade step are the LEVELS that were selected for this
     * sport in the Curriculum Builder. Each builder entry
     * carries the level it was assigned (level_grade), so the
     * distinct set of entry levels IS the list of selected
     * levels for this school + sport.
     * ============================================================
     */
    for (const row of entries) {
      const level = String(
        row.level_grade || ""
      ).trim();

      if (!isUsableLevel(level)) {
        continue;
      }

      const gradeKey = getGradeKey(level);

      if (!gradeKey) {
        continue;
      }

      /*
       * Most recent plan wins because entries are already
       * ordered by created_at DESC.
       */
      if (!map[gradeKey]) {
        map[gradeKey] = {
          grade_name: level,
          level_grade: level,
          level_label: levelLabel(level),
        };
      }
    }

    /*
     * ============================================================
     * 5. ROTATIONAL PLAN LEVEL RANGE
     *
     * The Builder's rotational range is the source of truth for
     * the levels shown. Those columns only ever hold the FIRST
     * sport's range (sports_json[0]) — see onSportRangeChange in
     * CurriculumBuilderGeneratorPage. So:
     *
     *   • First sport  → the saved range fully defines the level
     *     list. Replace whatever the Builder entries produced,
     *     because an auto-generated "one row per master grade"
     *     fallback otherwise leaks Nursery … Grade 10 into the
     *     Select Grade list.
     *   • Other sports → keep their Builder entries; only fall
     *     back to the saved range when there are no entries.
     * ============================================================
     */
    {
      const [planRows] = await db.query(
        `SELECT id, plan_type, sports_json,
                rotational_start_level, rotational_end_level
         FROM curriculum_builder_plans
         WHERE school_id = ?
         ORDER BY created_at DESC`,
        [school_id]
      );

      const rotPlan =
        planRows.find((p) => {
          if (p.plan_type !== "rotational") return false;

          try {
            const s = JSON.parse(p.sports_json || "[]");
            return s
              .map((x) =>
                String(x).trim().toLowerCase()
              )
              .includes(
                String(sport).trim().toLowerCase()
              );
          } catch {
            return false;
          }
        }) ||
        planRows.find(
          (p) => p.plan_type === "rotational"
        );

      const start =
        rotPlan && rotPlan.rotational_start_level;
      const end =
        rotPlan && rotPlan.rotational_end_level;

      let isFirstSport = false;

      if (rotPlan && rotPlan.sports_json) {
        try {
          const s = JSON.parse(rotPlan.sports_json || "[]");
          isFirstSport =
            s.length > 0 &&
            String(s[0]).trim().toLowerCase() ===
            String(sport).trim().toLowerCase();
        } catch {
          isFirstSport = false;
        }
      }

      const shouldApplyRange =
        start &&
        end &&
        (isFirstSport ||
          (tmplLevelRows.length > 0 &&
            Object.keys(map).length === 0));

      if (shouldApplyRange) {
        const rStart = gradeRank(start);
        const rEnd = gradeRank(end);
        const FOUNDATION = ["Nursery", "Jr. Kg", "Sr. Kg"];
        const seen = new Set();

        // The first sport's range replaces the (possibly
        // auto-generated) Builder entries entirely.
        if (isFirstSport) {
          for (const key of Object.keys(map)) {
            delete map[key];
          }
        }

        const pushLevel = (level, label) => {
          if (!isUsableLevel(level)) {
            return;
          }

          const rank = gradeRank(level);
          const inRange =
            rStart > rEnd ||
            (rank >= rStart && rank <= rEnd);

          if (!inRange) {
            return;
          }

          const gradeKey = getGradeKey(level);

          if (!gradeKey || seen.has(gradeKey)) {
            return;
          }

          seen.add(gradeKey);

          map[gradeKey] = {
            grade_name: level,
            level_grade: level,
            level_label: label || levelLabel(level),
          };
        };

        // Exact DB labels when the sport has a template …
        for (const row of tmplLevelRows) {
          pushLevel(
            String(row.level_grade || "").trim(),
            row.level_label
          );
        }

        // … and top up from the numeric range so template-less
        // sports (Football, Volleyball, …) still expand correctly.
        if (isFirstSport) {
          for (let r = rStart; r <= rEnd; r++) {
            const level =
              r <= 3 ? FOUNDATION[r - 1] : `Grade ${r - 3}`;
            pushLevel(level, null);
          }
        }
      }
    }

    /*
     * ============================================================
     * 6. ROTATIONAL FALLBACK
     *
     * If there are no Builder entries yet, use ONLY the
     * rotational template levels that have lesson plans.
     *
     * NEVER show every template level.
     * ============================================================
     */
    if (
      Object.keys(map).length === 0 &&
      templateControlsVisibility
    ) {
      for (const row of configuredTemplateRows) {
        const gradeKey = getGradeKey(
          row.level_grade
        );

        if (!gradeKey) {
          continue;
        }

        /*
         * Prevent duplicates.
         */
        if (map[gradeKey]) {
          continue;
        }

        map[gradeKey] = {
          grade_name: row.level_grade,
          level_grade: row.level_grade,
          level_label:
            row.level_label ||
            levelLabel(row.level_grade),
        };
      }
    }

    /*
     * ============================================================
     * 7. NON-ROTATIONAL FALLBACK
     *
     * If there is no rotational template controlling visibility
     * and no Builder entries exist, keep the previous behavior
     * by reading active template levels.
     * ============================================================
     */
    if (
      Object.keys(map).length === 0 &&
      !templateControlsVisibility &&
      tmplLevelRows.length > 0
    ) {
      for (const row of tmplLevelRows) {
        const levelGrade = String(
          row.level_grade || ""
        ).trim();

        if (!levelGrade) {
          continue;
        }

        const gradeKey =
          getGradeKey(levelGrade);

        if (!gradeKey) {
          continue;
        }

        /*
         * Prevent duplicate grades.
         */
        if (map[gradeKey]) {
          continue;
        }

        map[gradeKey] = {
          grade_name: levelGrade,
          level_grade: levelGrade,
          level_label:
            row.level_label ||
            levelLabel(levelGrade),
        };
      }
    }

    /*
     * ============================================================
     * 7.5 ROTATIONAL TEMPLATE LP FILTER
     *
     * When the selected sport has an active rotational template
     * whose levels carry lesson plans, restrict the Select Grade
     * list to those levels only.
     *
     * Example: a school has Badminton grades 1-4 configured, but
     * the template has LPs only for Level 2 & 3 -> only Grade 2
     * and Grade 3 are shown. A level appears later, once LPs are
     * assigned to it.
     *
     * Applied last so it also trims the range-expanded levels.
     * Template-less sports are unaffected.
     * ============================================================
     */
    if (templateControlsVisibility) {
      const configuredNorm = new Set(
        Array.from(configuredLevels).map((l) =>
          normGradeName(String(l || "")),
        ),
      );

      for (const key of Object.keys(map)) {
        const level = String(map[key].level_grade || "");

        if (!configuredNorm.has(normGradeName(level))) {
          delete map[key];
        }
      }
    }

    /*
     * ============================================================
     * 8. LEGACY SCHOOL-GRADE MAP
     *
     * Kept for the school-wide weekly plan PDF, which labels each
     * lesson plan with the SCHOOL grade (curriculum_builder_
     * entries.grade_name) rather than the level. The Select Grade
     * step uses `map` (levels); this map is provided separately so
     * that surface is unaffected by the level-based change.
     * ============================================================
     */
    const schoolGradeMap = {};

    for (const row of entries) {
      if (!row.grade_name) {
        continue;
      }

      const level = String(
        row.level_grade || ""
      ).trim();

      if (!isUsableLevel(level)) {
        continue;
      }

      const gradeKey = getGradeKey(row.grade_name);

      if (!gradeKey || schoolGradeMap[gradeKey]) {
        continue;
      }

      schoolGradeMap[gradeKey] = {
        grade_name: row.grade_name,
        level_grade: level,
        level_label: levelLabel(level),
      };
    }

    /*
     * ============================================================
     * 9. RESPONSE
     * ============================================================
     */
    return res.json({
      success: true,
      map,
      school_grade_map: schoolGradeMap,
    });
  } catch (err) {
    console.error(
      "FETCH GRADE LEVEL MAP ERROR:",
      err
    );

    return res.status(500).json({
      success: false,
      message: "Error fetching grade level map",
    });
  }
});


/*
 * ================================================================
 * SPORTS BY GRADE
 * ================================================================
 *
 * Returns all unique sports from year_lp_master_new.
 *
 * The endpoint no longer duplicates sports.
 */

; // stripped /api/curriculum/sports-by-grade


// 🎯 GET SPORT HISTORY SUMMARY — for Assigned Lesson History modal
// Returns all sports from year_lp_master with assigned counts from year_lp_master_new
// and completed counts from coach_lesson_tracking

; // stripped /api/curriculum/history-sport-summary


// 🎯 GET UPCOMING LESSONS — next week plan from year_lp_master not yet seeded
// Shows what Week 2 (or next month's batch) will look like

; // stripped /api/curriculum/upcoming-lessons


// 🎯 GET UNIQUE STUDENT STANDARDS
app.get("/api/students/standards", async (req, res) => {
  const { school_id } = req.query;
  try {
    if (school_id) {
      const [rows] = await db.query(
        `SELECT DISTINCT sm.name, sm.std_code
         FROM school_stds ss
         JOIN stds_master sm ON sm.id = ss.std_id
         WHERE ss.school_id = ?
         ORDER BY sm.std_code ASC`,
        [school_id],
      );
      res.json({ success: true, standards: rows.map((r) => r.name) });
    } else {
      const [rows] = await db.query(
        "SELECT DISTINCT std FROM students ORDER BY CAST(std AS UNSIGNED) ASC",
      );
      res.json({ success: true, standards: rows.map((r) => r.std) });
    }
  } catch (err) {
    console.error("FETCH STANDARDS ERROR:", err);
    res
      .status(500)
      .json({ success: false, message: "Error fetching standards" });
  }
});

// 🎯 GET UNIQUE DIVISIONS FOR SELECTED STANDARDS
app.get("/api/students/divisions", async (req, res) => {
  const { stds, school_id } = req.query; // Expecting comma separated or array
  try {
    if (school_id) {
      let query = `
        SELECT DISTINCT ss.division 
        FROM school_stds ss
        JOIN stds_master sm ON sm.id = ss.std_id
        WHERE ss.school_id = ? 
          AND ss.division IS NOT NULL 
          AND ss.division != ''
      `;
      let params = [school_id];

      if (stds) {
        const stdList = Array.isArray(stds) ? stds : stds.split(",");
        if (stdList.length > 0) {
          query += ` AND sm.name IN (${stdList.map(() => "?").join(",")})`;
          params.push(...stdList);
        }
      }

      query += " ORDER BY ss.division ASC";
      const [rows] = await db.query(query, params);
      res.json({ success: true, divisions: rows.map((r) => r.division) });
    } else {
      let query =
        "SELECT DISTINCT division FROM students WHERE 1=1 AND division IS NOT NULL AND division != ''";
      let params = [];

      if (stds) {
        const stdList = Array.isArray(stds) ? stds : stds.split(",");
        if (stdList.length > 0) {
          query += ` AND std IN (${stdList.map(() => "?").join(",")})`;
          params.push(...stdList);
        }
      }

      query += " ORDER BY division ASC";
      const [rows] = await db.query(query, params);
      res.json({ success: true, divisions: rows.map((r) => r.division) });
    }
  } catch (err) {
    console.error("FETCH DIVISIONS ERROR:", err);
    res
      .status(500)
      .json({ success: false, message: "Error fetching divisions" });
  }
});

// 🎯 GET ALL MASTER LESSON PLANS (DETAILED LIST)

; // stripped /api/curriculum/master-list


const curriculumEvidenceStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, path.join(__dirname, "uploads/curriculum_evidence"));
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, "evidence-" + Date.now() + ext);
  },
});
const uploadEvidence = multer({ storage: curriculumEvidenceStorage });
app.get("/api/curriculum/lesson-history", async (req, res) => {
  const { lp_unique_id, school_id, divisions, grade } = req.query;
  try {
    if (!lp_unique_id || !school_id) {
      return res.json({ success: true, history: [] });
    }

    const divList = divisions
      ? divisions
        .split(",")
        .map((d) => d.trim().toLowerCase())
        .filter(Boolean)
      : [];
    console.log("LESSON HISTORY QUERY:", lp_unique_id, school_id, grade);
    const [rows] = await db.query(
      `SELECT id, status, remark, evidence_photo, divisions, grade, created_at, user_id, extra_topic_title, extra_topic_description FROM coach_lesson_tracking  WHERE unique_id = ? AND school_id = ? ORDER BY created_at DESC, id DESC`,
      [lp_unique_id, school_id],
    );
    console.log("LESSON HISTORY DB ROWS:", rows);
    const history = rows.filter((row) => {
      if (grade && normalizeGrade(row.grade) !== normalizeGrade(grade)) {
        return false;
      }

      // If no divisions were supplied, return all records for this grade.
      if (divList.length === 0) {
        return true;
      }

      if (!row.divisions) return false;

      const recordDivs = String(row.divisions)
        .split(",")
        .map((d) => d.trim().toLowerCase());

      return divList.some((td) => recordDivs.includes(td));
    });
    res.json({ success: true, history });
  } catch (err) {
    console.error("FETCH HISTORY ERROR:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

app.get("/api/curriculum/check-done", async (req, res) => {
  const { lp_unique_id, school_id, divisions, grade } = req.query;

  try {
    if (!lp_unique_id || !school_id) {
      return res.json({
        success: true,
        isDone: false,
        lessonStatus: null,
      });
    }

    console.log("CHECK DONE QUERY:", lp_unique_id, school_id, divisions, grade);

    const [rows] = await db.query(
      `
      SELECT
        id,
        remark,
        status,
        grade,
        created_at,
        divisions,
        extra_topic_title,
        extra_topic_description
      FROM coach_lesson_tracking
      WHERE unique_id = ? AND school_id = ?
      ORDER BY created_at DESC, id DESC
      `,
      [lp_unique_id, school_id],
    );

    // Restrict aggregation to the selected grade only (shared across users).
    const scopedRows =
      grade && grade !== "undefined"
        ? rows.filter(
          (row) => normalizeGrade(row.grade) === normalizeGrade(grade),
        )
        : rows;

    if (scopedRows.length === 0) {
      return res.json({
        success: true,
        isDone: false,
        lessonStatus: null,
      });
    }

    // Latest record (used for restoring status) within the selected grade
    const latestRecord = scopedRows[0];
    const lessonStatus = latestRecord?.status || null;

    // Requested divisions from frontend
    const targetDivs = (divisions || "")
      .split(",")
      .map((d) => d.trim().toLowerCase())
      .filter(Boolean);

    // Collect completed divisions
    const completedDivsSet = new Set();

    scopedRows.forEach((row) => {
      const status = String(row.status || "").toLowerCase();

      if (status === "complete" || status === "done") {
        const rowDivs = String(row.divisions || "")
          .split(",")
          .map((d) => d.trim().toLowerCase())
          .filter(Boolean);

        rowDivs.forEach((rd) => completedDivsSet.add(rd));
      }
    });

    const doneList = targetDivs.filter((td) => completedDivsSet.has(td));

    const pendingList = targetDivs.filter((td) => !completedDivsSet.has(td));

    // If no divisions supplied, simply check whether
    // any completed record exists.
    const isDone =
      targetDivs.length === 0
        ? scopedRows.some((row) => {
          const status = String(row.status || "").toLowerCase();
          return status === "complete" || status === "done";
        })
        : pendingList.length === 0;

    return res.json({
      success: true,
      isDone,
      lessonStatus,
      completedDivisions: doneList,
      pendingDivisions: pendingList,
      hasAnyHistory: completedDivsSet.size > 0,
      record: latestRecord,
    });
  } catch (err) {
    console.error("CHECK DONE ERROR:", err);
    res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
});

// 🎯 GET ASSIGNED HISTORY (PREVIOUS WEEKS UNMARKED LESSON PLANS)

; // stripped /api/curriculum/assigned-history-unmarked


app.post(
  "/api/curriculum/save-lp-status",
  uploadEvidence.array("photos", 10),
  async (req, res) => {
    try {
      const {
        lp_no,
        lp_unique_id,
        user_id,
        status,
        remark,
        school_id,
        divisions,
        sport,
        grade,
        extra_topic_title,
        extra_topic_description,
        week_no,
        month_year,
        session_type,
      } = req.body;
      let evidence_photo = null;

      if (req.files && req.files.length > 0) {
        evidence_photo = req.files
          .map((file) => `/uploads/curriculum_evidence/${file.filename}`)
          .join(",");
      }

      // Parse grades and divisions (split by comma to support multiple entries)
      const gradeList = grade
        ? String(grade)
          .split(",")
          .map((g) => g.trim())
          .filter(Boolean)
        : [null];
      const divisionList = divisions
        ? String(divisions)
          .split(",")
          .map((d) => d.trim())
          .filter(Boolean)
        : [null];

      let insertedCount = 0;

      for (const gVal of gradeList) {
        for (const dVal of divisionList) {
          let masterRows = [];
          if (lp_unique_id) {
            if (school_id) {
              [masterRows] = await db.query(
                "SELECT * FROM year_lp_master_new WHERE unique_id = ? AND school_id = ?",
                [lp_unique_id, school_id],
              );
            }
            if (masterRows.length === 0) {
              [masterRows] = await db.query(
                "SELECT * FROM year_lp_master_new WHERE unique_id = ?",
                [lp_unique_id],
              );
            }
            if (masterRows.length === 0) {
              [masterRows] = await db.query(
                "SELECT * FROM year_lp_master WHERE lp_unique_id = ?",
                [lp_unique_id],
              );
            }
          }
          if (masterRows.length === 0 && lp_no && sport) {
            if (gVal) {
              [masterRows] = await db.query(
                "SELECT * FROM year_lp_master_new WHERE lp_no = ? AND sport = ? AND grade = ? ORDER BY id DESC LIMIT 1",
                [lp_no, sport, gVal],
              );
              if (masterRows.length === 0) {
                [masterRows] = await db.query(
                  "SELECT * FROM year_lp_master WHERE lp_no = ? AND sport = ? AND grade = ? ORDER BY id DESC LIMIT 1",
                  [lp_no, sport, gVal],
                );
              }
            }
            if (masterRows.length === 0) {
              [masterRows] = await db.query(
                "SELECT * FROM year_lp_master_new WHERE lp_no = ? AND sport = ? ORDER BY id DESC LIMIT 1",
                [lp_no, sport],
              );
              if (masterRows.length === 0) {
                [masterRows] = await db.query(
                  "SELECT * FROM year_lp_master WHERE lp_no = ? AND sport = ? ORDER BY id DESC LIMIT 1",
                  [lp_no, sport],
                );
              }
            }
          }
          if (masterRows.length === 0 && lp_no && sport && school_id) {
            [masterRows] = await db.query(
              "SELECT * FROM year_lp_master_new WHERE lp_no = ? AND sport = ? AND school_id = ? ORDER BY id DESC LIMIT 1",
              [lp_no, sport, school_id],
            );
            if (masterRows.length === 0) {
              [masterRows] = await db.query(
                "SELECT * FROM year_lp_master WHERE lp_no = ? AND sport = ? AND school_id = ? ORDER BY id DESC LIMIT 1",
                [lp_no, sport, school_id],
              );
            }
          }

          if (masterRows.length === 0) {
            continue; // Skip if original lesson plan not found
          }

          const master = masterRows[0];

          await db.query(
            `
          INSERT INTO coach_lesson_tracking 
          (unique_id, lp_no, sport, skill, sub_skill, objective, teaching_aids, warm_up, skill_implementation, picture, cool_down, summarization, life_skill, month_year, week, grade, user_id, status, remark, evidence_photo, school_id, divisions, extra_topic_title, extra_topic_description, session_type)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
            [
              master.unique_id || master.lp_unique_id || lp_unique_id,
              master.lp_no,
              master.sport,
              master.skill,
              master.sub_skill,
              master.objective,
              master.teaching_aids,
              master.warm_up,
              master.skill_implementation,
              master.picture,
              master.cool_down,
              master.summarization,
              master.life_skill,
              month_year || master.month_year || null,
              week_no || master.week || null,
              gVal || master.grade || null,
              user_id || 1,
              status || "Complete",
              remark || "",
              evidence_photo,
              school_id || master.school_id || null,
              dVal || master.divisions || null,
              extra_topic_title || null,
              extra_topic_description || null,
              session_type || null,
            ],
          );

          const simpleStatus = status === "Complete" ? "Done" : "Pending";
          await db.query(
            `
          INSERT INTO lp_status (lp_no, lp_unique_id, user_id, school_id, status, remark)
          VALUES (?, ?, ?, ?, ?, ?)
          ON DUPLICATE KEY UPDATE status = VALUES(status), remark = VALUES(remark), school_id = VALUES(school_id)
        `,
            [
              master.lp_no,
              master.unique_id || master.lp_unique_id || lp_unique_id,
              user_id || 1,
              school_id || master.school_id || 0,
              simpleStatus,
              remark || "",
            ],
          );

          insertedCount++;
        }
      }

      if (insertedCount === 0) {
        return res.status(404).json({
          success: false,
          message: "Original lesson plan not found in master data",
        });
      }

      await ensureWeeklyReportStarted({
        school_id,
        user_id,
        month_year,
        week_no,
      });

      await auditAction(req, () => ({
        page: "Weekly Report",
        type: "SAVE",
        action: `Marked lesson plan "${lp_unique_id || lp_no || "N/A"}" (${sport || ""} LP ${lp_no || ""}) as ${status === "Complete" ? "Complete" : "Pending"} for ${gradeList.join(",") || "N/A"} ${divisionList.join(",") || ""} (school #${school_id || "N/A"}, ${week_no || ""} ${month_year || ""}, ${insertedCount} combo(s))`,
      }));

      res.json({
        success: true,
        message: `Status tracked successfully for ${insertedCount} class/division combination(s)`,
      });
    } catch (err) {
      console.error("SAVE LP STATUS ERROR:", err);
      res
        .status(500)
        .json({ success: false, message: "Error saving LP status" });
    }
  },
);

// 🎯 SAVE EXTRA/CUSTOM ACTIVITY
app.post(
  "/api/curriculum/save-extra-activity",
  uploadEvidence.array("photos", 10),
  async (req, res) => {
    try {
      const {
        title,
        sport,
        covered_skill,
        objective,
        school_id,
        grade,
        divisions,
        remark,
        user_id,
        week,
        month_year,
      } = req.body;

      let evidence_photo = null;
      if (req.files && req.files.length > 0) {
        evidence_photo = req.files
          .map((file) => `/uploads/curriculum_evidence/${file.filename}`)
          .join(",");
      }

      // Normalize month_year to 'MMM-YYYY' format (e.g. 'Jul-2026')
      let normalizedMonthYear = month_year;
      if (month_year) {
        const parts = month_year.trim().split(/[\s,.-]+/);
        if (parts.length >= 2) {
          const monthStr = parts[0].substring(0, 3);
          const formattedMonth =
            monthStr.charAt(0).toUpperCase() + monthStr.slice(1).toLowerCase();
          const yearStr = parts[1];
          normalizedMonthYear = `${formattedMonth}-${yearStr}`;
        }
      }

      // Split grades and divisions by comma to support multiple entries
      const gradeList = grade
        ? String(grade)
          .split(",")
          .map((g) => g.trim())
          .filter(Boolean)
        : [null];
      const divisionList = divisions
        ? String(divisions)
          .split(",")
          .map((d) => d.trim())
          .filter(Boolean)
        : [null];

      let insertedCount = 0;

      for (const gVal of gradeList) {
        for (const dVal of divisionList) {
          const uniqueId = `EXTRA-${Date.now()}-${Math.floor(Math.random() * 10000)}`;

          await db.query(
            `
          INSERT INTO coach_lesson_tracking 
          (unique_id, lp_no, sport, skill, sub_skill, objective, teaching_aids, warm_up, skill_implementation, picture, cool_down, summarization, life_skill, month_year, week, grade, user_id, status, remark, evidence_photo, school_id, divisions, extra_topic_title, extra_topic_description, session_type)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
            [
              uniqueId,
              "0", // designating extra/custom activity
              sport || "Extra Covered",
              covered_skill || title,
              covered_skill || "",
              objective || "",
              null,
              null,
              null,
              null,
              null,
              null,
              null,
              normalizedMonthYear || null,
              week || null,
              gVal,
              user_id || 1,
              "Complete",
              remark || "",
              evidence_photo,
              school_id || null,
              dVal,
              title || null,
              remark || null,
              req.body.session_type || null,
            ],
          );

          insertedCount++;
        }
      }

      await ensureWeeklyReportStarted({
        school_id,
        user_id,
        month_year,
        week_no: week,
      });

      await auditAction(req, () => ({
        page: "Extra Activity",
        type: "CREATE",
        action: `Logged extra activity "${title || ""}" (${sport || ""}${covered_skill ? " - " + covered_skill : ""}) for ${grade || "N/A"} ${divisions || ""} (school #${school_id || "N/A"}, ${week || ""} ${month_year || ""}, ${insertedCount} combo(s))`,
      }));

      res.json({
        success: true,
        message: `Extra activity logged successfully for ${insertedCount} class/division combination(s)`,
      });
    } catch (err) {
      console.error("SAVE EXTRA ACTIVITY ERROR:", err);
      res
        .status(500)
        .json({ success: false, message: "Error saving extra activity" });
    }
  },
);

// 🗑️ DELETE CURRICULUM MASTER

; // stripped /api/curriculums/:id


// 🗑️ DELETE SINGLE MASTER LESSON PLAN

; // stripped /api/curriculum/master/:id


; // stripped /api/curriculum/master/:id


// 🎯 GET COACH'S ASSIGNED LESSON PLANS WITH STATUS (PHP LOGIC)

; // stripped /api/curriculum/my-assigned-master


// 🗑️ REMOVE LP STATUS

; // stripped /api/curriculum/remove-lp-status


// 🎯 ASSIGN CURRICULUM

; // stripped /api/curriculum/assign


// 🎯 CHECK ALREADY ASSIGNED MODULES FOR A COACH

; // stripped /api/curriculum/check-assigned


// 🎯 GET ALL ASSIGNMENTS FOR A SPECIFIC COACH (SUMMARY)
app.get("/api/curriculum/my-assignments/:userId", async (req, res) => {
  try {
    const { userId } = req.params;

    let [rows] = await db.query(
      `
      SELECT 
        sla.id, 
        sla.sport, 
        sla.id_indicate_curriculum,
        (SELECT COUNT(*) FROM year_lp_master ylm WHERE ylm.id_indicate_curriculum = sla.id_indicate_curriculum) as module_count,
        MAX(sla.created_at) as created_at
      FROM sport_lp_assign sla
      WHERE sla.user_id = ?
      GROUP BY sla.id, sla.sport, sla.id_indicate_curriculum
      ORDER BY created_at DESC
    `,
      [userId],
    );

    // 🚀 SUPER ADMIN BYPASS: If Admin (1) has no assignments, show all unique curriculums
    if (rows.length === 0 && userId == "1") {
      console.log("[DEBUG] Admin bypass triggered for Summary");
      [rows] = await db.query(`
        SELECT 
          MIN(id) as id, 
          sport, 
          id_indicate_curriculum, 
          COUNT(*) as module_count, 
          MAX(created_at) as created_at 
        FROM year_lp_master 
        GROUP BY id_indicate_curriculum, sport
      `);
    }

    res.json({ success: true, assignments: rows });
  } catch (err) {
    console.error("FETCH MY ASSIGNMENTS ERROR:", err);
    res
      .status(500)
      .json({ success: false, message: "Server error fetching assignments" });
  }
});

// 🎯 GET ALL MODULES FOR A SPECIFIC CURRICULUM

; // stripped /api/curriculum/modules/:id


// 🎯 GET ALL LESSON MODULES FOR A SPECIFIC COACH (FULL LIST - PHP REFERENCE LOGIC)
app.get("/api/curriculum/my-modules/:userId", async (req, res) => {
  try {
    const { userId } = req.params;

    let [rows] = await db.query(
      `
      SELECT 
        ylm.id as module_id, 
        ylm.sport, 
        ylm.grade, 
        ylm.skill,
        ylm.sub_skill,
        ylm.objective,
        ylm.lp_no,
        ylm.created_at as module_date
      FROM year_lp_master ylm
      WHERE ylm.id_indicate_curriculum IN (
        SELECT id_indicate_curriculum FROM sport_lp_assign WHERE user_id = ?
      )
      ORDER BY ylm.sport, ylm.grade, ylm.lp_no, ylm.id
    `,
      [userId],
    );

    // 🚀 SUPER ADMIN BYPASS: If Admin (1) has no assignments, show all modules
    if (rows.length === 0 && userId == "1") {
      console.log("[DEBUG] Admin bypass triggered for Modules");
      [rows] = await db.query(`
        SELECT 
          id as module_id, sport, grade, skill, sub_skill, objective, lp_no, created_at as module_date 
        FROM year_lp_master 
        ORDER BY sport, grade, lp_no
        LIMIT 500
      `);
    }

    res.json({ success: true, modules: rows });
  } catch (err) {
    console.error("FETCH MY MODULES ERROR:", err);
    res.status(500).json({
      success: false,
      message: "Server error fetching lesson modules",
    });
  }
});

// 📋 GET ALL ASSIGNMENTS

; // stripped /api/curriculum/assignments


// 🎯 GET ALL AVAILABLE COACHES (ROLE_ID = 4)

; // stripped /api/curriculum/coaches


// 🎯 BATCH ASSIGN LESSON PLANS TO A COACH (PHP REFERENCE LOGIC)

; // stripped /api/curriculum/assign-batch


// 🏫 GET SCHOOLS ASSIGNED TO A SPECIFIC COACH

; // stripped /api/curriculum/coach-schools/:coachId


// 🎯 GET ALL ASSIGNMENTS MADE BY A SPECIFIC HEAD COACH

; // stripped /api/curriculum/assignments-by-me/:userId


// 📄 GET WEEKLY CURRICULUM REPORT DATA (JSON)

; // stripped /api/curriculum/weekly-report-data


// 📊 GET WEEKLY REPORT STATS (LIGHTWEIGHT — SSGM Dashboard card)

; // stripped /api/curriculum/weekly-report-stats


// 📊 GET WEEKLY REPORT STATS FOR SCOPE (User Activity Log)
// Scope-aware variant of /api/curriculum/weekly-report-stats.
// Supports three modes: all, user, role.
//
// IMPORTANT: Unlike the SSGM Dashboard endpoint, this one does NOT treat
// Admin (1) / Super Admin (7) / Operations Head (2) as unrestricted.
// ONLY scope=all returns every school. scope=role resolves the selected
// role's users and their actual school assignments, and returns [] when
// none of those users have any assigned school.

; // stripped /api/weekly-report-stats-for-scope


// 📊 GET CURRICULUM TRACKER SUMMARY (DETAILED)

; // stripped /api/curriculum/tracker-summary


// 📊 GET DASHBOARD STATS (COUNTS)
app.get("/api/dashboard/stats", async (req, res) => {
  try {
    const { user_id } = req.query;

    // 1. Determine assigned schools
    let schoolIds = [];
    if (user_id) {
      const [[user]] = await db.query(
        "SELECT role_id FROM users WHERE id = ?",
        [user_id],
      );
      if (
        user &&
        user.role_id !== 1 &&
        user.role_id !== 7 &&
        user.role_id !== 2
      ) {
        const [assignments] = await db.query(
          "SELECT school_id FROM assign_school WHERE user_id = ?",
          [user_id],
        );
        schoolIds = assignments.map((a) => a.school_id);
      }
    }

    // 2. Build filters (If no assignments, they see all data as an Admin fallback)
    let studentWhere = "";
    let schoolWhere = "";

    if (schoolIds.length > 0) {
      const idList = schoolIds.join(",");
      studentWhere = `WHERE school_id IN (${idList})`;
      schoolWhere = `WHERE id IN (${idList})`;
    }

    const [[{ students }]] = await db.query(
      `SELECT COUNT(*) as students FROM students ${studentWhere}`,
    );
    const [[{ schools }]] = await db.query(
      `SELECT COUNT(*) as schools FROM schools ${schoolWhere}`,
    );

    // 3. Additional Stats (Principal View)
    let lectureWhere =
      schoolIds.length > 0 ? `WHERE school_id IN (${schoolIds.join(",")})` : "";
    let mirWhere =
      schoolIds.length > 0 ? `WHERE school_id IN (${schoolIds.join(",")})` : "";

    const [[{ count: lectures }]] = await db.query(
      `SELECT COUNT(*) as count FROM marked_lectures ${lectureWhere}`,
    );

    // Weekly reports = distinct published (school, month, week) reports,
    // matching the count shown on the principal report page.
    const weeklyConds = [
      "school_able_to_visibale_status = 1",
      "week IS NOT NULL",
      "month_year IS NOT NULL",
    ];
    if (schoolIds.length > 0) {
      weeklyConds.push(`school_id IN (${schoolIds.join(",")})`);
    }
    const [weeklyRows] = await db.query(
      `SELECT school_id, month_year, week
       FROM coach_lesson_tracking
       WHERE ${weeklyConds.join(" AND ")}
       GROUP BY school_id, month_year, week`,
    );
    const weeklyReportKeys = new Set();
    for (const row of weeklyRows) {
      const normalizedMonthYear = normalizeWeeklyReportMonthYear(
        row.month_year,
      );
      const normalizedWeek = normalizeWeeklyReportWeek(row.week);
      if (normalizedMonthYear && normalizedWeek) {
        weeklyReportKeys.add(
          `${row.school_id}|${normalizedMonthYear}|${normalizedWeek}`,
        );
      }
    }
    const weekly_reports = weeklyReportKeys.size;

    const [[{ count: mir_reports }]] = await db.query(
      `SELECT COUNT(*) as count FROM mir_reports ${mirWhere}`,
    );

    let staffCount = 0;
    let hqStaffCount = 0;

    if (schoolIds.length > 0) {
      // 1. Calculate On-Ground Staff (HC + Coaches)
      const [groundStaff] = await db.query(`
        SELECT COUNT(DISTINCT user_id) as count 
        FROM assign_school ash
        JOIN users u ON ash.user_id = u.id
        WHERE ash.school_id IN (${schoolIds.join(",")})
        AND u.role_id IN (4, 5)
      `);

      // 2. Calculate HQ Staff for these schools (SSGM + 5 template members)
      const [ssgmCount] = await db.query(`
        SELECT COUNT(DISTINCT ssgm_id) as count 
        FROM assign_school 
        WHERE school_id IN (${schoolIds.join(",")})
        AND ssgm_id IS NOT NULL
      `);

      // If the logged-in user is an SSGM (role_id = 3), only show the count of head coaches and coaches
      const [[user]] = await db.query(
        "SELECT role_id FROM users WHERE id = ?",
        [user_id],
      );
      if (user && user.role_id === 3) {
        staffCount = Number(groundStaff[0].count);
      } else {
        // Total Combined Staff = Ground + SSGM + 5 (Ops/IT/Creative/Curr)
        staffCount =
          Number(groundStaff[0].count) + Number(ssgmCount[0].count) + 5;
      }
    } else {
      // Global View (Admin)
      const [[{ totalStaff }]] = await db.query(
        "SELECT COUNT(*) as totalStaff FROM users",
      );
      staffCount = totalStaff;
    }

    res.json({
      success: true,
      data: {
        students,
        schools,
        staff: staffCount,
        lectures,
        weekly_reports,
        mir_reports,
      },
    });
  } catch (err) {
    console.error("DASHBOARD STATS ERROR:", err);
    res.status(500).json({ success: false, message: "Internal Server Error" });
  }
});

// ⚡ GET DASHBOARD GALLERY CONTENT (FEED)
app.get("/api/dashboard/content-feed", async (req, res) => {
  try {
    const { user_id } = req.query;

    let schoolIds = [];
    if (user_id) {
      const [[user]] = await db.query(
        "SELECT role_id FROM users WHERE id = ?",
        [user_id],
      );
      if (
        user &&
        user.role_id !== 1 &&
        user.role_id !== 7 &&
        user.role_id !== 2
      ) {
        const [assignments] = await db.query(
          "SELECT school_id FROM assign_school WHERE user_id = ?",
          [user_id],
        );
        schoolIds = assignments.map((a) => a.school_id);
      }
    }

    let whereClause = "";
    if (schoolIds.length > 0) {
      const idList = schoolIds.join(",");
      // Show content strictly assigned to our schools OR general content that isn't locked down
      whereClause = `AND (school_id IN (${idList}) OR school_id IS NULL)`;
    }

    const [videos] = await db.query(
      `SELECT * FROM dashboard_social_content WHERE content_type = 'video' AND is_active = 1 ${whereClause} ORDER BY id DESC LIMIT 20`,
    );
    const [photos] = await db.query(
      `SELECT * FROM dashboard_social_content WHERE content_type = 'photo' AND is_active = 1 ${whereClause} ORDER BY id DESC LIMIT 8`,
    );

    // Merge highlights that have reel_urls or images into the feed
    const [highlightItems] = await db.query(
      `SELECT * FROM dashboard_highlights h WHERE is_active = 1 ${whereClause.replace("school_id", "h.school_id").replace("h.h.", "h.")} ORDER BY id DESC`,
    );

    const mergedVideos = [...videos];
    const mergedPhotos = [...photos];

    highlightItems.forEach((h) => {
      if (h.reel_url) {
        mergedVideos.unshift({
          id: "h-" + h.id,
          title: h.title,
          video_path: null,
          thumbnail_url: h.image_path,
          url: h.reel_url,
          category: h.category,
        });
      } else if (h.image_path) {
        mergedPhotos.unshift({
          id: "h-" + h.id,
          title: h.title,
          thumbnail_url: h.image_path,
          url: null,
          category: h.category,
        });
      }
    });

    res.json({
      success: true,
      data: {
        videos: mergedVideos.slice(0, 20),
        photos: mergedPhotos.slice(0, 12),
      },
    });
  } catch (err) {
    console.error("CONTENT FEED ERROR:", err);
    res
      .status(500)
      .json({ success: false, message: "Error fetching gallery content" });
  }
});

// 🛠️ MANAGE SOCIAL CONTENT (CRUD)

; // stripped /api/dashboard/manage-content



; // stripped /api/dashboard/manage-content



; // stripped /api/dashboard/toggle-content/:id



; // stripped /api/dashboard/manage-content/:id


// 🎫 SUBMIT SUPPORT TICKET — handled below with SSGM routing (see POST /api/support/ticket near end of file)

// 🎓 ACADEMY STUDENT ROSTER

; // stripped /api/dashboard/students


// 📅 DASHBOARD EVENTS (CALENDAR)
app.get("/api/dashboard/events", async (req, res) => {
  try {
    const { user_id, role_id } = req.query;

    // Admin / Operations Head (role_id = 1, 7, 2): show ALL events
    if (role_id == "1" || role_id == "7" || role_id == "2") {
      const [rows] = await db.query(
        "SELECT * FROM dashboard_events ORDER BY event_date ASC",
      );
      return res.json({ success: true, data: rows });
    }

    // Non-admin: get assigned schools
    let schoolIds = [];
    if (user_id) {
      const [assignments] = await db.query(
        "SELECT school_id FROM assign_school WHERE user_id = ?",
        [user_id],
      );
      schoolIds = assignments.map((a) => a.school_id);
    }

    // No school assigned → return empty
    if (schoolIds.length === 0) {
      return res.json({ success: true, data: [] });
    }

    // Show only this school's events (not global NULL ones)
    const idList = schoolIds.join(",");
    const whereClause = `WHERE school_id IN (${idList})`;
    const [rows] = await db.query(
      `SELECT * FROM dashboard_events ${whereClause} ORDER BY event_date ASC`,
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    console.error("GET EVENTS ERROR:", err);
    res.status(500).json({ success: false, message: "Internal Server Error" });
  }
});

app.post("/api/dashboard/events", async (req, res) => {
  try {
    const { title, description, event_date, category, is_featured, school_id } =
      req.body;
    await db.query(
      "INSERT INTO dashboard_events (title, description, event_date, category, is_featured, school_id) VALUES (?, ?, ?, ?, ?, ?)",
      [
        title,
        description,
        event_date,
        category || "Event",
        is_featured || 0,
        school_id || null,
      ],
    );
    res.json({ success: true, message: "Event scheduled successfully" });
  } catch (err) {
    console.error("POST EVENT ERROR:", err);
    res.status(500).json({ success: false, message: "Internal Server Error" });
  }
});


; // stripped /api/ptm-date


// 🎂 BIRTHDAY CHECK

; // stripped /api/check-birthday


// 📅 ALL BIRTHDAYS LIST

; // stripped /api/all-birthdays



; // stripped /api/latest-ptm-date


// Check if a specific user is unlocked for current PTM period
// PTM lock disabled — always return unlocked

; // stripped /api/ptm-unlock/check


// Get all user-school combinations with their PTM lock status (12-hour unlock window)

; // stripped /api/ptm-locks


// Unlock a user for a specific school

; // stripped /api/ptm-unlock


// Re-lock a user for a specific school

; // stripped /api/ptm-relock


// 🌟 DASHBOARD HIGHLIGHTS (SWIPER)
app.get("/api/dashboard/highlights", async (req, res) => {
  try {
    const { user_id, role_id } = req.query;
    let sql =
      "SELECT h.*, s.name as school_name FROM dashboard_highlights h LEFT JOIN schools s ON h.school_id = s.id";
    const params = [];

    // Admin / Operations Head (role_id = 1, 7, 2): show ALL highlights
    if (role_id == "1" || role_id == "7" || role_id == "2") {
      sql += " ORDER BY h.id DESC";
      const [rows] = await db.query(sql, params);
      return res.json({ success: true, data: rows });
    }

    // Non-admin: get assigned schools
    let schoolIds = [];
    if (user_id) {
      const [assignments] = await db.query(
        "SELECT school_id FROM assign_school WHERE user_id = ?",
        [user_id],
      );
      schoolIds = assignments.map((a) => a.school_id);
    }

    // Show this school's highlights AND global highlights (school_id IS NULL)
    if (schoolIds.length > 0) {
      const idList = schoolIds.join(",");
      sql += ` WHERE (h.school_id IN (${idList}) OR h.school_id IS NULL)`;
    } else {
      // If no school assigned, only show global highlights
      sql += " WHERE h.school_id IS NULL";
    }

    sql += " ORDER BY h.id DESC";
    const [rows] = await db.query(sql, params);
    res.json({ success: true, data: rows });
  } catch (err) {
    console.error("GET HIGHLIGHTS ERROR:", err);
    res.status(500).json({ success: false, message: "Internal Server Error" });
  }
});

app.post(
  "/api/dashboard/highlights",
  upload.single("image"),
  async (req, res) => {
    try {
      const { tagline, title, subtitle, category, reel_url, school_id } =
        req.body;
      const file = req.file;

      if (!file && !reel_url) {
        return res.status(400).json({
          success: false,
          message: "Either an image or a reel URL is required",
        });
      }

      let imagePath = null;
      if (file) {
        try {
          const fileName = "highlight_" + Date.now() + "_" + file.originalname;
          const publicUrl = await gcsService.uploadToGCS(file.path, fileName);
          imagePath = publicUrl;

          if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
        } catch (gcsErr) {
          console.error("HIGHLIGHT GCS UPLOAD ERROR:", gcsErr);
          imagePath = file.filename;
        }
      }

      await db.query(
        "INSERT INTO dashboard_highlights (tagline, title, subtitle, image_path, category, reel_url, school_id) VALUES (?, ?, ?, ?, ?, ?, ?)",
        [
          tagline || "",
          title,
          subtitle || "",
          imagePath,
          category || "Event",
          reel_url || null,
          school_id || null,
        ],
      );
      res.json({ success: true, message: "Highlight added successfully" });
    } catch (err) {
      console.error("POST HIGHLIGHT ERROR:", err);
      res
        .status(500)
        .json({ success: false, message: "Internal Server Error" });
    }
  },
);


; // stripped /api/dashboard/highlights/:id


// 🏆 SCHOOL ACHIEVEMENTS
const parseAchievementMedia = (raw) => {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((m) => m && m.path)
      .map((m) => ({
        type: m.type === "video" ? "video" : "image",
        path: m.path,
        url: `/uploads/${m.path}`,
      }));
  } catch (_) {
    return [];
  }
};

// ===================== 🏆 ACHIEVEMENT SOCIAL (likes / comments / saves) =====================
// Additive feature. Tables: see migrations/achievement_social.sql (also ensured at startup).
(async () => {
  try {
    const sqlText = fs.readFileSync(path.join(__dirname, '..', 'migrations', "achievement_social.sql"), "utf8");
    for (const stmt of sqlText.split(";").map((s) => s.replace(/--.*$/gm, "").trim()).filter(Boolean)) {
      await db.query(stmt);
    }
  } catch (err) {
    console.error("ACHIEVEMENT SOCIAL MIGRATION ERROR:", err.message);
  }
})();

// JWT-only identity (never trusts user_id from body/query)
const achievementActor = (req) => {
  try {
    const header = req.headers && req.headers.authorization;
    if (!header || !header.startsWith("Bearer ")) return null;
    const payload = require("jsonwebtoken").verify(header.slice(7).trim(), process.env.JWT_SECRET);
    return payload && payload.id ? parseInt(payload.id, 10) : null;
  } catch (_) {
    return null;
  }
};
const requireAchievementActor = (req, res) => {
  const uid = achievementActor(req);
  if (!uid) res.status(401).json({ success: false, message: "Unauthorized" });
  return uid;
};

const ACH_FEED_SQL = `
  SELECT a.*, s.name AS school_name, u.name AS author_name, u.profile_pic AS author_pic, u.role_id AS author_role_id,
    (SELECT COUNT(*) FROM achievement_likes l WHERE l.achievement_id = a.id) AS like_count,
    (SELECT COUNT(*) FROM achievement_comments c WHERE c.achievement_id = a.id) AS comment_count,
    EXISTS(SELECT 1 FROM achievement_likes l2 WHERE l2.achievement_id = a.id AND l2.user_id = ?) AS liked_by_me,
    EXISTS(SELECT 1 FROM achievement_saves sv WHERE sv.achievement_id = a.id AND sv.user_id = ?) AS saved_by_me
  FROM school_achievements a
  LEFT JOIN schools s ON a.school_id = s.id
  LEFT JOIN users u ON a.created_by = u.id`;
const mapFeedRow = (r) => ({
  id: r.id,
  title: r.title,
  description: r.description || "",
  schoolId: r.school_id,
  schoolName: r.school_name || "",
  createdAt: r.created_at,
  media: parseAchievementMedia(r.media_json),
  author: r.created_by ? { id: r.created_by, name: r.author_name || "", profile_pic: r.author_pic || "", role_id: r.author_role_id } : null,
  like_count: Number(r.like_count) || 0,
  comment_count: Number(r.comment_count) || 0,
  liked_by_me: !!Number(r.liked_by_me),
  saved_by_me: !!Number(r.saved_by_me),
});

app.get("/api/school-achievements/feed", async (req, res) => {
  const uid = requireAchievementActor(req, res);
  if (!uid) return;
  try {
    const [rows] = await db.query(`${ACH_FEED_SQL} ORDER BY a.id DESC`, [uid, uid]);
    res.json({ success: true, data: rows.map(mapFeedRow) });
  } catch (err) {
    console.error("ACHIEVEMENT FEED ERROR:", err);
    res.status(500).json({ success: false, message: "Internal Server Error" });
  }
});

app.get("/api/school-achievements/saved", async (req, res) => {
  const uid = requireAchievementActor(req, res);
  if (!uid) return;
  try {
    const [rows] = await db.query(
      `${ACH_FEED_SQL} JOIN achievement_saves ms ON ms.achievement_id = a.id AND ms.user_id = ? ORDER BY ms.created_at DESC`,
      [uid, uid, uid],
    );
    res.json({ success: true, data: rows.map(mapFeedRow) });
  } catch (err) {
    console.error("ACHIEVEMENT SAVED ERROR:", err);
    res.status(500).json({ success: false, message: "Internal Server Error" });
  }
});

app.post("/api/school-achievements/:id/like", async (req, res) => {
  const uid = requireAchievementActor(req, res);
  if (!uid) return;
  const id = parseInt(req.params.id, 10);
  try {
    const [[exists]] = await db.query("SELECT id FROM school_achievements WHERE id = ?", [id]);
    if (!exists) return res.status(404).json({ success: false, message: "Achievement not found" });
    const [del] = await db.query("DELETE FROM achievement_likes WHERE achievement_id = ? AND user_id = ?", [id, uid]);
    let liked = false;
    if (del.affectedRows === 0) {
      await db.query("INSERT IGNORE INTO achievement_likes (achievement_id, user_id) VALUES (?, ?)", [id, uid]);
      liked = true;
    }
    const [[c]] = await db.query("SELECT COUNT(*) AS n FROM achievement_likes WHERE achievement_id = ?", [id]);
    res.json({ success: true, liked, like_count: Number(c.n) });
  } catch (err) {
    console.error("ACHIEVEMENT LIKE ERROR:", err);
    res.status(500).json({ success: false, message: "Internal Server Error" });
  }
});

app.post("/api/school-achievements/:id/save", async (req, res) => {
  const uid = requireAchievementActor(req, res);
  if (!uid) return;
  const id = parseInt(req.params.id, 10);
  try {
    const [[exists]] = await db.query("SELECT id FROM school_achievements WHERE id = ?", [id]);
    if (!exists) return res.status(404).json({ success: false, message: "Achievement not found" });
    const [del] = await db.query("DELETE FROM achievement_saves WHERE achievement_id = ? AND user_id = ?", [id, uid]);
    let saved = false;
    if (del.affectedRows === 0) {
      await db.query("INSERT IGNORE INTO achievement_saves (achievement_id, user_id) VALUES (?, ?)", [id, uid]);
      saved = true;
    }
    const [[c]] = await db.query("SELECT COUNT(*) AS n FROM achievement_saves WHERE user_id = ?", [uid]);
    res.json({ success: true, saved, saved_count: Number(c.n) });
  } catch (err) {
    console.error("ACHIEVEMENT SAVE ERROR:", err);
    res.status(500).json({ success: false, message: "Internal Server Error" });
  }
});

app.get("/api/school-achievements/:id/comments", async (req, res) => {
  const uid = requireAchievementActor(req, res);
  if (!uid) return;
  try {
    const [rows] = await db.query(
      `SELECT c.id, c.achievement_id, c.user_id, c.comment, c.created_at, u.name, u.profile_pic
       FROM achievement_comments c LEFT JOIN users u ON c.user_id = u.id
       WHERE c.achievement_id = ? ORDER BY c.id ASC`,
      [parseInt(req.params.id, 10)],
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    console.error("ACHIEVEMENT COMMENTS ERROR:", err);
    res.status(500).json({ success: false, message: "Internal Server Error" });
  }
});

app.post("/api/school-achievements/:id/comments", async (req, res) => {
  const uid = requireAchievementActor(req, res);
  if (!uid) return;
  const id = parseInt(req.params.id, 10);
  const comment = String((req.body && req.body.comment) || "").trim();
  if (!comment) return res.status(400).json({ success: false, message: "Comment is required" });
  if (comment.length > 2000) return res.status(400).json({ success: false, message: "Comment is too long" });
  try {
    const [[exists]] = await db.query("SELECT id FROM school_achievements WHERE id = ?", [id]);
    if (!exists) return res.status(404).json({ success: false, message: "Achievement not found" });
    const [r] = await db.query("INSERT INTO achievement_comments (achievement_id, user_id, comment) VALUES (?, ?, ?)", [id, uid, comment]);
    const [[row]] = await db.query(
      `SELECT c.id, c.achievement_id, c.user_id, c.comment, c.created_at, u.name, u.profile_pic
       FROM achievement_comments c LEFT JOIN users u ON c.user_id = u.id WHERE c.id = ?`,
      [r.insertId],
    );
    const [[c]] = await db.query("SELECT COUNT(*) AS n FROM achievement_comments WHERE achievement_id = ?", [id]);
    res.json({ success: true, data: row, comment_count: Number(c.n) });
  } catch (err) {
    console.error("ACHIEVEMENT COMMENT POST ERROR:", err);
    res.status(500).json({ success: false, message: "Internal Server Error" });
  }
});
// =================== END ACHIEVEMENT SOCIAL ===================
app.get("/api/school-achievements", async (req, res) => {
  try {
    const { user_id, exclude_user_id } = req.query;
    let sql =
      "SELECT a.*, s.name AS school_name FROM school_achievements a LEFT JOIN schools s ON a.school_id = s.id";
    const params = [];
    if (user_id) {
      sql += " WHERE a.created_by = ?";
      params.push(user_id);
    } else if (exclude_user_id) {
      sql += " WHERE (a.created_by IS NULL OR a.created_by <> ?)";
      params.push(exclude_user_id);
    }
    sql += " ORDER BY a.id DESC";
    const [rows] = await db.query(sql, params);
    const data = rows.map((r) => ({
      id: r.id,
      title: r.title,
      description: r.description || "",
      schoolId: r.school_id,
      schoolName: r.school_name || "",
      createdAt: r.created_at,
      media: parseAchievementMedia(r.media_json),
    }));
    res.json({ success: true, data });
  } catch (err) {
    console.error("GET ACHIEVEMENTS ERROR:", err);
    res.status(500).json({ success: false, message: "Internal Server Error" });
  }
});

app.post(
  "/api/school-achievements",
  upload.array("media", 10),
  async (req, res) => {
    try {
      const { title, description, user_id, school_id } = req.body;
      if (!title || !String(title).trim()) {
        return res
          .status(400)
          .json({ success: false, message: "Title is required" });
      }

      const files = Array.isArray(req.files) ? req.files : [];
      const media = files.map((f) => ({
        type: (f.mimetype || "").startsWith("video") ? "video" : "image",
        path: f.filename,
      }));

      const schoolId =
        school_id && String(school_id).trim()
          ? parseInt(school_id, 10) || null
          : null;

      const [result] = await db.query(
        "INSERT INTO school_achievements (title, description, media_json, created_by, school_id) VALUES (?, ?, ?, ?, ?)",
        [
          title.trim(),
          (description || "").trim() || null,
          JSON.stringify(media),
          user_id ? parseInt(user_id, 10) || null : null,
          schoolId,
        ],
      );

      let schoolName = "";
      if (schoolId) {
        const [sRows] = await db.query(
          "SELECT name FROM schools WHERE id = ?",
          [schoolId],
        );
        if (sRows.length) schoolName = sRows[0].name || "";
      }

      res.json({
        success: true,
        message: "Achievement added successfully",
        data: {
          id: result.insertId,
          title: title.trim(),
          description: (description || "").trim(),
          schoolId,
          schoolName,
          createdAt: new Date(),
          media: parseAchievementMedia(JSON.stringify(media)),
        },
      });
    } catch (err) {
      console.error("POST ACHIEVEMENT ERROR:", err);
      res.status(500).json({ success: false, message: "Internal Server Error" });
    }
  },
);


; // stripped /api/school-achievements/:id


// 🌍 PUBLIC HOLIDAY PROXY

; // stripped /api/external/holidays


// 📈 GET STUDENT GROWTH ANALYTICS

; // stripped /api/dashboard/growth-stats


// 📄 GENERATE WEEKLY CURRICULUM REPORT CARD (PDF)

; // stripped /api/curriculum/generate-weekly-report


// 🎯 GET UNIQUE FILTERS (MONTH/WEEK) FOR A SCHOOL
app.get("/api/curriculum/report-filters/:schoolId", async (req, res) => {
  try {
    const { schoolId } = req.params;
    const { publishedOnly, user_id } = req.query;

    console.log("[DEBUG] Report Filters:", {
      schoolId,
      publishedOnly,
      user_id,
    });

    const trackingSql = `
      SELECT
        month_year,
        week,
        MIN(created_at) AS start_date,
        MAX(created_at) AS end_date,
        MAX(school_able_to_visibale_status) AS is_published,
        COUNT(*) AS total_lessons
      FROM coach_lesson_tracking
      WHERE school_id = ?
        AND week IS NOT NULL
        AND month_year IS NOT NULL
        ${publishedOnly === "true"
        ? "AND school_able_to_visibale_status = 1"
        : ""
      }
        ${user_id ? "AND user_id = ?" : ""}
      GROUP BY month_year, week
      ORDER BY month_year DESC, week ASC
    `;

    const trackingParams = [schoolId];

    if (user_id) {
      trackingParams.push(user_id);
    }

    const [trackingRows] = await db.query(trackingSql, trackingParams);

    // Also fetch weekly_report_status records for this school
    let statusRows = [];
    try {
      const [sRows] = await db.query(
        `SELECT month_year, week_no, status, published_at, submitted_at, recipient_email
         FROM weekly_report_status
         WHERE school_id = ?`,
        [schoolId],
      );
      statusRows = sRows || [];
    } catch (sErr) {
      console.error("Error fetching weekly_report_status for filters:", sErr);
    }

    // Also fetch audit log email actions as fallback for historical recipient emails
    let auditEmailRows = [];
    try {
      const [aRows] = await db.query(
        `SELECT action, created_at
         FROM audit_logs
         WHERE page = 'Weekly Report'
           AND type = 'EMAIL'
           AND (action LIKE ? OR action LIKE ?)
         ORDER BY id DESC`,
        [`%school #${schoolId}%`, `%${schoolId}%`],
      );
      auditEmailRows = aRows || [];
    } catch (aErr) {
      // Audit logs table might not be available or query might fail, non-fatal
    }

    console.log("[DEBUG] Filters Found:", trackingRows.length);

    const filters = {};
    const week_ranges = {};
    const week_statuses = {};

    trackingRows.forEach((row) => {
      const normalizedMonthYear = normalizeWeeklyReportMonthYear(
        row.month_year,
      );

      const normalizedWeek = normalizeWeeklyReportWeek(row.week);

      if (!normalizedMonthYear || !normalizedWeek) {
        return;
      }

      if (!filters[normalizedMonthYear]) {
        filters[normalizedMonthYear] = [];
      }

      if (!week_ranges[normalizedMonthYear]) {
        week_ranges[normalizedMonthYear] = {};
      }

      if (!week_statuses[normalizedMonthYear]) {
        week_statuses[normalizedMonthYear] = {};
      }

      if (!filters[normalizedMonthYear].includes(normalizedWeek)) {
        filters[normalizedMonthYear].push(normalizedWeek);
      }

      week_ranges[normalizedMonthYear][normalizedWeek] = {
        start_date: row.start_date || null,
        end_date: row.end_date || null,
      };

      // Match status
      const matchingStatus = statusRows.find((s) => {
        const sMonth = normalizeWeeklyReportMonthYear(s.month_year);
        const sWeek = normalizeWeeklyReportWeek(s.week_no);
        return sMonth === normalizedMonthYear && sWeek === normalizedWeek;
      });

      let recipientEmail = matchingStatus?.recipient_email || null;
      let publishedAt = matchingStatus?.published_at || null;
      const isStatusPublished =
        matchingStatus?.status === "published" ||
        !!matchingStatus?.published_at;
      const isTrackingPublished = Number(row.is_published) === 1;
      const isPublished = isStatusPublished || isTrackingPublished;

      if (isPublished && !recipientEmail) {
        for (const al of auditEmailRows) {
          if (
            al.action &&
            (al.action.includes(normalizedMonthYear) ||
              al.action.includes(row.month_year)) &&
            (al.action.includes(normalizedWeek) || al.action.includes(row.week))
          ) {
            const match = al.action.match(/to\s+([^\s(]+@[^\s(]+)/i);
            if (match && match[1]) {
              recipientEmail = match[1];
              if (!publishedAt) publishedAt = al.created_at;
              break;
            }
          }
        }
      }

      week_statuses[normalizedMonthYear][normalizedWeek] = {
        is_published: isPublished,
        published_at: publishedAt || (isPublished ? row.end_date : null),
        recipient_email: recipientEmail,
        status: isPublished ? "published" : matchingStatus?.status || "ongoing",
        total_lessons: Number(row.total_lessons || 0),
      };

      console.log("[WEEK RANGE DEBUG]", {
        school_id: Number(schoolId),
        month_year: normalizedMonthYear,
        week: normalizedWeek,
        start_date: row.start_date || null,
        end_date: row.end_date || null,
        is_published: isPublished,
        recipient_email: recipientEmail,
        source: "coach_lesson_tracking.created_at",
      });
    });

    console.log("[WEEK RANGE RESPONSE]", week_ranges);

    res.json({
      success: true,
      filters,
      week_ranges,
      week_statuses,
    });
  } catch (err) {
    console.error("FETCH FILTERS ERROR:", err);

    res.status(500).json({
      success: false,
      message: "Error fetching report filters",
    });
  }
});

// 🗑️ DELETE WEEK REPORT

; // stripped /api/curriculum/delete-week-report


// 🗑️ DELETE SINGLE TRACKING RECORD (individual lecture row)

; // stripped /api/curriculum/tracking-record/:id


// 🗑️ DELETE SINGLE MARKED LECTURE (attendance row)

; // stripped /api/curriculum/marked-lecture/:id


// ✏️ UPDATE SINGLE TRACKING RECORD (individual lecture row)

; // stripped /api/curriculum/tracking-record/:id


// ✏️ UPDATE SINGLE MARKED LECTURE (attendance row)

; // stripped /api/curriculum/marked-lecture/:id


// ✏️ UPDATE WEEK REPORT METADATA (e.g. rename week number or change month_year)

; // stripped /api/curriculum/edit-week-report


// 📷 ADD EVIDENCE PHOTO TO REPORT

; // stripped /api/curriculum/add-evidence-photo


// 📷 REPLACE EVIDENCE PHOTO IN REPORT
app.post(
  "/api/curriculum/replace-evidence-photo",
  uploadEvidence.single("photo"),
  async (req, res) => {
    try {
      const { old_path } = req.body;
      if (!old_path) {
        return res
          .status(400)
          .json({ success: false, message: "old_path is required" });
      }
      if (!req.file) {
        return res
          .status(400)
          .json({ success: false, message: "No replacement photo uploaded" });
      }

      const newPath = `/uploads/curriculum_evidence/${req.file.filename}`;
      const cleanOldPath = old_path.replace(/^\/uploads\//, "");
      const searchTarget = cleanOldPath.includes("/")
        ? cleanOldPath
        : path.basename(cleanOldPath);

      const [rows] = await db.query(
        "SELECT id, picture, evidence_photo FROM coach_lesson_tracking WHERE evidence_photo LIKE ? OR picture LIKE ?",
        [`%${searchTarget}%`, `%${searchTarget}%`],
      );

      for (const row of rows) {
        let updatedEvidence = row.evidence_photo;
        let updatedPicture = row.picture;

        if (updatedEvidence) {
          const list = updatedEvidence.split(",").map((p) => p.trim());
          const newList = list.map((p) =>
            p.includes(searchTarget) ? newPath : p,
          );
          updatedEvidence = newList.join(",");
        }

        if (updatedPicture) {
          const list = updatedPicture.split(",").map((p) => p.trim());
          const newList = list.map((p) =>
            p.includes(searchTarget) ? newPath : p,
          );
          updatedPicture = newList.join(",");
        }

        await db.query(
          "UPDATE coach_lesson_tracking SET evidence_photo = ?, picture = ? WHERE id = ?",
          [updatedEvidence, updatedPicture, row.id],
        );
      }

      res.json({ success: true, message: "Media replaced successfully" });
    } catch (err) {
      console.error("REPLACE EVIDENCE PHOTO ERROR:", err);
      res.status(500).json({
        success: false,
        message: "Error replacing photo",
        error: err.message,
      });
    }
  },
);

// 🗑️ DELETE EVIDENCE PHOTO FROM REPORT
const deletePhotoHandler = async (req, res) => {
  try {
    const photo_path = req.body?.photo_path || req.query?.photo_path;
    if (!photo_path) {
      return res
        .status(400)
        .json({ success: false, message: "photo_path is required" });
    }

    const cleanPath = photo_path.replace(/^\/uploads\//, "");
    const searchTarget = cleanPath.includes("/")
      ? cleanPath
      : path.basename(cleanPath);

    const [rows] = await db.query(
      "SELECT id, picture, evidence_photo FROM coach_lesson_tracking WHERE evidence_photo LIKE ? OR picture LIKE ?",
      [`%${searchTarget}%`, `%${searchTarget}%`],
    );

    let updatedCount = 0;
    for (const row of rows) {
      let updatedEvidence = row.evidence_photo;
      let updatedPicture = row.picture;

      if (updatedEvidence) {
        const list = updatedEvidence
          .split(",")
          .map((p) => p.trim())
          .filter(Boolean);
        const newList = list.filter(
          (p) => !p.includes(searchTarget) && p !== photo_path,
        );
        updatedEvidence = newList.length ? newList.join(",") : null;
      }

      if (updatedPicture) {
        const list = updatedPicture
          .split(",")
          .map((p) => p.trim())
          .filter(Boolean);
        const newList = list.filter(
          (p) => !p.includes(searchTarget) && p !== photo_path,
        );
        updatedPicture = newList.length ? newList.join(",") : null;
      }

      await db.query(
        "UPDATE coach_lesson_tracking SET evidence_photo = ?, picture = ? WHERE id = ?",
        [updatedEvidence, updatedPicture, row.id],
      );
      updatedCount++;
    }

    res.json({
      success: true,
      message: `Photo deleted successfully from ${updatedCount} record(s)`,
    });
  } catch (err) {
    console.error("DELETE EVIDENCE PHOTO ERROR:", err);
    res.status(500).json({
      success: false,
      message: "Error deleting photo",
      error: err.message,
    });
  }
};


; // stripped /api/curriculum/delete-evidence-photo


; // stripped /api/curriculum/delete-evidence-photo


// 🎯 GET STRUCTURED REPORT DATA (JSON VERSION)

app.get("/api/curriculum/report-data", async (req, res) => {
  try {
    const { school_id, month_year, week_no, publishedOnly, user_id } =
      req.query;
    console.log("[DEBUG] Report Data Request:", {
      school_id,
      month_year,
      week_no,
      publishedOnly,
      user_id,
    });

    const sql = `
       SELECT 
        clt.id as tracking_id, clt.unique_id, clt.lp_no, clt.grade, clt.sport, clt.skill, clt.sub_skill, clt.objective,
        clt.teaching_aids, clt.warm_up, clt.skill_implementation, clt.cool_down,
        clt.summarization, clt.life_skill, clt.picture, clt.evidence_photo,
        clt.school_id, clt.session_type,
        CASE WHEN clt.week LIKE 'Week %' THEN clt.week ELSE CONCAT('Week ', clt.week) END as week_no,
        REPLACE(REPLACE(clt.month_year, '-', ', '), ', ', ',') as month_year,
        clt.divisions,
        clt.status AS lp_status, clt.remark AS lp_remark, clt.created_at AS done_date, clt.user_id as tracked_user_id,
        sch.name as school_name,
        usr.name as coach_name,
        usr.profile_pic as coach_avatar
      FROM coach_lesson_tracking clt
      LEFT JOIN schools sch ON clt.school_id = sch.id
      LEFT JOIN users usr ON clt.user_id = usr.id
      WHERE clt.school_id = ? 
        AND (
          TRIM(clt.week) = TRIM(?) 
          OR TRIM(clt.week) = TRIM(REPLACE(?, 'Week ', ''))
          OR REPLACE(TRIM(clt.week), 'Week ', '') = TRIM(REPLACE(?, 'Week ', ''))
        )
        AND (
          TRIM(clt.month_year) = TRIM(?) 
          OR REPLACE(TRIM(clt.month_year), '-', ',') = TRIM(?)
          OR REPLACE(TRIM(clt.month_year), '-', '') = REPLACE(TRIM(?), ',', '')
        )
        ${publishedOnly === "true" ? "AND clt.school_able_to_visibale_status = 1" : ""}
        ${user_id ? "AND clt.user_id = ?" : ""}
      ORDER BY sport, lp_no ASC
    `;

    const reportParams = [
      school_id,
      week_no,
      week_no,
      week_no,
      month_year,
      month_year,
      month_year,
    ];
    if (user_id) reportParams.push(user_id);
    const [rows] = await db.query(sql, reportParams);
    console.log("[DEBUG] Report Data Rows Found:", rows.length);

    // Normalize month_year so it's always "May,2026" instead of "May-2026"
    const normalizedMonthYear = month_year.replace("-", ",");

    // FETCH MARKED LECTURES exclusively for the "Coach Attendance Summary" master table
    const attendanceSql = `
      SELECT 
        ml.*,
        usr.name as coach_name
      FROM marked_lectures ml
      LEFT JOIN users usr ON ml.coach_id = usr.id
      WHERE ml.school_id = ?
        AND DATE_FORMAT(ml.lecture_date, '%b,%Y') = ?
        AND ml.week_no = ?
        ${user_id ? "AND ml.coach_id = ?" : ""}
      ORDER BY ml.lecture_date DESC, ml.start_time DESC
    `;

    const attendanceParams = [school_id, normalizedMonthYear, week_no];
    if (user_id) attendanceParams.push(user_id);
    console.log(
      "[DEBUG] Executing Attendance Query with params:",
      attendanceParams,
    );
    const [attendanceRows] = await db.query(attendanceSql, attendanceParams);
    console.log("[DEBUG] Attendance Rows Found:", attendanceRows.length);

    const weeklyReportStatus = user_id
      ? await fetchWeeklyReportStatus({
        school_id,
        user_id,
        month_year,
        week_no,
      })
      : null;

    // If BOTH data sources are completely empty, then we have no report data
    if (rows.length === 0 && attendanceRows.length === 0) {
      return res.json({ success: true, report: null });
    }

    // Transform rows into the sport-grouped structure the UI expects
    const isExtraActivity = (row) => {
      const lpNo = String(row.lp_no ?? "").trim();
      const uniqueId = String(row.unique_id ?? "").trim();
      return lpNo === "0" || uniqueId.startsWith("EXTRA-");
    };

    const buildKeyArea = (row) => ({
      tracking_id: row.tracking_id,
      name: row.skill || row.sub_skill || `Module ${row.lp_no}`,
      grade: row.grade,
      divisions: row.divisions,
      remark: row.lp_remark,
      status: row.lp_status,
      done_date: row.done_date,
      observations: [row.objective].filter((v) => v),
      objective: row.objective,
      coach_name: row.coach_name,
      sport: row.sport,
      session_type: row.session_type || null,
      photos: [
        ...(row.picture
          ? String(row.picture)
            .split(",")
            .map((p) => p.trim())
            .filter((p) => p)
            .map((p) => (p.startsWith("/uploads/") ? p : "/uploads/" + p))
          : []),
        ...(row.evidence_photo
          ? String(row.evidence_photo)
            .split(",")
            .map((p) => p.trim())
            .filter((p) => p)
            .map((p) => (p.startsWith("/uploads/") ? p : "/uploads/" + p))
          : []),
      ],
      rating:
        row.lp_status === "Done" || row.lp_status === "Complete"
          ? "EXCELLENT"
          : "IMPROVING",
    });

    const sportsData = {};
    const extraKeyAreas = [];
    const extraGallery = [];

    rows.forEach((row) => {
      const keyArea = buildKeyArea(row);

      if (isExtraActivity(row)) {
        extraKeyAreas.push({ ...keyArea, is_extra: true });
        keyArea.photos.forEach((url) => {
          if (!extraGallery.includes(url)) extraGallery.push(url);
        });
        return;
      }

      const sportName = row.sport || "General";
      if (!sportsData[sportName]) {
        sportsData[sportName] = {
          sport: sportName,
          coach_name: row.coach_name || "Assigned Coach",
          coach_avatar: row.coach_avatar
            ? "/uploads/" + row.coach_avatar
            : "/default-avatar.png",
          coach_role: `${sportName} Coach`,
          coach_experience: "5+ Years",
          is_certified: true,
          sessions_count: 0,
          overall_remark: null,
          overview: `Weekly progression for ${sportName} focus on ${row.skill || "fundamentals"}.`,
          skills: [],
          key_areas: [],
          gallery: [],
          video_thumbnail: null,
        };
        // Handle pictures
        if (row.picture) {
          const pics = String(row.picture)
            .split(",")
            .map((p) => p.trim())
            .filter((p) => p);
          sportsData[sportName].gallery = [
            ...sportsData[sportName].gallery,
            ...pics.map((p) =>
              p.startsWith("/uploads/") ? p : "/uploads/" + p,
            ),
          ];
        }
        if (row.evidence_photo) {
          const pics = String(row.evidence_photo)
            .split(",")
            .map((p) => p.trim())
            .filter((p) => p);
          sportsData[sportName].gallery = [
            ...new Set([
              ...sportsData[sportName].gallery,
              ...pics.map((p) =>
                p.startsWith("/uploads/") ? p : "/uploads/" + p,
              ),
            ]),
          ];
        }
      }

      // Increment session count
      sportsData[sportName].sessions_count++;

      // Capture the first remark as the overall remark for the sport
      if (!sportsData[sportName].overall_remark && row.lp_remark) {
        sportsData[sportName].overall_remark = row.lp_remark;
      }

      // Add skills if unique
      if (row.skill && !sportsData[sportName].skills.includes(row.skill)) {
        sportsData[sportName].skills.push(row.skill);
      }

      // Merge gallery images (handle comma separated strings)
      if (row.picture) {
        const pics = String(row.picture)
          .split(",")
          .map((p) => p.trim())
          .filter((p) => p);
        pics.forEach((p) => {
          const url = "/uploads/" + p;
          if (!sportsData[sportName].gallery.includes(url)) {
            sportsData[sportName].gallery.push(url);
          }
        });
      }
      if (row.evidence_photo) {
        const pics = String(row.evidence_photo)
          .split(",")
          .map((p) => p.trim())
          .filter((p) => p);
        pics.forEach((p) => {
          const url = p.startsWith("/uploads/") ? p : "/uploads/" + p;
          if (!sportsData[sportName].gallery.includes(url)) {
            sportsData[sportName].gallery.push(url);
          }
        });
      }

      // Add key areas from the lesson plan objective/remark
      sportsData[sportName].key_areas.push(keyArea);
    });

    const sportsReports = Object.values(sportsData);
    if (extraKeyAreas.length > 0) {
      sportsReports.push({
        sport: "Extra Covered",
        isExtraCard: true,
        coach_name: extraKeyAreas[0].coach_name || "Assigned Coach",
        coach_avatar: "/default-avatar.png",
        coach_role: "Extra Activities",
        coach_experience: "5+ Years",
        is_certified: true,
        sessions_count: extraKeyAreas.length,
        overall_remark: null,
        overview:
          "Additional activities covered outside the standard lesson plan this week.",
        skills: [
          ...new Set(extraKeyAreas.map((area) => area.name).filter(Boolean)),
        ],
        key_areas: extraKeyAreas,
        gallery: extraGallery,
        video_thumbnail: null,
      });
    }

    // (attendanceRows already fetched at the top of the function to prevent early exit)

    // Format allSessions for the master table (match WeeklyReportPage field names)
    const allSessions = attendanceRows.map((row) => ({
      id: row.id,
      coach: row.coach_name,
      coach_name: row.coach_name,
      sport: row.sport,
      grade: row.grades,
      grades: row.grades,
      divisions: row.division,
      division: row.division,
      skill: "Manual Entry",
      objective: "Regular Session",
      status: row.status || "Completed",
      date: row.lecture_date,
      lecture_date: row.lecture_date,
      start_time: row.start_time,
      end_time: row.end_time,
      remark: "Marked via Lecture Manager",
    }));

    // Calculate totals for a summary dashboard based on ALL SESSION data
    const coachStats = {};
    allSessions.forEach((row) => {
      const coach = row.coach || "Assigned Coach";
      if (!coachStats[coach])
        coachStats[coach] = { name: coach, total: 0, sports: new Set() };
      coachStats[coach].total++;
      if (row.sport) coachStats[coach].sports.add(row.sport);
    });

    const summary = Object.values(coachStats).map((c) => ({
      coach: c.name,
      total_lectures: c.total,
      sports: Array.from(c.sports).join(", "),
    }));

    res.json({
      success: true,
      report: {
        school_name: rows[0]?.school_name || "N/A",
        month_year,
        week_no,
        started_at: weeklyReportStatus?.started_at || null,
        submitted_at: weeklyReportStatus?.submitted_at || null,
        published_at: weeklyReportStatus?.published_at || null,
        weekly_report_status: weeklyReportStatus?.status || null,
        recipient_email: weeklyReportStatus?.recipient_email || null,
        is_published:
          !!weeklyReportStatus?.published_at ||
          rows.some((r) => r.school_able_to_visibale_status == 1),
        total_sessions: allSessions.length,
        summary: summary,
        all_sessions: allSessions,
        sports_reports: sportsReports,
      },
    });
  } catch (err) {
    console.error("FETCH REPORT DATA ERROR:", err);
    res.status(500).json({
      success: false,
      message: "Server error fetching report details",
    });
  }
});

// ==========================================
// NEW API: FETCH ALL ATTENDANCE FOR A SCHOOL
// ==========================================

; // stripped /api/curriculum/school-attendance/:school_id



; // stripped /api/curriculum/submit-report


// 🚀 PUBLISH WEEKLY REPORT (Make visible to Principal)
app.post("/api/curriculum/publish-report", async (req, res) => {
  try {
    const { school_id, user_id, month_year, week_no, email } = req.body;

    if (!school_id || !user_id || !month_year || !week_no) {
      return res
        .status(400)
        .json({ success: false, message: "Missing required parameters" });
    }

    // Auto-submit the report first if it hasn't been submitted yet,
    // so that the user doesn't need a separate "Submit" step before publishing.
    const existingWeeklyStatus = await fetchWeeklyReportStatus({
      school_id,
      user_id,
      month_year,
      week_no,
    });

    if (!existingWeeklyStatus?.submitted_at) {
      await markWeeklyReportSubmitted({
        school_id,
        user_id,
        month_year,
        week_no,
      });
    }

    const sql1 = `
      UPDATE year_lp_master_new 
      SET school_able_to_visibale_status = 1 
      WHERE school_id = ? 
        AND CASE WHEN week LIKE 'Week %' THEN week ELSE CONCAT('Week ', week) END = ? 
        AND REPLACE(REPLACE(month_year, '-', ', '), ', ', ',') = ?
    `;

    const sql2 = `
      UPDATE coach_lesson_tracking 
      SET school_able_to_visibale_status = 1 
      WHERE school_id = ? 
        AND CASE WHEN week LIKE 'Week %' THEN week ELSE CONCAT('Week ', week) END = ? 
        AND REPLACE(REPLACE(month_year, '-', ', '), ', ', ',') = ?
    `;

    const [result1] = await db.query(sql1, [school_id, week_no, month_year]);
    const [result2] = await db.query(sql2, [school_id, week_no, month_year]);
    const weeklyReportStatus = await markWeeklyReportPublished({
      school_id,
      user_id,
      month_year,
      week_no,
      recipient_email: email && email.trim() ? email.trim() : null,
    });

    // Send email alert if email address is provided
    let emailSent = false;
    let currEmail = "";
    if (email && email.trim()) {
      try {
        const nodemailer = require("nodemailer");
        const transporter = nodemailer.createTransport({
          host: process.env.MAIL_HOST || "smtp.gmail.com",
          port: process.env.MAIL_PORT || 587,
          secure: false,
          auth: {
            user: process.env.MAIL_USER,
            pass: process.env.MAIL_PASS,
          },
        });

        const schoolName = req.body.school_name || "School";
        const viewLink = `http://localhost:5173/curriculum/weekly-report?school_id=${school_id}&month_year=${encodeURIComponent(month_year)}&week_no=${encodeURIComponent(week_no)}`;

        // Store the exact report-card PDF (sent from the page) and email a link to it
        let reportPdfUrl = "";
        if (req.body.pdf_base64) {
          try {
            const dir = path.join(__dirname, "uploads", "weekly_reports");
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            const safeMonth = String(month_year).replace(/[^a-zA-Z0-9]+/g, "_");
            const safeWeek = String(week_no).replace(/[^a-zA-Z0-9]+/g, "_");
            const fname = `Weekly_Report_${school_id}_${safeMonth}_${safeWeek}.pdf`;
            fs.writeFileSync(
              path.join(dir, fname),
              Buffer.from(req.body.pdf_base64, "base64"),
            );
            const frontendBase =
              process.env.FRONTEND_URL || "http://localhost:5173";
            reportPdfUrl = `${frontendBase}/api/curriculum/report-pdf?school_id=${school_id}&month_year=${encodeURIComponent(month_year)}&week_no=${encodeURIComponent(week_no)}`;
          } catch (pdfSaveErr) {
            console.error("Failed to save weekly report PDF:", pdfSaveErr);
          }
        }

        const downloadLink = reportPdfUrl || req.body.pdf_link || viewLink;
        const pdfFilename = `Weekly_Report_${schoolName.replace(/\s+/g, "_")}_${week_no}.pdf`;

        // 1) Get the logged-in curriculum user's name and email
        let currName = "";
        try {
          const [[currUser]] = await db.query(
            "SELECT name, email FROM users WHERE id = ? AND email IS NOT NULL AND email != ''",
            [user_id],
          );
          if (currUser) {
            currName = currUser.name || "";
            currEmail = currUser.email || "";
          }
        } catch (e) {
          console.error("Failed to lookup curr user email:", e);
        }

        // 2) Get the latest assigned SSGM name and email for this school
        let ssgmName = "";
        let ssgmEmail = "";
        try {
          const [ssgmRows] = await db.query(
            `SELECT u.name, u.email
             FROM assign_school a
             JOIN users u ON a.ssgm_id = u.id
             WHERE a.school_id = ?
               AND u.email IS NOT NULL AND u.email != ''
             ORDER BY a.id DESC
             LIMIT 1`,
            [school_id],
          );
          if (ssgmRows.length > 0) {
            ssgmName = ssgmRows[0].name || "";
            ssgmEmail = ssgmRows[0].email || "";
          }
        } catch (e) {
          console.error("Failed to lookup SSGM email:", e);
        }

        // Resolve SSGM credentials for sender (reuse SSGM Pre Weekly Planner credential system)
        const { resolveSsgmCredentials } = require('../ssgmCredentialService');
        const ssgmCreds = await resolveSsgmCredentials(school_id);

        let emailTransporter = transporter;
        let senderEmail = process.env.MAIL_FROM || "info@marcosquay.com";

        if (ssgmCreds && ssgmCreds.email && ssgmCreds.password) {
          emailTransporter = nodemailer.createTransport({
            host: process.env.MAIL_HOST || "smtp.gmail.com",
            port: process.env.MAIL_PORT || 587,
            secure: false,
            auth: {
              user: ssgmCreds.email,
              pass: ssgmCreds.password,
            },
          });
          senderEmail = ssgmCreds.email;
          console.log(
            `🔑 School #${school_id} (${schoolName}): using SSGM credentials — sender <${ssgmCreds.email}>`,
          );
        } else {
          console.log(
            `🔑 School #${school_id} (${schoolName}): no SSGM credentials — falling back to .env sender <${process.env.MAIL_FROM || "info@marcosquay.com"}>`,
          );
        }

        // Email to Principal + CC the curr user (original content)
        const principalMailOptions = {
          from: `"Marcos Quay Curriculum" <${senderEmail}>`,
          to: email.trim(),
          cc: currEmail || undefined,
          subject: `Weekly Performance Report: ${schoolName} - ${month_year} (${week_no})`,
          html: `
<div style="margin:0; padding:0; background:#f4f6f8; font-family:Arial, Helvetica, sans-serif; color:#263238;">

  <div style="max-width:680px; margin:0 auto; padding:32px 16px;">

    <!-- Main Card -->
    <div style="background:#ffffff; border:1px solid #e5e9ed; border-radius:12px; overflow:hidden;">

      <!-- Header -->
      <div style="padding:28px 32px; border-bottom:1px solid #edf0f2;">

        <div style="font-size:13px; font-weight:bold; letter-spacing:1.2px; color:#005daa; text-transform:uppercase; margin-bottom:8px;">
          Weekly Performance Report
        </div>

        <div style="font-size:24px; font-weight:600; color:#17212b; line-height:1.3;">
          ${schoolName}
        </div>

        <div style="font-size:14px; color:#71808c; margin-top:6px;">
          ${month_year} · ${week_no}
        </div>

      </div>


      <!-- Content -->
      <div style="padding:30px 32px;">

        <p style="margin:0 0 18px; font-size:15px; line-height:1.7; color:#37474f;">
          Dear Sir/Madam,
        </p>

        <p style="margin:0 0 18px; font-size:15px; line-height:1.7; color:#37474f;">
          Greetings from <strong style="color:#17212b;">Marcos Quay</strong>.
        </p>

        <p style="margin:0 0 20px; font-size:15px; line-height:1.7; color:#37474f;">
          We are pleased to share the <strong style="color:#17212b;">Weekly Performance Report</strong>
          for <strong style="color:#005daa;">${schoolName}</strong>.
        </p>

        <p style="margin:0 0 24px; font-size:15px; line-height:1.7; color:#37474f;">
          The report provides an overview of the coaching activities, lessons conducted,
          and progress achieved by our coaches during the week. It is intended to keep
          you informed about the sports activities conducted at your school.
        </p>


        <!-- Report Information -->
        <div style="background:#f7f9fb; border:1px solid #e8edf1; border-radius:8px; padding:18px 20px; margin-bottom:26px;">

          <div style="font-size:12px; font-weight:bold; color:#7a8791; text-transform:uppercase; letter-spacing:.7px; margin-bottom:8px;">
            Report Details
          </div>

          <div style="font-size:14px; color:#263238; line-height:1.8;">
            <strong>School:</strong> ${schoolName}<br>
            <strong>Period:</strong> ${month_year} - ${week_no}
          </div>

        </div>


        <p style="margin:0 0 20px; font-size:14px; line-height:1.6; color:#54636d;">
          Please review the complete report using the secure link below.
        </p>


        <!-- Professional CTA -->
        <div style="margin:0 0 28px;">

          <a href="${downloadLink}"
             style="
               display:inline-block;
               background:#005daa;
               color:#ffffff;
               padding:13px 22px;
               border-radius:6px;
               text-decoration:none;
               font-size:14px;
               font-weight:bold;
               letter-spacing:.1px;
             ">
             View Weekly Report &nbsp;→
          </a>

        </div>


        <div style="height:1px; background:#edf0f2; margin:0 0 22px;"></div>


        <p style="margin:0 0 20px; font-size:14px; line-height:1.7; color:#54636d;">
          Thank you for your continued support and cooperation.
        </p>

        <p style="margin:0; font-size:14px; line-height:1.7; color:#37474f;">
          Best Regards,<br>
          <strong style="color:#17212b;">Marcos Quay Sports Foundation</strong>
        </p>

      </div>


      <!-- Footer -->
      <div style="background:#fafbfc; border-top:1px solid #edf0f2; padding:18px 32px;">

        <div style="font-size:11px; line-height:1.6; color:#8a969f;">
          This is an automated weekly performance report from Marcos Quay Sports Foundation.
          Please do not reply directly to this email.
        </div>

      </div>

    </div>

  </div>

</div>
`,
        };

        const principalInfo =
          await emailTransporter.sendMail(principalMailOptions);
        emailSent = true;
        console.log(
          `✅ Principal email sent to ${email.trim()}${currEmail ? " (CC: " + currEmail + ")" : ""} (PDF: ${!!req.body.pdf_base64}):`,
          principalInfo.messageId,
        );

        // Separate email to SSGM with customized content
        if (ssgmEmail) {
          const ssgmMailOptions = {
            from: `"Marcos Quay Curriculum" <${senderEmail}>`,
            to: ssgmEmail,
            subject: `Weekly Performance Report: ${schoolName} - ${month_year} (${week_no})`,
            html: `
<div style="font-family: Arial, sans-serif; font-size: 14px; color: #333; line-height: 1.7;">

  <p>Hello ${ssgmName},</p>

  <p>
    This week report card is public — <strong>${currName}</strong> (${currEmail}) has published the weekly performance report for <strong>${schoolName}</strong> (${month_year} - ${week_no}).
  </p>

  <p>
    Please review the report via the link below.
  </p>

  <p>
    <a href="${downloadLink}" style="display:inline-block; background:#005daa; color:#ffffff; padding:12px 24px; border-radius:8px; text-decoration:none; font-weight:bold;">
      View / Download Weekly Performance Report
    </a>
  </p>

  <p>
    Best Regards,<br>
    <strong>Marcos Quay Sports Foundation</strong>
  </p>

</div>
`,
          };

          const ssgmInfo = await emailTransporter.sendMail(ssgmMailOptions);
          console.log(
            `✅ SSGM email sent to ${ssgmEmail} (PDF: ${!!req.body.pdf_base64}):`,
            ssgmInfo.messageId,
          );
        }
      } catch (mailErr) {
        console.error("❌ SEND WEEKLY REPORT EMAIL ERROR:", mailErr);
      }
    }

    await auditAction(req, () => ({
      page: "Weekly Report",
      type: "UPDATE",
      action: `Published weekly report for ${req.body.school_name || "school #" + school_id} (${month_year} - ${week_no}, ${result2.changedRows} tracking record(s) made visible to school, user #${user_id})`,
    }));

    if (emailSent) {
      await auditAction(req, () => ({
        page: "Weekly Report",
        type: "EMAIL",
        action: `Sent published weekly report email for ${req.body.school_name || "school #" + school_id} (${month_year} - ${week_no}) to ${email.trim()}${currEmail ? " (CC: " + currEmail + ")" : ""}`,
      }));
    }

    res.json({
      success: true,
      message: `Report published successfully! ${result2.changedRows} tracking records updated.`,
      updatedRows: result2.changedRows,
      started_at: weeklyReportStatus?.started_at || null,
      submitted_at: weeklyReportStatus?.submitted_at || null,
      published_at: weeklyReportStatus?.published_at || null,
      status: weeklyReportStatus?.status || "published",
    });
  } catch (err) {
    console.error("PUBLISH REPORT ERROR:", err);
    res.status(500).json({
      success: false,
      message: "Internal server error while publishing",
    });
  }
});

// 📄 Build the weekly curriculum report card PDF on demand from the DB.
// Self-contained version used as a fallback when no stored PDF file exists.
// Pulls directly from coach_lesson_tracking (the tracked sessions = the report
// content that was emailed), avoiding the slow schedule-table correlated join.
const buildWeeklyReportCardPdf = async ({ school_id, week_no, month_year }) => {
  const sql = `
    SELECT clt.lp_no, clt.grade, clt.sport, clt.skill, clt.sub_skill, clt.objective,
           clt.status AS lp_status, clt.remark AS lp_remark,
           sch.name as school_name,
           usr.name as coach_full_name
    FROM coach_lesson_tracking clt
    LEFT JOIN schools sch ON clt.school_id = sch.id
    LEFT JOIN users usr ON clt.user_id = usr.id
    WHERE clt.school_id = ?
      AND (
        TRIM(clt.week) = TRIM(?)
        OR TRIM(clt.week) = TRIM(REPLACE(?, 'Week ', ''))
        OR REPLACE(TRIM(clt.week), 'Week ', '') = TRIM(REPLACE(?, 'Week ', ''))
      )
      AND (
        REPLACE(REPLACE(TRIM(clt.month_year), '-', ', '), ', ', ',') = REPLACE(REPLACE(TRIM(?), '-', ', '), ', ', ',')
        OR REPLACE(TRIM(clt.month_year), ' ', '') = REPLACE(TRIM(?), ' ', '')
      )
    ORDER BY clt.lp_no ASC
  `;

  const [rows] = await db.query(sql, [
    school_id,
    week_no,
    week_no,
    week_no,
    month_year,
    month_year,
  ]);

  if (rows.length === 0) {
    throw new Error("No assignments found for this period");
  }

  const schoolName = rows[0].school_name || "N/A";

  const pdfDoc = await PDFDocument.create();
  let page = pdfDoc.addPage(PageSizes.A4);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const fontReg = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const { width, height } = page.getSize();

  let y = height - 50;

  page.drawRectangle({
    x: 40,
    y: y - 10,
    width: width - 80,
    height: 40,
    color: rgb(0, 0.36, 0.67),
  });
  page.drawText("WEEKLY CURRICULUM REPORT CARD", {
    x: 60,
    y: y + 5,
    size: 16,
    font: fontBold,
    color: rgb(1, 1, 1),
  });
  y -= 50;

  page.drawText(`School: ${schoolName}`, {
    x: 40,
    y,
    size: 12,
    font: fontBold,
  });
  page.drawText(`Period: ${month_year} - ${week_no}`, {
    x: width - 200,
    y,
    size: 10,
    font: fontReg,
  });
  y -= 30;

  const cols = [
    { label: "SR", x: 40, w: 30 },
    { label: "PLAN", x: 70, w: 120 },
    { label: "OBJECTIVE", x: 190, w: 220 },
    { label: "STATUS", x: 410, w: 60 },
    { label: "REMARK", x: 470, w: 85 },
  ];

  page.drawRectangle({
    x: 40,
    y: y - 5,
    width: width - 80,
    height: 20,
    color: rgb(0.9, 0.9, 0.9),
  });
  cols.forEach((c) => {
    page.drawText(c.label, { x: c.x + 5, y, size: 9, font: fontBold });
  });
  y -= 25;

  const rowHeight = 35;
  for (const [idx, row] of rows.entries()) {
    if (y < 80) {
      page = pdfDoc.addPage(PageSizes.A4);
      y = height - 50;
    }

    const sr = (idx + 1).toString().padStart(2, "0");
    const planInfo = `${row.sport} (${row.skill || ""})`.substring(0, 25);
    const objective = (row.objective || "").substring(0, 80);
    const status = row.lp_status || "Unmarked";
    const remark = (row.lp_remark || "").substring(0, 20);

    page.drawText(sr, { x: cols[0].x + 5, y, size: 9, font: fontReg });
    page.drawText(planInfo, { x: cols[1].x + 5, y, size: 9, font: fontBold });
    page.drawText(objective, { x: cols[2].x + 5, y, size: 7, font: fontReg });
    page.drawText(status, {
      x: cols[3].x + 5,
      y,
      size: 8,
      font: fontBold,
      color: status === "Done" ? rgb(0, 0.5, 0) : rgb(0.5, 0, 0),
    });
    page.drawText(remark, { x: cols[4].x + 5, y, size: 8, font: fontReg });

    page.drawLine({
      start: { x: 40, y: y - 10 },
      end: { x: width - 40, y: y - 10 },
      thickness: 0.5,
      color: rgb(0.8, 0.8, 0.8),
    });
    y -= rowHeight;
  }

  page.drawText("Generated by MQ-Portal Curriculum Engine", {
    x: 40,
    y: 30,
    size: 8,
    font: fontReg,
    color: rgb(0.6, 0.6, 0.6),
  });

  const pdfBytes = await pdfDoc.save();
  return Buffer.from(pdfBytes);
};

// 📄 SERVE STORED WEEKLY REPORT PDF (generates on demand when no file exists)

; // stripped /api/curriculum/report-pdf


// 📧 PREVIEW THE WEEKLY REPORT EMAIL EXACTLY AS IT WAS SENT (content + buttons)

; // stripped /api/curriculum/report-email-view


// 📊 GET PUBLISHED REPORTS STATUS BY SCHOOL AND MONTH

; // stripped /api/curriculum/publish-status


// 📊 REPORT CARD TRACKING (SSGM) — dedicated endpoint, does not touch publish-status
// Status for the selected week per school is derived exactly like the Weekly Report
// page's per-school week status (published when the weekly report was sent to principal).
app.get("/api/report-card-tracking", async (req, res) => {
  try {
    const { user_id, month_year, week_no } = req.query;

    // 1. Determine the school scope (SSGM sees their assigned schools only)
    let scopedSchoolIds = null;
    if (user_id) {
      const [[user]] = await db.query(
        "SELECT role_id FROM users WHERE id = ?",
        [user_id],
      );
      if (
        user &&
        user.role_id !== 1 &&
        user.role_id !== 7 &&
        user.role_id !== 2
      ) {
        const [assignments] = await db.query(
          "SELECT school_id FROM assign_school WHERE user_id = ? OR ssgm_id = ?",
          [user_id, user_id],
        );
        if (assignments.length > 0) {
          scopedSchoolIds = assignments.map((a) => a.school_id);
        } else {
          return res.json({ success: true, statuses: [] });
        }
      }
    }

    const scope = scopedSchoolIds
      ? `AND id IN (${scopedSchoolIds.join(",")})`
      : "";

    // 2. All active schools in scope
    const [schoolRows] = await db.query(
      `SELECT id, school_code, name, city, state FROM schools WHERE is_active = 1 ${scope}`,
    );

    const normalizedTargetWeek = normalizeWeeklyReportWeek(week_no);
    const normalizedTargetMonth = normalizeWeeklyReportMonthYear(month_year);

    // 3. Weekly report lifecycle rows for the scope (matching month + week when given)
    let statusSql = `
      SELECT w.school_id, w.month_year, w.week_no, w.status,
             w.started_at, w.submitted_at, w.published_at,
             w.recipient_email,
             u.name AS user_name, u.email AS user_email
      FROM weekly_report_status w
      LEFT JOIN users u ON w.user_id = u.id
      WHERE 1=1 ${scopedSchoolIds ? `AND w.school_id IN (${scopedSchoolIds.join(",")})` : ""}
    `;
    const statusParams = [];
    if (normalizedTargetMonth) {
      statusSql += ` AND REPLACE(REPLACE(w.month_year, '-', ', '), ', ', ',') = REPLACE(REPLACE(?, '-', ', '), ', ', ',')`;
      statusParams.push(month_year);
    }
    if (normalizedTargetWeek) {
      statusSql += ` AND ? = REPLACE(REPLACE(w.week_no, 'Week ', ''), 'week ', '')`;
      statusParams.push(
        String(week_no)
          .trim()
          .replace(/^Week\s*/i, ""),
      );
    }
    const [statusRows] = await db.query(statusSql, statusParams);

    // 3a. Recipient email fallback
    let auditEmailRows = [];

    // 3b. Published flag from coach_lesson_tracking for the matching week (same as report-filters)
    let trackingRows = [];
    if (
      schoolRows.length > 0 &&
      normalizedTargetWeek &&
      normalizedTargetMonth
    ) {
      const schoolPlaceholders = schoolRows.map(() => "?").join(",");
      const [tRows] = await db.query(
        `
        SELECT school_id,
               MAX(school_able_to_visibale_status) AS is_published,
               MIN(created_at) AS start_date,
               MAX(created_at) AS end_date
        FROM coach_lesson_tracking
        WHERE school_id IN (${schoolPlaceholders})
          AND REPLACE(REPLACE(month_year, '-', ', '), ', ', ',') = REPLACE(REPLACE(?, '-', ', '), ', ', ',')
          AND REPLACE(REPLACE(week, 'Week ', ''), 'week ', '') = ?
        GROUP BY school_id
      `,
        [
          ...schoolRows.map((s) => s.id),
          month_year,
          String(week_no)
            .trim()
            .replace(/^Week\s*/i, ""),
        ],
      );
      trackingRows = tRows || [];
    }
    const trackingBySchool = new Map();
    for (const t of trackingRows) {
      trackingBySchool.set(t.school_id, t);
    }

    // 3c. Head Coach / Coach assignments for the in-scope schools
    const headCoachBySchool = new Map();
    if (schoolRows.length > 0) {
      const schoolPlaceholders = schoolRows.map(() => "?").join(",");
      const [headCoachRows] = await db.query(
        `
        SELECT ash.school_id, u.id AS user_id, u.name, u.email, u.role_id
        FROM assign_school ash
        JOIN users u ON ash.user_id = u.id
        WHERE u.role_id IN (4, 5)
          AND ash.school_id IN (${schoolPlaceholders})
        ORDER BY u.role_id, u.name
      `,
        schoolRows.map((s) => s.id),
      );
      for (const row of headCoachRows) {
        if (!headCoachBySchool.has(row.school_id)) {
          headCoachBySchool.set(row.school_id, row);
        }
      }
    }

    // 3d. Reduce statusRows to one best row per school (prefer published over
    //     submitted/started; prefer a published row that carries a recipient email).
    const statusRank = (r) =>
      r.status === "published" || !!r.published_at
        ? 3
        : r.status === "submitted"
          ? 2
          : 1;
    const statusBySchool = new Map();
    for (const r of statusRows) {
      const cur = statusBySchool.get(r.school_id);
      const rankR = statusRank(r);
      const rankCur = cur ? statusRank(cur) : 0;
      if (
        !cur ||
        rankR > rankCur ||
        (rankR === rankCur && !!r.recipient_email && !cur.recipient_email)
      ) {
        statusBySchool.set(r.school_id, r);
      }
    }

    // 4. Map into one row per school matching the Weekly Report page statuses:
    //    completed  = report sent to Principal (published)
    //    not_public = not sent to Principal
    const statuses = schoolRows.map((s) => {
      const headCoach = headCoachBySchool.get(s.id);
      const weekStatus = statusBySchool.get(s.id);
      const tracking = trackingBySchool.get(s.id);

      const isStatusPublished =
        weekStatus?.status === "published" || !!weekStatus?.published_at;
      const isTrackingPublished = Number(tracking?.is_published || 0) === 1;
      const isPublished = isStatusPublished || isTrackingPublished;

      let rawStatus = "not_public";
      if (isPublished) {
        rawStatus = "completed";
      } else if (
        weekStatus?.status === "submitted" ||
        weekStatus?.status === "started" ||
        weekStatus?.started_at
      ) {
        rawStatus = "pending";
      }

      // Email entered at publish time: prefer weekly_report_status.recipient_email,
      // fall back to the audit-log EMAIL action for the matching school + month + week.
      let recipientEmail = weekStatus?.recipient_email || null;
      if (isPublished && !recipientEmail) {
        const auditWeekNum = String(week_no)
          .trim()
          .replace(/^Week\s*/i, "");
        const auditWeekLabel = `Week ${auditWeekNum}`;
        for (const al of auditEmailRows) {
          if (
            al.action &&
            (al.action.includes(normalizedTargetMonth) ||
              al.action.includes(month_year)) &&
            (al.action.includes(auditWeekLabel) ||
              al.action.includes(auditWeekNum))
          ) {
            const match = al.action.match(/to\s+([^\s(]+@[^\s(]+)/i);
            if (match && match[1]) {
              recipientEmail = match[1];
              break;
            }
          }
        }
      }

      return {
        school_id: s.id,
        school_code: s.school_code,
        school_name: s.name,
        city: s.city,
        state: s.state,
        status: rawStatus,
        week_no: normalizedTargetWeek,
        user_name: weekStatus ? weekStatus.user_name || "—" : null,
        user_email: weekStatus ? weekStatus.user_email || "—" : null,
        recipient_email: recipientEmail,
        head_coach_name: headCoach ? headCoach.name : null,
        head_coach_email: headCoach ? headCoach.email : null,
        started_at: weekStatus ? weekStatus.started_at : null,
        submitted_at: weekStatus ? weekStatus.submitted_at : null,
        published_at: weekStatus ? weekStatus.published_at : null,
      };
    });

    res.json({ success: true, statuses });
  } catch (err) {
    console.error("REPORT CARD TRACKING ERROR:", err);
    res.status(500).json({
      success: false,
      message: "Server error fetching report card tracking",
    });
  }
});

// 📋 GET ASSIGNED LP SUMMARY GROUPED BY MONTH/WEEK (Modernized for assigned_lesson_plans)
app.get("/api/curriculum/my-lp-summary/:userId", async (req, res) => {
  try {
    const { userId } = req.params;

    const [[user]] = await db.query("SELECT role_id FROM users WHERE id = ?", [
      userId,
    ]);
    const isAdmin = user && user.role_id < 4;

    const sql = `
      SELECT * FROM (
        -- Modern Assignments
        SELECT 
          alp.id, alp.lp_no as lp_id, alp.lp_unique_id, alp.week as week_no, 
          alp.month_year, alp.school_id, alp.created_at as assign_date,
          alp.sport, alp.skill, alp.sub_skill, alp.objective, alp.grade,
          sch.name as school_name,
          ls.status AS lp_status, ls.remark AS lp_remark,
          alp.assigned_to as coach_id, u.name as coach_name, 
          alp.assigned_by, 'New' as source,
          alp.warm_up, alp.skill_implementation, alp.cool_down, 
          alp.teaching_aids, alp.summarization, alp.life_skill
        FROM assigned_lesson_plans alp
        LEFT JOIN schools sch ON alp.school_id = sch.id
        LEFT JOIN users u ON alp.assigned_to = u.id
        LEFT JOIN lp_status ls ON ls.lp_unique_id = alp.lp_unique_id AND ls.user_id = alp.assigned_to
        
        UNION ALL

        -- Legacy Assignments
        SELECT 
          la.id, la.lp_id, la.lp_unique_id, CONCAT('Week ', la.week_no) as week_no,
          DATE_FORMAT(la.assign_date, '%b, %Y') as month_year, la.school_id, la.assign_date,
          lp.sport, lp.skill, lp.sub_skill, lp.objective, la.grade,
          sch.name as school_name,
          ls.status AS lp_status, ls.remark AS lp_remark,
          la.user_id as coach_id, u.name as coach_name, 
          la.assign_by as assigned_by, 'Legacy' as source,
          lp.warm_up, lp.skill_implementation, lp.cool_down, 
          lp.teaching_aids, lp.summarization, lp.life_skill
        FROM lp_assign la
        JOIN year_lp_master lp ON la.lp_id = lp.lp_no
        LEFT JOIN schools sch ON la.school_id = sch.id
        LEFT JOIN users u ON la.user_id = u.id
        LEFT JOIN lp_status ls ON ls.lp_unique_id = la.lp_unique_id AND ls.user_id = la.user_id
        WHERE la.lp_id != 0
      ) unified
      WHERE coach_id = ? OR assigned_by = ?
      ORDER BY assign_date DESC
    `;

    const [rows] = await db.query(sql, [userId, userId]);

    const grouped = {}; // month_key -> week_key -> { school, week, items[] }
    const schoolMap = new Map(); // id -> name (to build unique school list)

    for (const row of rows) {
      if (row.school_id) {
        schoolMap.set(row.school_id, row.school_name || "No School Assigned");
      }

      // Month key from month_year (e.g., "Apr,2026")
      const monthKey = row.month_year || "Unknown Month";
      // Week key unique per school and week in that month
      const schoolId = row.school_id || "no-school";
      const weekKey = `${schoolId}_${row.week_no}_${monthKey}`;

      if (!grouped[monthKey]) grouped[monthKey] = {};
      if (!grouped[monthKey][weekKey]) {
        grouped[monthKey][weekKey] = {
          school_id: row.school_id,
          school_name: row.school_name || "No School Assigned",
          week_no: row.week_no, // e.g., "Week1"
          assign_date: row.assign_date,
          items: [],
        };
      }
      grouped[monthKey][weekKey].items.push(row);
    }

    const schools = Array.from(schoolMap.entries()).map(([id, name]) => ({
      school_id: id,
      school_name: name,
    }));

    // Sort months (approximate by string or timestamp)
    res.json({ success: true, grouped, schools, totalCount: rows.length });
  } catch (err) {
    console.error("MY LP SUMMARY ERROR:", err);
    res
      .status(500)
      .json({ success: false, message: "Error fetching LP summary" });
  }
});

// 🗑️ DELETE A SPECIFIC INDIVIDUAL ASSIGNMENT

; // stripped /api/curriculum/assigned-plans/:id


// 🗑️ DELETE ASSIGNMENT

; // stripped /api/curriculum/assignments/:id


// 🏆 IMPORT EXCEL CURRICULUM

; // stripped /api/curriculum/import


// 🏆 IMPORT SDP CURRICULUM

; // stripped /api/curriculum/sdp/import


// 🏆 IMPORT MSFC CURRICULUM

; // stripped /api/curriculum/msfc/import


// 🛡️ USER PAGE ACCESS API

// Get users that can be managed (e.g. coaches, principals, SSGM)

; // stripped /api/access/users


// Get granted permissions for a specific user

; // stripped /api/access/permissions/:userId


// Save permissions for a specific user

; // stripped /api/access/permissions/save


// 🛡️ GET role-based permissions for a specific role

; // stripped /api/access/role-permissions/:roleId


// 🛡️ SAVE role-based permissions

; // stripped /api/access/role-permissions/save


// 🛡️ GET effective permissions for a user (combines user + role-level access)

; // stripped /api/access/effective-permissions/:userId


// ==========================================
// HIERARCHICAL TICKETING & ESCALATION SYSTEM
// ==========================================

// Get all Roles (for Escalation Rule dropdowns)

; // stripped /api/roles


// Get Escalation Rules

; // stripped /api/tickets/rules


// Update Escalation Rules

; // stripped /api/tickets/rules


// Helper: Process Ticket Escalations
async function processEscalations() {
  try {
    const [tickets] = await db.query(
      "SELECT * FROM complaints WHERE status = 'pending'",
    );
    const [rules] = await db.query(
      "SELECT * FROM ticket_escalation_rules ORDER BY tier_level ASC",
    );
    if (rules.length === 0) return;

    const maxTier = rules[rules.length - 1].tier_level;

    for (const ticket of tickets) {
      const currentTier = ticket.current_tier || 1;

      const lastEscalated = new Date(
        ticket.last_escalated_at || ticket.created_at,
      ).getTime();
      const now = Date.now();
      const hoursElapsed = (now - lastEscalated) / (1000 * 60 * 60);

      // SLA window: 48 hours for production.
      if (hoursElapsed >= 48) {
        if (currentTier < maxTier) {
          const nextTier = currentTier + 1;
          await db.query(
            "UPDATE complaints SET current_tier = ?, last_escalated_at = NOW() WHERE id = ?",
            [nextTier, ticket.id],
          );
          console.log(
            `🚀 Auto-escalated Ticket #${ticket.id} from Tier ${currentTier} to Tier ${nextTier} (${hoursElapsed.toFixed(1)}h elapsed)`,
          );
        } else if (currentTier === maxTier) {
          const nextTier = currentTier + 1;
          await db.query(
            "UPDATE complaints SET current_tier = ?, last_escalated_at = NOW() WHERE id = ?",
            [nextTier, ticket.id],
          );
          console.log(
            `🚨 Ticket #${ticket.id} escalated past max Tier ${currentTier} to Management. Sending email...`,
          );

          await emailService.sendManagementEscalationEmail({
            id: ticket.id,
            name: ticket.name,
            email: ticket.email,
            subject: ticket.subject,
            message: ticket.message,
          });
        }
      }
    }
  } catch (err) {
    if (err.code !== "ER_NO_SUCH_TABLE") {
      console.error("PROCESS ESCALATIONS ERROR:", err);
    }
  }
}

// Automatically check escalations every 5 minutes (for 48-hour SLA checking)
setInterval(processEscalations, 300000);

// Get all Support Tickets (Complaints list)

; // stripped /api/tickets/all


// Lesson plans completed today (Activity Report KPI #2). Read-only count
// exposed over the existing Express + db pool data path; the query itself is
// unchanged and uses CURDATE() so the value is evaluated at request time.

; // stripped /api/coach-lesson-plans/today


// Top performing schools today (Activity Report "TOP PERFORMING SCHOOLS").
// Ranking and the day boundary are done in SQL: ORDER BY entry_count DESC
// LIMIT 5 and CURDATE() evaluated at request time. Read-only, existing pool.

; // stripped /api/coach-lesson-tracking/top-schools


// Top performing coaches today (Activity Report "TOP PERFORMING COACHES").
// Same shape and day boundary as the schools endpoint above.

; // stripped /api/coach-lesson-tracking/top-coaches


// Update Ticket Action (Done / Resolved)

; // stripped /api/tickets/:id/action


// Dedicated Complaint Status Update API

; // stripped /api/complaints/update-status


// Delete a Complaint (Admin only)

; // stripped /api/complaints/:id


// Background Worker: Auto-Escalation Engine (Runs every 30 secs)
setInterval(processEscalations, 30000);

// ⚽ TEAM MANAGEMENT APIS
app.get("/api/teams", async (req, res) => {
  const { user_id, role_id } = req.query;
  const rid = parseInt(role_id) || 0;

  try {
    let sql = `
      SELECT t.*, s.name as school_name, u.name as coach_name, u.profile_pic as coach_avatar,
             (SELECT COUNT(*) FROM team_players WHERE team_id = t.id) as players_count
      FROM teams t
      LEFT JOIN schools s ON t.school_id = s.id
      LEFT JOIN users u ON t.coach_id = u.id
      WHERE 1=1
    `;
    const params = [];

    // Filter by coach_id if the user is a coach (role 4 or 5)
    // Or if they are a regular user (like SSGM, role 3), filter by their assigned schools
    if (user_id && !(rid === 1 || rid === 7 || rid === 2)) {
      if (rid === 4 || rid === 5) {
        sql += ` AND t.coach_id = ?`;
        params.push(user_id);
      } else {
        const [assignments] = await db.query(
          `
          SELECT school_id FROM assign_school WHERE user_id = ? OR ssgm_id = ?
          UNION
          SELECT school_id FROM lp_assign WHERE user_id = ?
          UNION
          SELECT school_id FROM coach_lesson_tracking WHERE user_id = ?
        `,
          [user_id, user_id, user_id, user_id],
        );
        const schoolIds = assignments
          .map((a) => a.school_id)
          .filter((id) => id !== null);
        if (schoolIds.length > 0) {
          sql += ` AND t.school_id IN (${schoolIds.join(",")})`;
        } else {
          sql += ` AND 1 = 0`; // Force empty result if no schools are assigned
        }
      }
    }

    sql += ` ORDER BY t.created_at DESC`;

    const [rows] = await db.query(sql, params);
    res.json({ success: true, teams: rows });
  } catch (err) {
    console.error("FETCH TEAMS ERROR:", err);
    res.status(500).json({ success: false, message: "Error fetching teams" });
  }
});

app.post("/api/teams", async (req, res) => {
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const { name, sport, school_id, coach_id, description, status, roster } =
      req.body;

    if (!name)
      return res
        .status(400)
        .json({ success: false, message: "Team name is required" });

    // 1. Create Team
    const [teamResult] = await connection.query(
      `INSERT INTO teams (name, sport, school_id, coach_id, description, status) VALUES (?, ?, ?, ?, ?, ?)`,
      [
        name,
        sport,
        school_id ? Number(school_id) : null,
        coach_id ? Number(coach_id) : null,
        description || null,
        status || "Preparation",
      ],
    );
    const teamId = teamResult.insertId;

    // 2. Process Roster
    if (roster && Array.isArray(roster)) {
      for (const p of roster) {
        if (!p.Name) continue;

        // Find or Create Student
        let studentId;
        const [existing] = await connection.query(
          `SELECT id FROM students WHERE name = ? AND school_id = ? AND std = ? AND division = ?`,
          [
            p.Name,
            school_id ? Number(school_id) : null,
            p.Std?.toString(),
            p.Division?.toString(),
          ],
        );

        if (existing.length > 0) {
          studentId = existing[0].id;
        } else {
          const [newStudent] = await connection.query(
            `INSERT INTO students (name, school_id, std, division, gender, roll_number, status) VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [
              p.Name,
              school_id ? Number(school_id) : null,
              p.Std?.toString() || "TBD",
              p.Division?.toString() || "TBD",
              "TBD",
              "TBD",
              1,
            ],
          );
          studentId = newStudent.insertId;
        }

        // Link to Team
        await connection.query(
          `INSERT INTO team_players (team_id, student_id) VALUES (?, ?)`,
          [teamId, studentId],
        );
      }
    }

    await connection.commit();
    res.json({
      success: true,
      message: "Team and Roster created successfully",
      id: teamId,
    });
  } catch (err) {
    await connection.rollback();
    console.error("CREATE TEAM ERROR:", err);
    res
      .status(500)
      .json({ success: false, message: "Error creating team and roster" });
  } finally {
    connection.release();
  }
});

// ✏️ UPDATE TEAM
app.put("/api/teams/:id", async (req, res) => {
  const { id } = req.params;
  const { name, sport, school_id, coach_id, description, status } = req.body;

  try {
    const [existing] = await db.query(`SELECT id FROM teams WHERE id = ?`, [
      id,
    ]);

    if (existing.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Team not found",
      });
    }

    if (!name || !sport) {
      return res.status(400).json({
        success: false,
        message: "Name and sport are required",
      });
    }

    await db.query(
      `
      UPDATE teams
      SET
        name = ?,
        sport = ?,
        school_id = ?,
        coach_id = ?,
        description = ?,
        status = ?
      WHERE id = ?
      `,
      [
        name,
        sport,
        school_id ? Number(school_id) : null,
        coach_id ? Number(coach_id) : null,
        description || null,
        status || "Preparation",
        id,
      ],
    );

    await auditAction(req, () => ({
      page: "Team Management",
      type: "UPDATE",
      action: `Updated team "${name}"`,
      entity: { type: "Team", id: Number(id) },
    }));

    res.json({
      success: true,
      message: "Team updated successfully",
    });
  } catch (err) {
    console.error("UPDATE TEAM ERROR:", err);

    res.status(500).json({
      success: false,
      message: "Error updating team",
    });
  }
});

// 🗑️ DELETE TEAM
app.delete("/api/teams/:id", async (req, res) => {
  const { id } = req.params;

  const connection = await db.getConnection();

  try {
    await connection.beginTransaction();

    const [teams] = await connection.query(
      `SELECT id, name FROM teams WHERE id = ?`,
      [id],
    );

    if (teams.length === 0) {
      await connection.rollback();

      return res.status(404).json({
        success: false,
        message: "Team not found",
      });
    }

    const teamName = teams[0].name;

    // Remove players assigned to the team in team_players
    await connection.query(`DELETE FROM team_players WHERE team_id = ?`, [id]);

    // Remove the team itself
    await connection.query(`DELETE FROM teams WHERE id = ?`, [id]);

    await connection.commit();

    await auditAction(req, () => ({
      page: "Team Management",
      type: "DELETE",
      action: `Deleted team "${teamName}"`,
      entity: { type: "Team", id: Number(id) },
    }));

    res.json({
      success: true,
      message: "Team deleted successfully",
    });
  } catch (err) {
    await connection.rollback();

    console.error("DELETE TEAM ERROR:", err);

    res.status(500).json({
      success: false,
      message: "Error deleting team",
    });
  } finally {
    connection.release();
  }
});

// 👥 ADD PLAYERS TO TEAM
app.post("/api/teams/:id/players", async (req, res) => {
  const { id } = req.params;
  const { roster, school_id } = req.body;
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();

    let resolvedSchoolId = school_id;
    if (!resolvedSchoolId) {
      const [teams] = await connection.query(
        "SELECT school_id FROM teams WHERE id = ?",
        [id],
      );
      if (teams.length === 0) {
        await connection.rollback();
        return res
          .status(404)
          .json({ success: false, message: "Team not found" });
      }
      resolvedSchoolId = teams[0].school_id;
    }

    if (!roster || !Array.isArray(roster) || roster.length === 0) {
      await connection.rollback();
      return res
        .status(400)
        .json({ success: false, message: "Roster data is required" });
    }

    let addedCount = 0;
    for (const p of roster) {
      if (!p.Name) continue;

      let studentId;
      const [existing] = await connection.query(
        `SELECT id FROM students WHERE name = ? AND school_id = ? AND std = ? AND division = ?`,
        [p.Name, resolvedSchoolId, p.Std?.toString(), p.Division?.toString()],
      );

      if (existing.length > 0) {
        studentId = existing[0].id;
      } else {
        const [newStudent] = await connection.query(
          `INSERT INTO students (name, school_id, std, division, gender, roll_number, status) VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [
            p.Name,
            resolvedSchoolId,
            p.Std?.toString() || "TBD",
            p.Division?.toString() || "TBD",
            "TBD",
            "TBD",
            1,
          ],
        );
        studentId = newStudent.insertId;
      }

      const [alreadyAdded] = await connection.query(
        `SELECT id FROM team_players WHERE team_id = ? AND student_id = ?`,
        [id, studentId],
      );
      if (alreadyAdded.length === 0) {
        await connection.query(
          `INSERT INTO team_players (team_id, student_id) VALUES (?, ?)`,
          [id, studentId],
        );
        addedCount++;
      }
    }

    await connection.commit();
    res.json({
      success: true,
      message: `${addedCount} player(s) added successfully`,
      addedCount,
    });
  } catch (err) {
    await connection.rollback();
    console.error("ADD PLAYERS TO TEAM ERROR:", err);
    res
      .status(500)
      .json({ success: false, message: "Error adding players to team" });
  } finally {
    connection.release();
  }
});

// Get players (students) for a team
app.get("/api/teams/:id/players", async (req, res) => {
  const { id } = req.params;
  try {
    const [players] = await db.query(
      `
      SELECT s.id, s.name, s.std, s.division, s.gender
      FROM team_players tp
      JOIN students s ON tp.student_id = s.id
      WHERE tp.team_id = ?
      ORDER BY tp.id
    `,
      [id],
    );
    res.json({ success: true, players });
  } catch (err) {
    console.error("FETCH TEAM PLAYERS ERROR:", err);
    res.status(500).json({ success: false, message: "Error fetching players" });
  }
});

// 🏟️ SDP APIS
app.get("/api/sports-teams", async (req, res) => {
  const { user_id, role_id } = req.query;
  const rid = parseInt(role_id) || 0;

  try {
    let sql = `
      SELECT t.*, s.name as school_name, u.name as coach_name, u.profile_pic as coach_avatar,
             (SELECT COUNT(*) FROM sports_team_players WHERE team_id = t.id) as players_count
      FROM sports_teams t
      LEFT JOIN schools s ON t.school_id = s.id
      LEFT JOIN users u ON t.coach_id = u.id
      WHERE 1=1
    `;
    const params = [];

    if (user_id && !(rid === 1 || rid === 7 || rid === 2)) {
      if (rid === 4 || rid === 5) {
        sql += ` AND t.coach_id = ?`;
        params.push(user_id);
      } else {
        const [assignments] = await db.query(
          `
          SELECT school_id FROM assign_school WHERE user_id = ? OR ssgm_id = ?
          UNION
          SELECT school_id FROM lp_assign WHERE user_id = ?
          UNION
          SELECT school_id FROM coach_lesson_tracking WHERE user_id = ?
        `,
          [user_id, user_id, user_id, user_id],
        );
        const schoolIds = assignments
          .map((a) => a.school_id)
          .filter((id) => id !== null);
        if (schoolIds.length > 0) {
          sql += ` AND t.school_id IN (${schoolIds.join(",")})`;
        } else {
          sql += ` AND 1 = 0`;
        }
      }
    }

    sql += ` ORDER BY t.created_at DESC`;

    const [rows] = await db.query(sql, params);
    res.json({ success: true, sportsTeams: rows });
  } catch (err) {
    console.error("FETCH SPORTS TEAMS ERROR:", err);
    res
      .status(500)
      .json({ success: false, message: "Error fetching sports teams" });
  }
});

app.post("/api/sports-teams", async (req, res) => {
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const { name, sport, school_id, coach_id, description, status, roster } =
      req.body;

    if (!name)
      return res
        .status(400)
        .json({ success: false, message: "Team name is required" });

    const [teamResult] = await connection.query(
      `INSERT INTO sports_teams (name, sport, school_id, coach_id, description, status) VALUES (?, ?, ?, ?, ?, ?)`,
      [name, sport, school_id, coach_id, description, status || "Preparation"],
    );
    const teamId = teamResult.insertId;

    if (roster && Array.isArray(roster)) {
      for (const p of roster) {
        if (!p.Name) continue;

        let studentId;
        const [existing] = await connection.query(
          `SELECT id FROM students WHERE name = ? AND school_id = ? AND std = ? AND division = ?`,
          [p.Name, school_id, p.Std?.toString(), p.Division?.toString()],
        );

        if (existing.length > 0) {
          studentId = existing[0].id;
        } else {
          const [newStudent] = await connection.query(
            `INSERT INTO students (name, school_id, std, division, gender, roll_number, status) VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [
              p.Name,
              school_id,
              p.Std?.toString() || "TBD",
              p.Division?.toString() || "TBD",
              "TBD",
              "TBD",
              1,
            ],
          );
          studentId = newStudent.insertId;
        }

        await connection.query(
          `INSERT INTO sports_team_players (team_id, student_id) VALUES (?, ?)`,
          [teamId, studentId],
        );
      }
    }

    await connection.commit();

    await auditAction(req, () => ({
      page: "Sports Teams",
      type: "CREATE",
      action: `Created sports team "${name}"`,
      entity: { type: "Team", id: teamId },
    }));

    res.json({
      success: true,
      message: "Sports Team and Roster created successfully",
      id: teamId,
    });
  } catch (err) {
    await connection.rollback();
    console.error("CREATE SPORTS TEAM ERROR:", err);
    res.status(500).json({
      success: false,
      message: "Error creating sports team and roster",
    });
  } finally {
    connection.release();
  }
});

// ✏️ UPDATE SPORTS TEAM
app.put("/api/sports-teams/:id", async (req, res) => {
  const { id } = req.params;
  const { name, sport, school_id, coach_id, description, status } = req.body;

  try {
    const [existing] = await db.query(
      `SELECT id FROM sports_teams WHERE id = ?`,
      [id],
    );

    if (existing.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Sports team not found",
      });
    }

    if (!name || !sport || !school_id || !coach_id) {
      return res.status(400).json({
        success: false,
        message: "Name, sport, school and coach are required",
      });
    }

    await db.query(
      `
      UPDATE sports_teams
      SET
        name = ?,
        sport = ?,
        school_id = ?,
        coach_id = ?,
        description = ?,
        status = ?
      WHERE id = ?
      `,
      [
        name,
        sport,
        school_id,
        coach_id,
        description || null,
        status || "Preparation",
        id,
      ],
    );

    await auditAction(req, () => ({
      page: "Sports Teams",
      type: "UPDATE",
      action: `Updated sports team "${name}"`,
      entity: { type: "Team", id: Number(id) },
    }));

    res.json({
      success: true,
      message: "Sports Team updated successfully",
    });
  } catch (err) {
    console.error("UPDATE SPORTS TEAM ERROR:", err);

    res.status(500).json({
      success: false,
      message: "Error updating sports team",
    });
  }
});

// 🗑️ DELETE SPORTS TEAM
app.delete("/api/sports-teams/:id", async (req, res) => {
  const { id } = req.params;

  const connection = await db.getConnection();

  try {
    await connection.beginTransaction();

    const [teams] = await connection.query(
      `SELECT id, name FROM sports_teams WHERE id = ?`,
      [id],
    );

    if (teams.length === 0) {
      await connection.rollback();

      return res.status(404).json({
        success: false,
        message: "Sports team not found",
      });
    }

    const teamName = teams[0].name;

    // Remove players assigned to the team
    await connection.query(
      `DELETE FROM sports_team_players WHERE team_id = ?`,
      [id],
    );

    // Remove attendance records for the team
    await connection.query(
      `DELETE FROM sports_team_attendance WHERE team_id = ?`,
      [id],
    );

    // Remove the team itself
    await connection.query(`DELETE FROM sports_teams WHERE id = ?`, [id]);

    await connection.commit();

    await auditAction(req, () => ({
      page: "Sports Teams",
      type: "DELETE",
      action: `Deleted sports team "${teamName}"`,
      entity: { type: "Team", id: Number(id) },
    }));

    res.json({
      success: true,
      message: "Sports Team deleted successfully",
    });
  } catch (err) {
    await connection.rollback();

    console.error("DELETE SPORTS TEAM ERROR:", err);

    res.status(500).json({
      success: false,
      message: "Error deleting sports team",
    });
  } finally {
    connection.release();
  }
});
// 🏟️ Sports Teams Players & Attendance Endpoints
// Get all players for a specific sports team
// ===== MOBILE APP: team / SDP helpers (additive, web unaffected) =====
// GET /api/school-students?school_id=&search= -> active students of one school
app.get("/api/school-students", async (req, res) => {
  const { school_id, search } = req.query;
  if (!school_id) return res.status(400).json({ success: false, message: "school_id is required" });
  try {
    let sql = "SELECT id, name, std, division, gender, roll_number FROM students WHERE school_id = ? AND (status = 1 OR status IS NULL)";
    const params = [school_id];
    if (search) { sql += " AND name LIKE ?"; params.push(`%${search}%`); }
    sql += " ORDER BY CAST(std AS UNSIGNED), std, division, name LIMIT 2000";
    const [rows] = await db.query(sql, params);
    res.json({ success: true, students: rows });
  } catch (err) {
    console.error("FETCH SCHOOL STUDENTS ERROR:", err);
    res.status(500).json({ success: false, message: "Error fetching students" });
  }
});

// POST /api/{teams|sports-teams}/:id/attach-players { student_ids: [] } -> link existing students (skips duplicates)
// DELETE /api/{teams|sports-teams}/:id/players/:studentId -> unlink one student
for (const [base, table] of [["teams", "team_players"], ["sports-teams", "sports_team_players"]]) {
  app.post(`/api/${base}/:id/attach-players`, async (req, res) => {
    const ids = Array.isArray(req.body?.student_ids) ? req.body.student_ids.map(Number).filter(Boolean) : [];
    if (!ids.length) return res.status(400).json({ success: false, message: "student_ids is required" });
    try {
      const [existing] = await db.query(`SELECT student_id FROM ${table} WHERE team_id = ?`, [req.params.id]);
      const have = new Set(existing.map((r) => Number(r.student_id)));
      const add = [...new Set(ids)].filter((sid) => !have.has(sid));
      for (const sid of add) await db.query(`INSERT INTO ${table} (team_id, student_id) VALUES (?, ?)`, [req.params.id, sid]);
      res.json({ success: true, added: add.length, message: `${add.length} player(s) added` });
    } catch (err) {
      console.error("ATTACH PLAYERS ERROR:", err);
      res.status(500).json({ success: false, message: "Error adding players" });
    }
  });
  app.delete(`/api/${base}/:id/players/:studentId`, async (req, res) => {
    try {
      await db.query(`DELETE FROM ${table} WHERE team_id = ? AND student_id = ?`, [req.params.id, req.params.studentId]);
      res.json({ success: true });
    } catch (err) {
      console.error("REMOVE PLAYER ERROR:", err);
      res.status(500).json({ success: false, message: "Error removing player" });
    }
  });
}

// GET /api/sports-teams/attendance-status?team_ids=1,2&date=YYYY-MM-DD -> { status: { teamId: markedCount } }
app.get("/api/sports-teams/attendance-status", async (req, res) => {
  const ids = String(req.query.team_ids || "").split(",").map(Number).filter(Boolean);
  if (!ids.length || !req.query.date) return res.json({ success: true, status: {} });
  try {
    const [rows] = await db.query(
      `SELECT team_id, COUNT(*) n FROM sports_team_attendance WHERE team_id IN (${ids.map(() => "?").join(",")}) AND attendance_date = ? AND status IN ('present','absent','late') GROUP BY team_id`,
      [...ids, req.query.date],
    );
    const status = {};
    rows.forEach((r) => { status[r.team_id] = Number(r.n); });
    res.json({ success: true, status });
  } catch (err) {
    console.error("ATTENDANCE STATUS ERROR:", err);
    res.status(500).json({ success: false, message: "Error fetching status" });
  }
});

// GET /api/sports-teams/:id/attendance-summary?from=&to= -> { days: [{ date, present, absent }] }
app.get("/api/sports-teams/:id/attendance-summary", async (req, res) => {
  const { from, to } = req.query;
  try {
    const [rows] = await db.query(
      `SELECT DATE_FORMAT(attendance_date, '%Y-%m-%d') d, SUM(status='present') present, SUM(status='absent') absent
       FROM sports_team_attendance WHERE team_id = ? AND attendance_date BETWEEN ? AND ? GROUP BY attendance_date ORDER BY attendance_date`,
      [req.params.id, from || "1970-01-01", to || "2999-12-31"],
    );
    res.json({ success: true, days: rows.map((r) => ({ date: r.d, present: Number(r.present), absent: Number(r.absent) })) });
  } catch (err) {
    console.error("ATTENDANCE SUMMARY ERROR:", err);
    res.status(500).json({ success: false, message: "Error fetching summary" });
  }
});
app.get("/api/sports-teams/:id/players", async (req, res) => {
  const { id } = req.params;
  try {
    const [players] = await db.query(
      `
      SELECT s.id, s.name, s.std, s.division, s.gender
      FROM sports_team_players stp
      JOIN students s ON stp.student_id = s.id
      WHERE stp.team_id = ?
      ORDER BY s.name
    `,
      [id],
    );
    res.json({ success: true, players });
  } catch (err) {
    console.error("FETCH SPORTS TEAM PLAYERS ERROR:", err);
    res.status(500).json({ success: false, message: "Error fetching players" });
  }
});

// Add players to an existing sports team via roster upload
app.post("/api/sports-teams/:id/players", async (req, res) => {
  const { id } = req.params;
  const { roster, school_id } = req.body;
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();

    // Get team's school_id if not provided
    let resolvedSchoolId = school_id;
    if (!resolvedSchoolId) {
      const [teams] = await connection.query(
        "SELECT school_id FROM sports_teams WHERE id = ?",
        [id],
      );
      if (teams.length === 0) {
        await connection.rollback();
        return res
          .status(404)
          .json({ success: false, message: "Team not found" });
      }
      resolvedSchoolId = teams[0].school_id;
    }

    if (!roster || !Array.isArray(roster) || roster.length === 0) {
      await connection.rollback();
      return res
        .status(400)
        .json({ success: false, message: "Roster data is required" });
    }

    let addedCount = 0;
    for (const p of roster) {
      if (!p.Name) continue;

      let studentId;
      const [existing] = await connection.query(
        `SELECT id FROM students WHERE name = ? AND school_id = ? AND std = ? AND division = ?`,
        [p.Name, resolvedSchoolId, p.Std?.toString(), p.Division?.toString()],
      );

      if (existing.length > 0) {
        studentId = existing[0].id;
      } else {
        const [newStudent] = await connection.query(
          `INSERT INTO students (name, school_id, std, division, gender, roll_number, status) VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [
            p.Name,
            resolvedSchoolId,
            p.Std?.toString() || "TBD",
            p.Division?.toString() || "TBD",
            "TBD",
            "TBD",
            1,
          ],
        );
        studentId = newStudent.insertId;
      }

      // Check if player already on this team
      const [alreadyAdded] = await connection.query(
        `SELECT id FROM sports_team_players WHERE team_id = ? AND student_id = ?`,
        [id, studentId],
      );
      if (alreadyAdded.length === 0) {
        await connection.query(
          `INSERT INTO sports_team_players (team_id, student_id) VALUES (?, ?)`,
          [id, studentId],
        );
        addedCount++;
      }
    }

    await connection.commit();
    res.json({
      success: true,
      message: `${addedCount} player(s) added successfully`,
      addedCount,
    });
  } catch (err) {
    await connection.rollback();
    console.error("ADD PLAYERS TO TEAM ERROR:", err);
    res
      .status(500)
      .json({ success: false, message: "Error adding players to team" });
  } finally {
    connection.release();
  }
});

// Save attendance for a sports team
app.post("/api/sports-teams/:id/attendance", async (req, res) => {
  const { id } = req.params;
  const { attendance_date, attendance } = req.body; // attendance is array of { student_id, status }
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();

    // Deduplicate by student_id (last entry wins)
    const dedupedMap = new Map();
    for (const record of attendance) {
      dedupedMap.set(record.student_id, record.status);
    }

    // Upsert: insert or update if the unique key already exists
    for (const [student_id, status] of dedupedMap.entries()) {
      await connection.query(
        `INSERT INTO sports_team_attendance (team_id, student_id, attendance_date, status)
         VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE status = VALUES(status)`,
        [id, student_id, attendance_date, status],
      );
    }

    await connection.commit();
    res.json({ success: true, message: "Attendance saved successfully" });
  } catch (err) {
    await connection.rollback();
    console.error("SAVE SPORTS TEAM ATTENDANCE ERROR:", err);
    res
      .status(500)
      .json({ success: false, message: "Error saving attendance" });
  } finally {
    connection.release();
  }
});

// Get attendance for a sports team on a specific date
app.get("/api/sports-teams/:id/attendance", async (req, res) => {
  const { id } = req.params;
  const { date } = req.query;
  try {
    const [attendance] = await db.query(
      `
      SELECT sta.*, s.name as student_name, s.std, s.division
      FROM sports_team_attendance sta
      JOIN students s ON sta.student_id = s.id
      WHERE sta.team_id = ? AND sta.attendance_date = ?
      ORDER BY s.name
    `,
      [id, date],
    );
    res.json({ success: true, attendance });
  } catch (err) {
    console.error("FETCH SPORTS TEAM ATTENDANCE ERROR:", err);
    res
      .status(500)
      .json({ success: false, message: "Error fetching attendance" });
  }
});

// Get current server date (YYYY-MM-DD) — uses LOCAL server timezone, not UTC
const localDateStr = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

app.get("/api/current-date", (req, res) => {
  res.json({ success: true, date: localDateStr() });
});

// 📊 Attendance Report - Fetch attendance with filters

; // stripped /api/attendance-report


// ==========================================
// STUDENT ATTENDANCE (Excel Upload Based)
// ==========================================

// Upload student attendance from parsed Excel
app.post("/api/student-attendance/upload", async (req, res) => {
  try {
    const { attendance, uploaded_by } = req.body;
    if (!Array.isArray(attendance) || attendance.length === 0) {
      return res
        .status(400)
        .json({ success: false, message: "No attendance records provided" });
    }

    let imported = 0;
    for (const record of attendance) {
      const {
        mq_id,
        student_name,
        standard,
        division,
        school_name,
        attendance_date,
        status,
      } = record;

      if (
        !student_name ||
        !standard ||
        !division ||
        !school_name ||
        !attendance_date
      )
        continue;

      const normalizedStatus = String(status).trim().toLowerCase();
      const finalStatus = normalizedStatus === "present" ? "present" : "absent";

      await db.query(
        `INSERT INTO student_attendance (mq_id, student_name, standard, division, school_name, attendance_date, status, uploaded_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE mq_id = VALUES(mq_id), student_name = VALUES(student_name), school_name = VALUES(school_name), status = VALUES(status), uploaded_by = VALUES(uploaded_by)`,
        [
          mq_id || null,
          student_name.trim(),
          standard.trim(),
          division.trim(),
          school_name.trim(),
          attendance_date,
          finalStatus,
          uploaded_by || null,
        ],
      );
      imported++;
    }

    res.json({
      success: true,
      message: `Successfully imported ${imported} attendance record(s)`,
      imported,
    });
  } catch (err) {
    console.error("UPLOAD STUDENT ATTENDANCE ERROR:", err);
    res
      .status(500)
      .json({ success: false, message: "Error uploading attendance" });
  }
});

// Get student attendance records
app.get("/api/student-attendance", async (req, res) => {
  try {
    const { school_name, school_names, date, user_id, role_id } = req.query;
    let sql = `SELECT sa.*, u.name as uploaded_by_name
      FROM student_attendance sa
      LEFT JOIN users u ON sa.uploaded_by = u.id
      WHERE 1=1`;
    const params = [];

    if (school_name && school_name !== "All") {
      sql += " AND school_name = ?";
      params.push(school_name);
    } else if (school_names) {
      const schools = school_names
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      if (schools.length > 0) {
        sql += ` AND school_name IN (${schools.map(() => "?").join(",")})`;
        params.push(...schools);
      }
    }

    const isAdmin = [1, 7, 2].includes(Number(role_id));
    if (!isAdmin && user_id) {
      sql += " AND uploaded_by = ?";
      params.push(Number(user_id));
    }
    if (date) {
      sql += " AND attendance_date = ?";
      params.push(date);
    } else {
      sql += " AND attendance_date = CURDATE()";
    }

    sql += " ORDER BY attendance_date DESC, student_name ASC";

    const [records] = await db.query(sql, params);

    const total = records.length;
    const present = records.filter((r) => r.status === "present").length;
    const absent = records.filter((r) => r.status === "absent").length;

    res.json({
      success: true,
      records,
      summary: { total, present, absent },
    });
  } catch (err) {
    console.error("FETCH STUDENT ATTENDANCE ERROR:", err);
    res
      .status(500)
      .json({ success: false, message: "Error fetching attendance" });
  }
});

// Get distinct school names from student attendance

; // stripped /api/student-attendance/schools


// Delete a single student attendance record

; // stripped /api/student-attendance/:id


// Duplicate coaches endpoint removed to avoid conflict with the one at line 671

// 👥 GET USER LOGINS (Previously SSGM only)

; // stripped /api/management/ssgm-logins


// 👥 GET PRINCIPAL LOGINS

; // stripped /api/management/principal-logins


// 📝 LECTURE MANAGEMENT APIS
app.get("/api/management/lectures", async (req, res) => {
  const { school_id, user_id, role_id } = req.query;

  try {
    let lecturesSql = `
      SELECT l.*, u.name as coach_name, s.name as school_name 
      FROM marked_lectures l
      JOIN users u ON l.coach_id = u.id
      JOIN schools s ON l.school_id = s.id
      WHERE 1=1
    `;
    let metricsSql = `
      SELECT 
        COUNT(*) as total_lectures,
        AVG(TIMESTAMPDIFF(MINUTE, start_time, end_time)) as avg_duration,
        COUNT(DISTINCT coach_id) as active_coaches
      FROM marked_lectures
      WHERE 1=1
    `;
    let params = [];
    let metricsParams = [];

    if (school_id) {
      lecturesSql += " AND l.school_id = ?";
      metricsSql += " AND school_id = ?";
      params.push(school_id);
      metricsParams.push(school_id);
    }

    // Filter by created_by unless admin or operations head (role_id = 1, 7, 2)
    if (user_id && role_id !== "1" && role_id !== "7" && role_id !== "2") {
      lecturesSql += " AND l.created_by = ?";
      metricsSql += " AND created_by = ?";
      params.push(user_id);
      metricsParams.push(user_id);
    }

    lecturesSql += " ORDER BY l.lecture_date DESC, l.start_time DESC";

    const [rows] = await db.query(lecturesSql, params);
    const [stats] = await db.query(metricsSql, metricsParams);

    res.json({
      success: true,
      lectures: rows,
      metrics: {
        total: stats[0].total_lectures || 0,
        avgDuration: Math.round(stats[0].avg_duration || 0),
        activeCoaches: stats[0].active_coaches || 0,
      },
    });
  } catch (err) {
    console.error("FETCH LECTURES ERROR:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

app.post("/api/management/lectures", async (req, res) => {
  const {
    school_id,
    coach_id,
    sport,
    lecture_date,
    start_time,
    end_time,
    grades,
    division,
    week_no,
  } = req.body;

  if (
    !school_id ||
    !coach_id ||
    !sport ||
    !lecture_date ||
    !start_time ||
    !end_time
  ) {
    return res
      .status(400)
      .json({ success: false, message: "Missing required fields" });
  }

  try {
    const gradeList = Array.isArray(grades)
      ? grades
      : typeof grades === "string"
        ? grades.split(",")
        : [grades];
    const divisionList = Array.isArray(division)
      ? division
      : typeof division === "string"
        ? division.split(",")
        : [division];

    const results = [];
    for (const g of gradeList) {
      for (const d of divisionList) {
        const [result] = await db.query(
          `
          INSERT INTO marked_lectures (school_id, coach_id, created_by, sport, lecture_date, start_time, end_time, grades, division, week_no)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
          [
            school_id,
            coach_id,
            req.body.user_id || coach_id, // Save who created it
            sport,
            lecture_date,
            start_time,
            end_time,
            g,
            d,
            week_no || null,
          ],
        );
        results.push(result.insertId);
      }
    }

    res.json({ success: true, lectureIds: results });
  } catch (err) {
    console.error("CREATE LECTURE ERROR:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

app.get("/api/management/lecture-metadata", async (req, res) => {
  const { user_id } = req.query;
  try {
    // 1. Schools assigned to the user
    let schoolsSql = "SELECT id, name FROM schools";
    let params = [];

    // Check if user_id is a valid number/ID (ignore 'undefined', 'null', or empty)
    const validUserId =
      user_id && user_id !== "undefined" && user_id !== "null";

    if (validUserId) {
      schoolsSql = `
        SELECT s.id, s.name 
        FROM schools s
        JOIN assign_school asgn ON s.id = asgn.school_id
        WHERE asgn.user_id = ?
      `;
      params = [user_id];
    }
    const [schools] = await db.query(schoolsSql, params);

    // 2. Coaches (Role 4, 5)
    const [coaches] = await db.query(`
      SELECT u.id, u.name, r.name as role_name 
      FROM users u 
      JOIN roles r ON u.role_id = r.id 
      WHERE u.role_id IN (4, 5) AND u.is_active = 1 
      ORDER BY u.name ASC
    `);

    // 3. Sports from year_lp_master_new
    const [sports] = await db.query(
      "SELECT DISTINCT sport FROM year_lp_master_new WHERE sport IS NOT NULL ORDER BY sport ASC",
    );

    res.json({
      success: true,
      schools,
      coaches,
      sports: sports.map((s) => s.sport),
    });
  } catch (err) {
    console.error("FETCH METADATA ERROR:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// 📊 AOP CURRICULUM TRACKING APIS
// 🔧 Canonical form for matching legacy grade/sport values against the master
// (e.g. "3" ↔ "Grade 3", "Jr.Kg" ↔ "Jr. Kg", "Chess" ↔ "Chess ", "Smart start" ↔ "Smart Start ").
const CANON_FIELD = (col) =>
  `TRIM(REGEXP_REPLACE(REGEXP_REPLACE(REPLACE(LOWER(TRIM(${col})), '.', ' '), '^grade[ ]+', ''), '[ ]+', ' '))`;

// Resolve the sports a school actually selected in the curriculum builder.
// Prefers the plan's saved sports_json (the authoritative selection), then
// falls back to the plan's generated entries. Empty = no builder plan yet.
async function getSchoolCurriculumSports(schoolId) {
  const [plans] = await db.query(
    `SELECT id, sports_json FROM curriculum_builder_plans
     WHERE school_id = ?
     ORDER BY created_at DESC
     LIMIT 1`,
    [schoolId],
  );
  if (plans.length === 0) return [];

  try {
    const parsed = JSON.parse(plans[0].sports_json || "[]");
    if (Array.isArray(parsed) && parsed.length > 0) {
      return [
        ...new Set(
          parsed.filter((s) => typeof s === "string" && s.trim().length > 0),
        ),
      ];
    }
  } catch {
    // ignore malformed json and fall through to entries
  }

  const [rows] = await db.query(
    "SELECT DISTINCT sport FROM curriculum_builder_entries WHERE plan_id = ? AND sport IS NOT NULL",
    [plans[0].id],
  );
  return rows.map((r) => r.sport);
}


; // stripped /api/curriculum/aop-metadata



; // stripped /api/curriculum/aop-stats



; // stripped /api/curriculum/aop-details


// 📊 AOP LESSON BREAKDOWN — categorized lesson view for a sport + grade + school

; // stripped /api/curriculum/aop-lesson-breakdown


// 🎫 SUBMIT FEEDBACK (DASHBOARD)
app.post("/api/support/feedback", async (req, res) => {
  try {
    const { subject, message, name, email, user_id } = req.body;
    if (!subject || !message) {
      return res
        .status(400)
        .json({ success: false, message: "Subject and message are required" });
    }

    await db.query(
      "INSERT INTO feed_back_user (user_id, name, email, subject, message) VALUES (?, ?, ?, ?, ?)",
      [user_id || null, name || "Anonymous", email || "N/A", subject, message],
    );

    res.json({ success: true, message: "Feedback submitted successfully" });
  } catch (err) {
    console.error("SUBMIT FEEDBACK ERROR:", err);
    res
      .status(500)
      .json({ success: false, message: "Error submitting feedback" });
  }
});

app.get("/api/support/feedback", async (req, res) => {
  try {
    const [rows] = await db.query(
      "SELECT * FROM feed_back_user ORDER BY id DESC",
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    console.error("GET FEEDBACK ERROR:", err);
    res.status(500).json({ success: false, message: "Internal Server Error" });
  }
});


; // stripped /api/sggm-scope-of-improvement



; // stripped /api/sggm-scope-of-improvement



; // stripped /api/sggm-scope-of-improvement/:id


// 🚀 SGGM FOLLOW-UP REPORT APIs

; // stripped /api/sggm-follow-up-report



; // stripped /api/sggm-follow-up-report



; // stripped /api/sggm-follow-up-report/:id



; // stripped /api/sggm-follow-up-report/:id


// 🚀 SGGM CHECKLIST V2 APIs

; // stripped /api/sggm-checklist-v2



; // stripped /api/sggm-checklist-v2



; // stripped /api/sggm-checklist-v2/:id



; // stripped /api/sggm-checklist-v2/:id



; // stripped /api/sggm-mom-v2/:id


// 📋 SGGM MOM V2 APIS

; // stripped /api/sggm-mom-v2



; // stripped /api/sggm-mom-v2



; // stripped /api/sggm-mom-v2/:id



; // stripped /api/coaches-by-school/:school_id


// 📋 SGGM CHECKLIST APIS

; // stripped /api/sggm-checklist



; // stripped /api/sggm-checklist



; // stripped /api/sggm-checklist/:id


// 📋 SGGM MOM APIS

; // stripped /api/sggm-mom



; // stripped /api/sggm-mom



; // stripped /api/sggm-mom/:id


// 📱 FCM TOKEN MANAGEMENT

; // stripped /api/save-fcm-token


// 🔔 MANUAL PUSH TEST (Admin Only)

; // stripped /api/admin/send-test-push


// 🎥 VIDEO MEETING EVENTS ENDPOINTS

; // stripped /api/meeting-events


// 💬 GET CALL MESSAGES for a room

; // stripped /api/call-messages/:roomId


// 💬 SAVE a chat message

; // stripped /api/call-messages


// 👥 RECORD USER JOINING a meeting

; // stripped /api/meeting-participants/join


// 👥 RECORD USER LEAVING a meeting

; // stripped /api/meeting-participants/leave


// 📊 GET MEETING SUMMARY for a room

; // stripped /api/meeting-summary/:roomId


// Append Transcript to a Meeting

; // stripped /api/meeting-events/:roomId/transcript


// Generate/View AI Summary (Simulated)

; // stripped /api/meeting-events/:roomId/summarize



; // stripped /api/meeting-events


// ─── SCHOOL STANDARDS (school_stds) ─────────────────────────────────────────

// Auto-create school_stds table if not exists
(async () => {
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS school_stds (
        id INT(11) NOT NULL AUTO_INCREMENT PRIMARY KEY,
        school_id INT(11) NOT NULL,
        std_id INT(11) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uniq_school_std (school_id, std_id)
      )
    `);
  } catch (e) {
    console.error("school_stds table init error:", e.message);
  }
})();

// Helper to get standard ID by name (case-insensitive) or create one with auto-incremented code
async function getOrCreateStdId(name) {
  const trimmedName = String(name || "").trim();
  if (!trimmedName) throw new Error("Standard name is required");

  // Check if exists
  const [match] = await db.query(
    "SELECT id FROM stds_master WHERE LOWER(name) = LOWER(?)",
    [trimmedName],
  );
  if (match.length > 0) {
    return match[0].id;
  }

  // Calculate new code: MAX(std_code) + 1
  const [rows] = await db.query(
    "SELECT MAX(std_code) as max_code FROM stds_master",
  );
  const maxCode = rows[0].max_code;
  const newStdCode =
    maxCode !== null && maxCode !== undefined ? maxCode + 1 : 1;

  // Insert new standard
  const [result] = await db.query(
    "INSERT INTO stds_master (name, std_code, is_active) VALUES (?, ?, 1)",
    [trimmedName, newStdCode],
  );
  return result.insertId;
}

// GET all standards for a school

; // stripped /api/school-stds/:school_id


// POST save standards for a school (replaces existing - bulk)

; // stripped /api/school-stds


// POST add single standard to a school

; // stripped /api/school-stds/add


// PUT update a school standard assignment (change school_id, std_id, and division)

; // stripped /api/school-stds/update/:id


// GET all school standards for all schools

; // stripped /api/school-stds-all


// POST bulk import school standards from Excel

; // stripped /api/school-stds/bulk-import


// DELETE remove single school standard assignment

; // stripped /api/school-stds/remove/:id


// GET all schools (for dropdown)

; // stripped /api/school-stds-schools


// GET all master standards (full stds_master table)

; // stripped /api/stds-master


// POST create a new master standard

; // stripped /api/stds-master


// PUT update a master standard

; // stripped /api/stds-master/:id


// POST bulk import master standards from Excel upload

; // stripped /api/stds-master/bulk


// DELETE a master standard

; // stripped /api/stds-master/:id


// ───────────────────────────────────────────────────────────────────────────── //

// 🗄️ BACKUP DOWNLOAD ENDPOINT
// Securely serves SQL backup files from the backups directory.
// Requires ?token=BACKUP_DOWNLOAD_TOKEN in the URL for access.

; // stripped /backup/download/:filename


// ═══════════════════════════════════════════════════════════════════════════════
// 🎫 TICKET ESCALATION SYSTEM
// Flow: Raise → SSGM (Tier 1, 12h) → Ops Head (Tier 2, 12h) → Management (Tier 3)
// ═══════════════════════════════════════════════════════════════════════════════

// 📦 Initialize ticket tables and migrate complaints table on startup
(async () => {
  try {
    // 1. Initialize rules table
    await db.query(`
      CREATE TABLE IF NOT EXISTS ticket_escalation_rules (
        id INT AUTO_INCREMENT PRIMARY KEY,
        tier_level INT NOT NULL,
        assigned_role_id INT NULL,
        assigned_user_id INT NULL,
        timeout_hours INT DEFAULT 12,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Seed default escalation rules if missing
    const [tier1] = await db.query(
      "SELECT * FROM ticket_escalation_rules WHERE tier_level = 1",
    );
    if (tier1.length === 0) {
      await db.query(
        "INSERT INTO ticket_escalation_rules (tier_level, assigned_role_id, timeout_hours) VALUES (1, 3, 12)",
      ); // SSGM
    }
    const [tier2] = await db.query(
      "SELECT * FROM ticket_escalation_rules WHERE tier_level = 2",
    );
    if (tier2.length === 0) {
      await db.query(
        "INSERT INTO ticket_escalation_rules (tier_level, assigned_role_id, timeout_hours) VALUES (2, 2, 12)",
      ); // Ops Head
    }
    const [tier3] = await db.query(
      "SELECT * FROM ticket_escalation_rules WHERE tier_level = 3",
    );
    if (tier3.length === 0) {
      await db.query(
        "INSERT INTO ticket_escalation_rules (tier_level, assigned_role_id, timeout_hours) VALUES (3, 1, 12)",
      ); // Management/Admin
    }

    // 2. Dynamically migrate the existing complaints table to support escalation
    const [columns] = await db.query("DESCRIBE complaints");
    const colNames = columns.map((c) => c.Field);

    if (!colNames.includes("user_id")) {
      console.log("Migrating complaints table: Adding user_id...");
      await db.query(
        "ALTER TABLE complaints ADD COLUMN user_id INT NULL AFTER message",
      );
    }
    if (!colNames.includes("current_tier")) {
      console.log("Migrating complaints table: Adding current_tier...");
      await db.query(
        "ALTER TABLE complaints ADD COLUMN current_tier INT DEFAULT 1 AFTER user_id",
      );
    }
    if (!colNames.includes("assigned_role_id")) {
      console.log("Migrating complaints table: Adding assigned_role_id...");
      await db.query(
        "ALTER TABLE complaints ADD COLUMN assigned_role_id INT NULL AFTER current_tier",
      );
    }
    if (!colNames.includes("assigned_user_id")) {
      console.log("Migrating complaints table: Adding assigned_user_id...");
      await db.query(
        "ALTER TABLE complaints ADD COLUMN assigned_user_id INT NULL AFTER assigned_role_id",
      );
    }
    if (!colNames.includes("last_escalated_at")) {
      console.log("Migrating complaints table: Adding last_escalated_at...");
      await db.query(
        "ALTER TABLE complaints ADD COLUMN last_escalated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP AFTER status",
      );
    }
    if (!colNames.includes("school_id")) {
      console.log("Migrating complaints table: Adding school_id...");
      await db.query(
        "ALTER TABLE complaints ADD COLUMN school_id INT NULL AFTER user_id",
      );
    }

    // Ensure status enum supports 'solved' and other values
    // Check if status is ENUM('pending', 'solved') and allow update if necessary

    console.log(
      "🎫 Ticket and complaints tables successfully synchronized and migrated.",
    );
  } catch (err) {
    console.error("❌ Ticket/complaints migration error:", err.message);
  }
})();

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/notifications/tickets — Bell icon: pending complaint notifications
// ─────────────────────────────────────────────────────────────────────────────

; // stripped /api/notifications/tickets


// ─────────────────────────────────────────────────────────────────────────────
// POST /api/support/ticket — User raises a new support ticket
// ─────────────────────────────────────────────────────────────────────────────
app.post("/api/support/ticket", async (req, res) => {
  try {
    const { name, email, subject, message, user_id, school_id } = req.body;
    if (!name || !email || !message) {
      return res.status(400).json({
        success: false,
        message: "Name, email, and message are required.",
      });
    }

    // Validate school access if school_id is provided
    if (school_id && user_id) {
      const uid = parseInt(user_id, 10);
      const sid = parseInt(school_id, 10);
      const [roleRows] = await db.query(
        "SELECT role_id FROM users WHERE id = ?",
        [uid],
      );
      const rid = roleRows.length > 0 ? roleRows[0].role_id : 0;
      if (!(rid === 1 || rid === 7 || rid === 2)) {
        const [schoolAccess] = await db.query(
          `
          SELECT school_id FROM assign_school WHERE user_id = ? OR ssgm_id = ?
          UNION
          SELECT school_id FROM lp_assign WHERE user_id = ?
          UNION
          SELECT school_id FROM coach_lesson_tracking WHERE user_id = ?
        `,
          [uid, uid, uid, uid],
        );
        const accessibleIds = schoolAccess
          .map((r) => r.school_id)
          .filter((id) => id != null);
        if (!accessibleIds.includes(sid)) {
          return res.status(403).json({
            success: false,
            message: "You do not have access to this school.",
          });
        }
      }
    }

    // Insert into complaints
    const [result] = await db.query(
      `INSERT INTO complaints (subject, name, email, message, user_id, school_id, current_tier, assigned_role_id, status, last_escalated_at)
       VALUES (?, ?, ?, ?, ?, ?, 1, 3, 'pending', NOW())`,
      [
        subject || null,
        name,
        email,
        message,
        user_id || null,
        school_id || null,
      ],
    );

    const ticketId = result.insertId;

    // Fix malformed emails in users table if needed (e.g. missing .com)
    db.query(
      "UPDATE users SET email = CONCAT(email, '.com') WHERE email LIKE '%@marcosquay'",
    ).catch(() => { });

    // Helper to sanitize and validate email format
    const sanitizeEmail = (email) => {
      if (!email || typeof email !== "string") return null;
      let cleaned = email.trim();
      if (cleaned.endsWith("@marcosquay")) {
        cleaned += ".com";
      }
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      return emailRegex.test(cleaned) ? cleaned : null;
    };

    // Resolve assigned SSGM email
    let recipientEmail = null;
    let ssgmName = null;

    console.log(
      `🎫 Ticket #${ticketId} — Resolving SSGM for user_id=${user_id}`,
    );

    if (user_id) {
      // 1. Check direct SSGM assignment
      const [ssgmRows] = await db.query(
        `SELECT DISTINCT u.email, u.name
         FROM assign_school a
         JOIN users u ON a.ssgm_id = u.id
         WHERE a.user_id = ? AND u.email IS NOT NULL AND u.email != ''
         LIMIT 1`,
        [user_id],
      );

      console.log(`🔍 Direct SSGM result:`, JSON.stringify(ssgmRows));

      if (ssgmRows.length > 0) {
        recipientEmail = sanitizeEmail(ssgmRows[0].email);
        ssgmName = ssgmRows[0].name;
        console.log(
          `✅ SSGM found: ${ssgmName} | raw email: ${ssgmRows[0].email} | sanitized: ${recipientEmail}`,
        );
      }

      if (!recipientEmail) {
        // 2. Fallback: check if user's school has an assigned SSGM
        const [schoolSsgmRows] = await db.query(
          `SELECT DISTINCT u.email, u.name
           FROM assign_school a_user
           JOIN assign_school a_ssgm ON a_user.school_id = a_ssgm.school_id
           JOIN users u ON a_ssgm.ssgm_id = u.id
           WHERE a_user.user_id = ? AND u.email IS NOT NULL AND u.email != ''
           LIMIT 1`,
          [user_id],
        );
        console.log(`🔍 School SSGM result:`, JSON.stringify(schoolSsgmRows));
        if (schoolSsgmRows.length > 0) {
          recipientEmail = sanitizeEmail(schoolSsgmRows[0].email);
          ssgmName = schoolSsgmRows[0].name;
          console.log(
            `✅ School SSGM found: ${ssgmName} | raw email: ${schoolSsgmRows[0].email} | sanitized: ${recipientEmail}`,
          );
        }
      }
    } else {
      console.log(`⚠️ No user_id in request — skipping SSGM lookup`);
    }

    // Fallback to Operations Head if no valid SSGM email assigned
    if (!recipientEmail) {
      recipientEmail =
        sanitizeEmail(process.env.OPS_EMAIL) ||
        "laxman.chalmale@marcosquay.com";
      console.log(
        `⚠️ No SSGM resolved — falling back to Ops Head: ${recipientEmail}`,
      );
    }

    // Send initial alert email to SSGM (or Operations Head)

    try {
      await emailService.sendTicketAlert(
        {
          id: ticketId,
          name,
          email,
          subject: subject || "Support Request",
          message,
          ssgmName,
        },
        recipientEmail,
      );
    } catch (mailErr) {
      console.error("⚠️ Ticket alert email failed:", mailErr.message);
    }

    await auditAction(req, () => ({
      page: "Helpdesk",
      type: "CREATE",
      action: `Raised support ticket "${subject || "Support Request"}" (Ticket ID: ${ticketId})`,
      entity: { type: "Ticket", id: ticketId },
    }));

    return res.json({
      success: true,
      message: "Ticket raised successfully.",
      ticket_id: ticketId,
      recipient_email: recipientEmail,
      ssgm_name: ssgmName,
    });
  } catch (err) {
    console.error("❌ POST /api/support/ticket ERROR:", err);
    return res
      .status(500)
      .json({ success: false, message: "Server error raising ticket." });
  }
});


; // stripped /api/debug/ticket-ssgm


// ─────────────────────────────────────────────────────────────────────────────
// GET /api/tickets/all — Fetch tickets (role-filtered) with SLA countdown
// ─────────────────────────────────────────────────────────────────────────────

; // stripped /api/tickets/all


// ─────────────────────────────────────────────────────────────────────────────
// POST /api/complaints/update-status — Mark ticket as solved/resolved
// ─────────────────────────────────────────────────────────────────────────────

; // stripped /api/complaints/update-status


// ─────────────────────────────────────────────────────────────────────────────
// ⏰ ESCALATION CRON — Runs every 5 minutes, checks SLA breach → escalates
// ─────────────────────────────────────────────────────────────────────────────
const sendOpsEscalationEmail = async (ticketData) => {
  try {
    if (!process.env.MAIL_USER || !process.env.MAIL_PASS) return;
    const nodemailer = require("nodemailer");
    const transporter = nodemailer.createTransport({
      host: process.env.MAIL_HOST || "smtp.gmail.com",
      port: process.env.MAIL_PORT || 587,
      secure: false,
      auth: { user: process.env.MAIL_USER, pass: process.env.MAIL_PASS },
    });
    await transporter.sendMail({
      from: `"MQ Helpdesk Escalation" <${process.env.MAIL_FROM || "alert@marcosquay.com"}>`,
      to: process.env.OPS_EMAIL || "laxman.chalmale@marcosquay.com",
      subject: `⚠️ ESCALATED TO OPS HEAD: Ticket #${ticketData.id} — ${ticketData.subject}`,
      html: `
        <div style="font-family:sans-serif;max-width:600px;margin:auto;padding:20px;border:2px solid #f59e0b;border-radius:10px;">
          <h2 style="color:#f59e0b;">Ticket Escalated to Operations Head</h2>
          <p style="color:#64748b;font-size:14px;">The SSGM did not resolve this ticket within the 12-hour SLA window. It has been automatically escalated to the Operations Head.</p>
          <p><strong>Ticket ID:</strong> #${ticketData.id}</p>
          <p><strong>From:</strong> ${ticketData.name} (${ticketData.email})</p>
          <p><strong>Subject:</strong> ${ticketData.subject}</p>
          <div style="background:#f9f9f9;padding:15px;border-radius:5px;margin:20px 0;">
            <strong>Message:</strong><br/>
            <p style="white-space:pre-wrap;color:#333;">${ticketData.message}</p>
          </div>
          <p><strong>Current Tier:</strong> 2 (Operations Head)</p>
          <hr style="margin-top:40px;border:0;border-top:1px solid #eee;"/>
          <p style="font-size:11px;color:#aaa;">Automated notification from MQ Helpdesk.</p>
        </div>
      `,
    });
    console.log(`✅ Ops escalation email sent for ticket #${ticketData.id}`);
  } catch (err) {
    console.error("❌ OPS ESCALATION EMAIL ERROR:", err.message);
  }
};

setInterval(
  async () => {
    try {
      // Find all pending tickets that have exceeded their tier SLA
      const [overdueTickets] = await db.query(`
      SELECT c.*, ter.timeout_hours, ter.tier_level
      FROM complaints c
      JOIN ticket_escalation_rules ter ON ter.tier_level = c.current_tier
      WHERE c.status = 'pending'
        AND c.current_tier < 3
        AND TIMESTAMPDIFF(SECOND, c.last_escalated_at, NOW()) >= (ter.timeout_hours * 3600)
    `);

      for (const ticket of overdueTickets) {
        const nextTier = ticket.current_tier + 1;
        // Determine next role assignment
        const [nextRule] = await db.query(
          "SELECT assigned_role_id FROM ticket_escalation_rules WHERE tier_level = ?",
          [nextTier],
        );
        const nextRoleId =
          nextRule.length > 0 ? nextRule[0].assigned_role_id : 1;

        // Escalate the ticket
        await db.query(
          `UPDATE complaints
         SET current_tier = ?, assigned_role_id = ?, status = 'pending', last_escalated_at = NOW()
         WHERE id = ?`,
          [nextTier, nextRoleId, ticket.id],
        );

        console.log(
          `🔺 Ticket #${ticket.id} escalated from Tier ${ticket.current_tier} → Tier ${nextTier}`,
        );

        // Send escalation email
        if (nextTier === 2) {
          // Escalated to Operations Head
          await sendOpsEscalationEmail({
            id: ticket.id,
            name: ticket.name,
            email: ticket.email,
            subject: ticket.subject || "Support Request",
            message: ticket.message,
          });
        } else if (nextTier === 3) {
          // Escalated to Management
          await emailService.sendManagementEscalationEmail({
            id: ticket.id,
            name: ticket.name,
            email: ticket.email,
            subject: ticket.subject || "Support Request",
            message: ticket.message,
          });
        }
      }
    } catch (err) {
      console.error("❌ ESCALATION CRON ERROR:", err.message);
    }
  },
  5 * 60 * 1000,
);

// 📹 THEORY VIDEOS API

; // stripped /api/theory-videos


// Create score_sheets table if not exists
(async () => {
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS score_sheets (
        id INT AUTO_INCREMENT PRIMARY KEY,
        sport VARCHAR(100) NOT NULL,
        student_name VARCHAR(255) NOT NULL,
        grade VARCHAR(50),
        class_section VARCHAR(100),
        coach VARCHAR(255),
        uploaded_by INT,
        school_id INT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await db.query(`
      CREATE TABLE IF NOT EXISTS score_sheet_assessments (
        id INT AUTO_INCREMENT PRIMARY KEY,
        score_sheet_id INT NOT NULL,
        parameter_name VARCHAR(255) NOT NULL,
        tick_value VARCHAR(10) DEFAULT NULL,
        marks INT DEFAULT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (score_sheet_id) REFERENCES score_sheets(id) ON DELETE CASCADE
      )
    `);
    try {
      await db.query(
        "ALTER TABLE score_sheet_assessments MODIFY COLUMN marks VARCHAR(1000) DEFAULT NULL",
      );
    } catch (alterErr) {
      // ignore — column may already be VARCHAR
    }
    console.log("✅ Score Sheet tables ready");
  } catch (err) {
    console.error("Error creating score_sheet tables:", err);
  }
})();
// 📋 SCORE SHEETS API ROUTES

// Upload score sheet Excel — sport is read from the Excel "Sport" column

; // stripped /api/score-sheets/upload


// Get all score sheets (optionally filtered by sport)

; // stripped /api/score-sheets


// Get distinct sports from score_sheets

; // stripped /api/score-sheets/sports


// Delete a score sheet entry

; // stripped /api/score-sheets/:id


// Save observation assessment for a student

; // stripped /api/score-sheets/:id/assessments


// Get assessments for a student

; // stripped /api/score-sheets/:id/assessments


// Get score sheet with assessments for PDF generation

; // stripped /api/score-sheets/:id/full



; // stripped /api/theory-videos


async function createTables() {
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS sports_teams (
        id INT(11) AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        sport VARCHAR(100),
        school_id INT(11),
        coach_id INT(11),
        status VARCHAR(50) DEFAULT 'Preparation',
        description TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (school_id) REFERENCES schools(id),
        FOREIGN KEY (coach_id) REFERENCES users(id)
      )
    `);
    console.log("✅ sports_teams table created");

    await db.query(`
      CREATE TABLE IF NOT EXISTS sports_team_players (
        id INT(11) AUTO_INCREMENT PRIMARY KEY,
        team_id INT(11),
        student_id INT(11),
        assigned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (team_id) REFERENCES sports_teams(id),
        FOREIGN KEY (student_id) REFERENCES students(id)
      )
    `);
    // Fix existing tables that may be missing AUTO_INCREMENT on id
    try {
      await db.query(`ALTER TABLE sports_team_players MODIFY COLUMN id INT(11) NOT NULL AUTO_INCREMENT`);
    } catch (alterErr) { /* already correct, ignore */ }
    console.log("✅ sports_team_players table created");
  } catch (err) {
    console.error("Error creating sports_teams tables:", err);
  }
}

createTables();

// ===============================================================================
// SSGM PRE WEEKLY PLANNER ENDPOINTS
// ===============================================================================
const plannerService = require('../ssgmPreWeeklyPlannerService');

// Assessment Plan File Upload Configuration
const assessmentPlanDir = path.join(__dirname, "uploads", "assessment_plans");
if (!fs.existsSync(assessmentPlanDir)) {
  fs.mkdirSync(assessmentPlanDir, { recursive: true });
}

const assessmentStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, assessmentPlanDir);
  },
  filename: (req, file, cb) => {
    const schoolId = req.body.school_id || "school";
    const ext = path.extname(file.originalname);
    cb(null, `assessment_plan_${schoolId}_${Date.now()}${ext}`);
  },
});

const uploadAssessment = multer({ storage: assessmentStorage });


; // stripped /api/ssgm-pre-weekly-planner/upload-assessment-plan



; // stripped /api/ssgm-pre-weekly-planner/assessment-plan/:school_id



; // stripped /api/ssgm-pre-weekly-planner/assessment-plan-file/:school_id



; // stripped /api/ssgm-pre-weekly-planner/data



; // stripped /api/ssgm-pre-weekly-planner/selection



; // stripped /api/ssgm-pre-weekly-planner/preview-pdf


// 🔑 GET PRE WEEKLY PLANNER CREDENTIALS
// Without user_id: returns every active SSGM with their credential status (for the listing page).
// With user_id: returns the single credential record for that SSGM (password excluded).

; // stripped /api/pre-weekly-planner-credentials


// 🔑 SAVE / UPDATE PRE WEEKLY PLANNER CREDENTIALS (upsert by user_id)
// When updating an existing record, leaving the password blank keeps the stored password.

; // stripped /api/pre-weekly-planner-credentials



; // stripped /api/ssgm-pre-weekly-planner/send-email


// ============================================================
// 🏫 SCHOOL INVENTORY MANAGEMENT APIS
// ============================================================

// Helper: schools assigned to a user (same sources as GET /api/schools)
const getUserAssignedSchoolIds = async (user_id) => {
  const uid = parseInt(user_id) || 0;
  if (uid <= 0) return [];
  const [assignments] = await db.query(
    `
    SELECT school_id FROM assign_school WHERE user_id = ? OR ssgm_id = ?
    UNION
    SELECT school_id FROM lp_assign WHERE user_id = ?
    UNION
    SELECT school_id FROM coach_lesson_tracking WHERE user_id = ?
  `,
    [uid, uid, uid, uid],
  );
  return assignments
    .map((a) => Number(a.school_id))
    .filter((id) => !isNaN(id) && id !== 0);
};

// Helper: a user may access a school's inventory when they are admin-level
// (roles 1 / 7 / 2) or the school is assigned to their account
const assertSchoolInventoryAccess = async (school_id, user_id, role_id) => {
  const rid = parseInt(role_id) || 0;
  if (rid === 1 || rid === 7 || rid === 2) return true;
  const assignedIds = await getUserAssignedSchoolIds(user_id);
  return assignedIds.includes(Number(school_id));
};

// Helper: sanitize + validate variant payloads (numeric, non-negative)
const VARIANT_CONDITIONS = ["Good", "Attention", "Replace/Repair"];

// Helper: sanitize + validate variant payloads (numeric, non-negative)
const sanitizeVariantsPayload = (rawVariants) => {
  if (!Array.isArray(rawVariants)) {
    return { error: "Variants must be an array." };
  }
  const cleaned = [];
  for (const v of rawVariants) {
    const damaged = Number(v.damaged);
    const quantity = Number(v.quantity);
    if (!Number.isInteger(damaged) || damaged < 0) {
      return { error: "Damaged count must be a non-negative whole number." };
    }
    if (!Number.isInteger(quantity) || quantity < 0) {
      return { error: "Quantity must be a non-negative whole number." };
    }
    const size =
      v.size === undefined || v.size === null ? "" : String(v.size).trim();
    const condition = VARIANT_CONDITIONS.includes(v.condition)
      ? v.condition
      : null;
    if (!condition) {
      return {
        error:
          "Condition is required for every variant and must be one of: Good, Attention, Replace/Repair.",
      };
    }
    cleaned.push({
      id: v.id ? Number(v.id) : null,
      size: size === "" ? null : size,
      damaged,
      quantity,
      condition,
    });
  }
  return { cleaned };
};

// 📋 GET SCHOOLS ASSIGNED TO THE LOGGED-IN USER (for inventory module)

; // stripped /api/school-inventory/schools


// 📅 GET DISTINCT REPORT YEARS ACROSS ALL ACCESSIBLE SCHOOLS (for bulk export)

; // stripped /api/school-inventory/all-years


// 🏷️ GET DISTINCT EQUIPMENT NAMES ACROSS MULTIPLE SCHOOLS (for export filter)

; // stripped /api/school-inventory/all-equipments


// 📋 GET INVENTORY EXPORT DATA (equipment + variants for multiple schools)

; // stripped /api/school-inventory/export-data


// 🔁 TRANSFER STOCK BETWEEN SCHOOLS
// Atomic database transaction using the existing inventory architecture.
// Year-only transfer: the source is deducted chronologically across that year's
// monthly rows (January → … → December); the destination receives the same monthly
// distribution so each month stays internally consistent. Only Total Quantity (TQ)
// moves; Damaged (TD) is never transferred.
const normalizeTransferSize = (raw) => {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).trim();
  if (
    s === "" ||
    s === "—" ||
    s.toLowerCase() === "none" ||
    s.toLowerCase() === "no size"
  ) {
    return null;
  }
  return s;
};

const TRANSFER_MONTH_ORDER = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
const TRANSFER_MONTH_INDEX = Object.fromEntries(
  TRANSFER_MONTH_ORDER.map((m, i) => [m, i]),
);
const compareTransferMonths = (a, b) =>
  (TRANSFER_MONTH_INDEX[a] ?? 99) - (TRANSFER_MONTH_INDEX[b] ?? 99);


; // stripped /api/school-inventory/transfer


// 📋 GET SCHOOL INVENTORY (equipment + variants for one school)

; // stripped /api/school-inventory/:schoolId


// 📅 GET DISTINCT REPORT YEARS AVAILABLE FOR A SCHOOL

; // stripped /api/school-inventory/:schoolId/years


// ➕ ADD EQUIPMENT (with variants) TO A SCHOOL'S INVENTORY

; // stripped /api/school-inventory/:schoolId/equipments


// ✏️ UPDATE EQUIPMENT + SYNC ITS VARIANTS (edit existing / add new / remove deleted)

; // stripped /api/school-inventory/equipment/:equipmentId


// ➕ ADD MORE VARIANTS TO AN EXISTING EQUIPMENT

; // stripped /api/school-inventory/equipment/:equipmentId/variants


// 🗑️ DELETE A SINGLE VARIANT

; // stripped /api/school-inventory/variant/:variantId


// 🗑️ DELETE EQUIPMENT (its variants are removed automatically via ON DELETE CASCADE)

; // stripped /api/school-inventory/equipment/:equipmentId


// 📊 GET INVENTORY SUMMARY (equipment × month aggregation for a school/year)

; // stripped /api/school-inventory/:schoolId/summary


// 📊 GET INVENTORY DASHBOARD STATS (current year + accessible schools)

; // stripped /api/inventory/dashboard-stats


// 📊 GET INVENTORY DASHBOARD DETAILS (monthly trend + top categories + low stock + recent orders)

; // stripped /api/inventory/dashboard-details


// ─────────────────────────────────────────────────────────────────────────────
// SSGM Visit Planner API
// ─────────────────────────────────────────────────────────────────────────────

// GET all visits (optionally filtered by user)

; // stripped /api/visit-planner


// GET single visit by id

; // stripped /api/visit-planner/:id


// POST create a new visit

; // stripped /api/visit-planner


// PUT update visit (edit a scheduled visit)

; // stripped /api/visit-planner/:id


// DELETE a visit (only if not completed)

; // stripped /api/visit-planner/:id



  try { require("fs").mkdirSync(PDF_TEMP_DIR,{recursive:true}); } catch {}
};
