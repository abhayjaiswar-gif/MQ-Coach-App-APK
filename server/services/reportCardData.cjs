// Phase 4 — Fitness report DATA endpoint service.
//
// Public report access requires the Phase 3 temporary report access token
// (Authorization: Bearer <token>); the raw report_key alone is NEVER enough.
// result_id / student_id / school_id / std / division are never accepted from
// the client — everything is derived from the exact report_key string.
//
// Data relationships (forensic baseline §5, §9):
//   fitness_test_report_access.result_id → fitness_test_results
//   fitness_test_results.student_id     → students
//   fitness_test_results.format_id      → fitness_test_format_parameters → parameter_info
//   fitness_test_result_values          → parameter_id → parameter_info
//   parameter_grades                    → (parameter, std) grade bands
//
// Legacy graph behavior preserved (graph_creator.php):
//   - terms matched as lowercase 'term1'/'term2' (variants normalized at the
//     API boundary only; display uses "Term 1"/"Term 2")
//   - both-term pairing: parameters only count as graphable when the STUDENT
//     has both term results (legacy array_filter keeps only items with both
//     terms keys)
//   - missing parameter values → COALESCE 0
//   - class average = ROUND(AVG(CASE term...),2) scoped std+division+format,
//     per parameter, per term; missing param → student value + 5 fallback
//   - parameter_grades ORDER BY min_score; grade bands used by the graphs
//   - value formatting: Speed → ×100 1 decimal; Integer/Whole → round;
//     Decimal (non-speed) → round (mirrored in src/view... fitnessReportGraphs.ts)
//   - chart_format comes from parameter_info.chart_format (DB-driven dispatch)
const db = require("../db");
const reportAccessOtp = require("./reportAccessOtp.cjs");

const GRADE_COLORS = ["#ff6b6b", "#f7e97e", "#8fd19e", "#6f79b8"];

function httpError(status, code, message) {
  const body = { success: false, code, message };
  const err = new Error(message);
  err.status = status;
  err.body = body;
  return err;
}

// Legacy normalizeTerm: the graph code matches ONLY 'term1'/'term2'. Schema
// enum also allows 'Term 1','Term 2','TERM 1','TERM 2' — normalize at the API
// boundary so nothing else propagates; the front-end displays "Term 1"/"Term 2".
function normalizeTerm(raw) {
  const t = String(raw || "").trim().toLowerCase().replace(/\s+/g, "");
  if (t === "term1") return "term1";
  if (t === "term2") return "term2";
  return t;
}

const isLowerTerm = (t) => t === "term1" || t === "term2";

function num(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// Legacy value formatting (graph_creator.php formatValue/formatByCType).
// Mirrored in src/views/reportcard/utils/fitnessReportGraphs.ts — keep in sync.
function formatLegacyValue(value, ctype, title) {
  if (value === null || value === undefined || Number.isNaN(value)) return value;
  const isSpeed = typeof title === "string" && title.toLowerCase() === "speed";
  if (isSpeed) return (Number(value) * 100).toFixed(1);
  return String(Math.round(Number(value)));
}

async function resolveAccessRow(reportKey) {
  const resolved = await reportAccessOtp.resolveReport(reportKey);
  return resolved; // { ok, access, result, student } | httpError
}

// Grade bands for (parameter, std), sorted by min_score (legacy ORDER BY).
async function fetchGrades(parameterName, std) {
  const [rows] = await db.query(
    "SELECT min_score, max_score, grade, grade_label FROM parameter_grades WHERE `parameter` = ? AND std = ? ORDER BY min_score",
    [String(parameterName || ""), String(std)],
  );
  return rows.map((r) => ({
    min_score: num(r.min_score),
    max_score: num(r.max_score),
    grade: r.grade ?? null,
    grade_label: r.grade_label ?? null,
  }));
}

async function fetchReportData(reportKey, token) {
  const key = String(reportKey || "").trim();
  if (!key) throw httpError(400, "REPORT_KEY_REQUIRED", "Report key is required");

  const perfT0 = Date.now();
  const perfs = {};
  let perfPrev = perfT0;
  function perfMark(key) {
    const now = Date.now();
    perfs[key] = now - perfPrev;
    perfPrev = now;
  }

  const resolved = await resolveAccessRow(key);
  if (!resolved.ok) throw resolved;

  const { access, result, student } = resolved;

  // result/student existence was already confirmed by resolveReport; bind the
  // Phase 3 grant to the exact report_key + result_id.
  const grant = await reportAccessOtp.validateAccessToken(key, token);
  if (!grant.valid) {
    throw httpError(401, "ACCESS_TOKEN_INVALID", "Report access token is missing, invalid or expired. Please verify again.");
  }
  if (Number(grant.result_id) !== Number(access.result_id)) {
    throw httpError(401, "ACCESS_TOKEN_INVALID", "The access token does not belong to this report.");
  }
  perfMark("resolveGrant");

  // ── All results for (student, format, academic_year) → term1/term2 ──
  const [resultRows] = await db.query(
    `SELECT id, format_id, term, academic_year, test_date, examiner_name, pdf_file_name, pdf_status
     FROM fitness_test_results
     WHERE student_id = ? AND format_id = ? AND academic_year = ?
     ORDER BY id`,
    [result.student_id, result.format_id, result.academic_year],
  );
  perfMark("termRows");
  const byTerm = {};
  for (const row of resultRows) {
    if (isLowerTerm(row.term)) byTerm[row.term] = row;
    else if (!isLowerTerm(row.term)) {
      const norm = normalizeTerm(row.term);
      if (norm === "term1" || norm === "term2") byTerm[norm] = row;
    }
  }
  const term1Row = byTerm.term1 || null;
  const term2Row = byTerm.term2 || null;

  // ── Format parameters (DB-driven, ordered) ──
  const [paramRows] = await db.query(
    `SELECT pi.id AS parameter_id, pi.title, pi.description, pi.video_link, pi.ctype, pi.clabel,
            pi.chart_format, pi.chart_heading, pi.parameter AS parameter_key,
            pi.test_display, fp.parameter_order, fp.is_required
     FROM fitness_test_format_parameters fp
     JOIN parameter_info pi ON fp.parameter_id = pi.id
     WHERE fp.format_id = ?
     ORDER BY fp.parameter_order`,
    [result.format_id],
  );
  perfMark("formatParams");

  // ── Result values for the two term results (COALESCE semantics: 0 if absent) ──
  const termIds = [term1Row && term1Row.id, term2Row && term2Row.id].filter(Boolean);
  const valueMap = {}; // result_id -> param_id -> value
  if (termIds.length) {
    const [valueRows] = await db.query(
      `SELECT result_id, parameter_id, parameter_value
       FROM fitness_test_result_values
       WHERE result_id IN (${termIds.map(() => "?").join(",")})`,
      termIds,
    );
    for (const v of valueRows) {
      if (!valueMap[v.result_id]) valueMap[v.result_id] = {};
      valueMap[v.result_id][v.parameter_id] = v.parameter_value;
    }
  }
  perfMark("values");
  const valueOf = (resultRow, parameterId) => {
    if (!resultRow) return 0;
    const pv = valueMap[resultRow.id] && valueMap[resultRow.id][parameterId];
    return pv === undefined ? 0 : num(pv);
  };

  // ── Class averages (legacy SQL behavior, scoped std+division+format) ──
  const [avgRows] = await db.query(
    `SELECT ftrv.parameter_id,
            ROUND(AVG(CASE WHEN ftr.term = 'term1' THEN ftrv.parameter_value END), 2) AS term1_avg,
            ROUND(AVG(CASE WHEN ftr.term = 'term2' THEN ftrv.parameter_value END), 2) AS term2_avg
     FROM fitness_test_results ftr
     JOIN fitness_test_result_values ftrv ON ftr.id = ftrv.result_id
     JOIN students s ON s.id = ftr.student_id
     WHERE s.std = ? AND s.division = ? AND ftr.format_id = ?
       AND ftr.term IN ('term1','term2')
     GROUP BY ftrv.parameter_id`,
    [student.std, student.division, result.format_id],
  );
  perfMark("classAverages");
  const avgLookup = {};
  for (const a of avgRows) avgLookup[a.parameter_id] = a;

  // ── Assemble parameters ──
  const parameters = [];
  for (const p of paramRows) {
    const t1 = valueOf(term1Row, p.parameter_id);
    const t2 = valueOf(term2Row, p.parameter_id);
    const avg = avgLookup[p.parameter_id];
    const class1 = avg && avg.term1_avg !== null ? num(avg.term1_avg) : null;
    const class2 = avg && avg.term2_avg !== null ? num(avg.term2_avg) : null;
    // Legacy fallback: when no class average row exists for the parameter, the
    // graph used the student's own term value + 5 (never 0 / null / global).
    const fb1 = class1 !== null ? class1 : (t1 ?? 0) + 5;
    const fb2 = class2 !== null ? class2 : (t2 ?? 0) + 5;
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
      is_speed: String(p.title || "").toLowerCase() === "speed",
      student: { term1: t1, term2: t2 },
      class_average: { term1: fb1, term2: fb2 },
      grades: await fetchGrades(p.parameter_key, student.std),
      has_both_terms: Boolean(term1Row && term2Row),
    });
  }
  perfMark("parameterLoopGrades");

  // ── Format display metadata ──
  const [formatRows] = await db.query(
    "SELECT test_name, test_title FROM fitness_test_formats WHERE id = ?",
    [result.format_id],
  );
  const formatMeta = formatRows[0] || {};
  perfMark("formatMeta");

  const perfTotal = Date.now() - perfT0;
  console.log(
    `[REPORT-DATA-TIMING] fetchReportData TOTAL=${perfTotal}ms ` +
      `resolveGrant=${perfs.resolveGrant}ms termRows=${perfs.termRows}ms ` +
      `formatParams=${perfs.formatParams}ms values=${perfs.values}ms ` +
      `classAverages=${perfs.classAverages}ms parameterLoopGrades=${perfs.parameterLoopGrades}ms ` +
      `formatMeta=${perfs.formatMeta}ms parameters=${paramRows.length}`,
  );

  return {
    success: true,
    data: {
      report: {
        report_key: access.report_key,
        result_id: access.result_id,
        student_id: student.id,
        student_name: student.name,
        standard: String(student.std),
        division: student.division,
        mq_id: student.mq_id,
        format_id: result.format_id,
        format_test_name: formatMeta.test_name ?? null,
        test_title: formatMeta.test_title ?? null,
        academic_year: result.academic_year,
        term: (term1Row && term2Row)
          ? "term1_and_term2"
          : (term1Row ? "term1" : (term2Row ? "term2" : normalizeTerm(result.term))),
      },
      terms: {
        term1: term1Row
          ? { result_id: term1Row.id, term_label: "Term 1", test_date: term1Row.test_date, examiner_name: term1Row.examiner_name, pdf_file_name: term1Row.pdf_file_name, pdf_status: term1Row.pdf_status }
          : null,
        term2: term2Row
          ? { result_id: term2Row.id, term_label: "Term 2", test_date: term2Row.test_date, examiner_name: term2Row.examiner_name, pdf_file_name: term2Row.pdf_file_name, pdf_status: term2Row.pdf_status }
          : null,
      },
      parameters,
      grade_colors: GRADE_COLORS,
    },
  };
}

module.exports = {
  fetchReportData,
  fetchGrades,
  formatLegacyValue,
  normalizeTerm,
  GRADE_COLORS,
};