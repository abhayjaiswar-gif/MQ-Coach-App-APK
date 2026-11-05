const db = require("./db");
const xlsx = require("xlsx");
const path = require("path");
const crypto = require("crypto");
const fs = require("fs");
const { getConfig } = require("./curriculumConfig");

class CurriculumService {
  constructor(programType) {
    this.config = getConfig(programType);
    this.programType = programType;
    this.masterTable = this.config.masterTable;
    this.masterNewTable = this.config.masterNewTable;
    this.idColumn = this.config.idColumn;
  }

  async getLastCurriculumId() {
    const [[lastRow]] = await db.query(
      `SELECT MAX(${this.idColumn}) as last_id FROM ${this.masterTable}`
    );
    return (lastRow && lastRow.last_id ? lastRow.last_id : 0) + 1;
  }

  async importExcel(file, sportName, smartStartStatus) {
    const ext = path.extname(file.originalname).toLowerCase();
    if (![".xlsx", ".xls"].includes(ext)) {
      throw Object.assign(new Error("Only Excel files allowed!"), { code: "INVALID_EXT" });
    }

    const id_indicate_curriculum = await this.getLastCurriculumId();
    const workbook = xlsx.readFile(file.path);
    let inserted = 0;

    for (const sheetName of workbook.SheetNames) {
      const grade = sheetName.trim();
      if (sheetName.toLowerCase().includes("sheet")) continue;

      const sheet = workbook.Sheets[sheetName];
      const rows = xlsx.utils.sheet_to_json(sheet, { header: 1 });
      if (rows.length <= 1) continue;
      rows.shift();

      for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        const lp_no = String(r[0] || "").trim();
        if (!lp_no) continue;

        const uniqueParams = crypto.randomBytes(8).toString("hex");

        await db.query(
          `INSERT INTO ${this.masterTable} 
          (grade, sport, lp_no, skill, sub_skill, objective, teaching_aids, warm_up, 
           skill_implementation, picture, cool_down, summarization, life_skill, created_at, 
           lp_unique_id, id_indicate_curriculum, smart_start_status) 
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?, ?, ?)`,
          [
            grade,
            sportName || "",
            lp_no,
            String(r[1] || "").trim(),
            String(r[2] || "").trim(),
            String(r[3] || "").trim(),
            String(r[4] || "").trim(),
            String(r[5] || "").trim(),
            String(r[6] || "").trim(),
            String(r[7] || "").trim(),
            String(r[8] || "").trim(),
            String(r[9] || "").trim(),
            String(r[10] || "").trim(),
            uniqueParams,
            id_indicate_curriculum,
            smartStartStatus || 0,
          ]
        );
        inserted++;
      }
    }

    return { id_indicate_curriculum, inserted };
  }

  async getCurriculums() {
    const [rows] = await db.query(`
      SELECT
        id_indicate_curriculum,
        sport,
        COUNT(*) as module_count,
        MAX(created_at) as created_at,
        MAX(smart_start_status) as smart_start_status
      FROM ${this.masterTable}
      GROUP BY id_indicate_curriculum, sport
      ORDER BY created_at DESC
    `);
    return rows;
  }

  async getGrades(sport) {
    const [rows] = await db.query(
      `SELECT DISTINCT grade FROM ${this.masterTable} WHERE sport = ? ORDER BY grade ASC`,
      [sport]
    );
    return rows.map((r) => r.grade);
  }

  async getLessonPlans(sport, grade) {
    const [rows] = await db.query(
      `SELECT id, lp_no, sport, grade, skill, sub_skill, objective, warm_up, skill_implementation
       FROM ${this.masterTable} WHERE sport = ? AND grade = ? ORDER BY lp_no ASC, id ASC`,
      [sport, grade]
    );
    return rows;
  }

  async getSports() {
    const [rows] = await db.query(
      `SELECT DISTINCT sport FROM ${this.masterTable} WHERE sport IS NOT NULL AND sport != '' ORDER BY sport ASC`
    );
    return rows.map((r) => r.sport);
  }

  async getSportLessonPlans(sport, grade) {
    const selectFields = `id, lp_unique_id as unique_id, lp_no, sport, grade, skill, sub_skill, objective, warm_up, skill_implementation,
              teaching_aids, cool_down, summarization, life_skill, picture, created_at`;

    let query;
    let params;
    if (grade) {
      query = `SELECT ${selectFields}
       FROM ${this.masterTable}
       WHERE sport = ? AND grade = ?
       ORDER BY CAST(lp_no AS UNSIGNED) ASC, id ASC`;
      params = [sport, grade];
    } else {
      query = `SELECT ${selectFields}
       FROM ${this.masterTable}
       WHERE sport = ?
       ORDER BY CAST(lp_no AS UNSIGNED) ASC, id ASC`;
      params = [sport];
    }

    const [rows] = await db.query(query, params);
    return rows;
  }

  async deleteCurriculum(id) {
    await db.query(
      `DELETE FROM ${this.masterTable} WHERE id_indicate_curriculum = ?`,
      [id]
    );
  }

  async deleteMasterLP(id) {
    await db.query(
      `DELETE FROM ${this.masterTable} WHERE id = ?`,
      [id]
    );
  }
}

module.exports = CurriculumService;
