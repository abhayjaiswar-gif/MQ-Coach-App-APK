/**
 * Canonical Sports-Level resolver.
 *
 * A "Sports Level" is a master-curriculum grade (year_lp_master.grade), e.g.
 * "Grade 1". School grades (curriculum_builder_entries.grade_name) are NOT
 * levels — several school grades can map to the same level, and a school grade
 * can map to a different level (cross-grade mapping).
 *
 * The single source of truth for the level a school is CURRENTLY on is:
 *
 *   curriculum_level_progress
 *     (school_id, school_grade, sport) -> current_level_grade
 *
 * The Builder's level_grade is only the INITIAL configuration. The runtime
 * cursor is advanced by the weekly seeder when a level's LP pool is exhausted.
 *
 * Canonical key = school_id + normalized(school_grade) + sport
 */

const FOUNDATION_ORDER = ["Nursery", "Jr. Kg", "Sr. Kg"];

// Normalize any grade spelling ("1", "Grade 1", "Jr.Kg", "Jr. Kg", ...) to the
// master-curriculum label so school grades and levels line up.
function normGradeName(g) {
  const t = String(g || "").trim();
  const low = t
    .toLowerCase()
    .replace(/[.\s]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (low.startsWith("nursery")) return "Nursery";
  if (low.startsWith("jr")) return "Jr. Kg";
  if (low.startsWith("sr")) return "Sr. Kg";
  const m = low.match(/^(?:grade\s*)?(\d+)$/) || low.match(/^(\d+)$/);
  if (m) return "Grade " + parseInt(m[1], 10);
  return t;
}

// Foundation ordering: Nursery -> Jr. Kg -> Sr. Kg -> Grade 1 ... Grade 10.
// Never lexical (which would put "Grade 10" before "Grade 2").
function gradeRank(g) {
  const t = String(g || "")
    .trim()
    .toLowerCase()
    .replace(/[.\s]+/g, " ")
    .trim();
  if (t.startsWith("nursery")) return 1;
  if (t.startsWith("jr")) return 2;
  if (t.startsWith("sr")) return 3;
  const m = (t.match(/grade\s*(\d+)/) || [null, null])[1];
  if (m) return 4 + parseInt(m, 10);
  return 99;
}

// Human display label for a level (matches the frontend builder helper).
function levelLabel(grade) {
  const g = String(grade || "").trim();
  if (!g) return g;
  if (g.toUpperCase() === "NA" || g.toUpperCase() === "N/A") return "NA";
  const m = g.match(/^grade\s*(\d+)$/i) || g.match(/^(\d+)$/);
  if (m) return `Level ${parseInt(m[1], 10)}`;
  if (/nursery/i.test(g)) return "Level Nursery";
  if (/jr\.?\s*kg|junior/i.test(g)) return "Level Jr.Kg";
  if (/sr\.?\s*kg|senior/i.test(g)) return "Level Sr.Kg";
  return g.startsWith("Level") ? g : `Level ${g}`;
}

function isUsableLevel(level) {
  const v = String(level || "").trim().toUpperCase();
  return !!v && v !== "NA" && v !== "N/A";
}

// Read the runtime current level for a canonical key. Returns null when the
// school-grade + sport combination has no cursor yet.
async function getLevelProgress(executor, schoolId, schoolGrade, sport) {
  if (!schoolId || !sport) return null;
  const sg = normGradeName(schoolGrade);
  if (!sg) return null;
  const [rows] = await executor.query(
    `SELECT current_level_grade
       FROM curriculum_level_progress
      WHERE school_id = ? AND school_grade = ? AND sport = ?
      LIMIT 1`,
    [schoolId, sg, sport],
  );
  return rows.length ? rows[0].current_level_grade : null;
}

// Create the cursor from the Builder's initial level_config if missing.
// Ordinary Builder saves must NOT reset an existing runtime cursor, so this is
// INSERT-only on the canonical key (updated_at is refreshed).
async function ensureLevelProgress(executor, schoolId, schoolGrade, sport, levelGrade) {
  if (!schoolId || !sport || !isUsableLevel(levelGrade)) return false;
  const sg = normGradeName(schoolGrade);
  const lg = normGradeName(levelGrade) || String(levelGrade).trim();
  if (!sg || !lg) return false;
  await executor.query(
    `INSERT INTO curriculum_level_progress
       (school_id, school_grade, sport, current_level_grade, current_level_started_at)
     VALUES (?, ?, ?, ?, NOW())
     ON DUPLICATE KEY UPDATE updated_at = CURRENT_TIMESTAMP`,
    [schoolId, sg, sport, lg],
  );
  return true;
}

// Explicitly move the runtime cursor to a specific level (used by the seeder
// when a level's LP pool is exhausted).
async function setLevelProgress(executor, schoolId, schoolGrade, sport, levelGrade) {
  const sg = normGradeName(schoolGrade);
  const lg = normGradeName(levelGrade) || String(levelGrade).trim();
  await executor.query(
    `UPDATE curriculum_level_progress
        SET current_level_grade = ?, current_level_started_at = NOW()
      WHERE school_id = ? AND school_grade = ? AND sport = ?`,
    [lg, schoolId, sg, sport],
  );
}

// Ordered list of available levels for a sport, from year_lp_master, using
// foundation-first numeric ordering.
async function getOrderedLevels(executor, sport) {
  const [rows] = await executor.query(
    `SELECT DISTINCT grade FROM year_lp_master
      WHERE sport = ? AND grade IS NOT NULL AND grade != ''`,
    [sport],
  );
  return rows.map((r) => r.grade).sort((a, b) => gradeRank(a) - gradeRank(b));
}

// Given the ordered levels and the current level, return the next level or null.
function getNextLevel(levels, currentLevel) {
  if (!Array.isArray(levels) || levels.length === 0) return null;
  const curNorm = normGradeName(currentLevel);
  const idx = levels.findIndex((l) => normGradeName(l) === curNorm);
  if (idx >= 0) return idx + 1 < levels.length ? levels[idx + 1] : null;
  const curRank = gradeRank(currentLevel);
  for (const l of levels) {
    if (gradeRank(l) > curRank) return l;
  }
  return null;
}

// Ensure a cursor exists for every configured (school grade + sport) of a
// school. Prefers the latest Builder plan; falls back to published grades and
// then to all master grades so plan-less schools keep their legacy behavior.
async function ensureProgressRowsForSchool(executor, schoolId) {
  if (!schoolId) return 0;
  let created = 0;

  const [plans] = await executor.query(
    `SELECT id FROM curriculum_builder_plans
      WHERE school_id = ? ORDER BY created_at DESC LIMIT 1`,
    [schoolId],
  );

  if (plans.length > 0) {
    const [entries] = await executor.query(
      `SELECT grade_name, sport, level_grade
         FROM curriculum_builder_entries WHERE plan_id = ?`,
      [plans[0].id],
    );
    for (const e of entries) {
      if (await ensureLevelProgress(executor, schoolId, e.grade_name, e.sport, e.level_grade)) {
        created++;
      }
    }
    return created;
  }

  const [published] = await executor.query(
    `SELECT DISTINCT sport, COALESCE(school_grade, grade) AS school_grade, grade FROM year_lp_master_new
      WHERE school_id = ? AND (current_show_status = 0 OR current_show_status IS NULL)
        AND sport IS NOT NULL AND grade IS NOT NULL AND grade != ''`,
    [schoolId],
  );
  if (published.length > 0) {
    for (const r of published) {
      if (await ensureLevelProgress(executor, schoolId, r.school_grade, r.sport, r.grade)) created++;
    }
    return created;
  }

  const [master] = await executor.query(
    `SELECT DISTINCT sport, grade FROM year_lp_master
      WHERE sport IS NOT NULL AND grade IS NOT NULL AND grade != ''`,
  );
  for (const r of master) {
    if (await ensureLevelProgress(executor, schoolId, r.grade, r.sport, r.grade)) created++;
  }
  return created;
}

module.exports = {
  FOUNDATION_ORDER,
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
};
