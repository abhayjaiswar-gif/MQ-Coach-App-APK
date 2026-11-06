const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const jwt = require('jsonwebtoken');
const {
  PDFDocument,
  StandardFonts,
  rgb
} = require('pdf-lib');
module.exports = function mountMatchReports(app, {
  db,
  UPLOADS_DIR
}) {
  let ready;
  function schema() {
    return ready || (ready = db.query(fs.readFileSync(path.join(__dirname, '../migrations/app_match_reports.sql'), 'utf8')).catch(e => {
      ready = null;
      throw e;
    }));
  }
  const wrap = fn => async (req, res, next) => {
    try {
      await schema();
      await fn(req, res);
    } catch (e) {
      if (e.status) return res.status(e.status).json({
        success: false,
        message: e.message
      });
      next(e);
    }
  };
  const fail = (message, status = 400) => Object.assign(new Error(message), {
    status
  });
  const parse = v => {
    if (Array.isArray(v)) return v;
    try {
      return JSON.parse(v || '[]');
    } catch {
      return [];
    }
  };
  const num = v => Number(v);
  const privileged = u => [1, 2, 7].includes(Number(u.role_id));
  async function identity(req) {
    const [[u]] = await db.query('SELECT id,role_id FROM users WHERE id=?', [req.user?.id]);
    if (!u) throw fail('Login required', 401);
    return u;
  }
  async function scope(u) {
    if (privileged(u)) return null;
    const [r] = await db.query(`SELECT school_id FROM assign_school WHERE user_id=? OR ssgm_id=? UNION SELECT school_id FROM lp_assign WHERE user_id=? UNION SELECT school_id FROM coach_lesson_tracking WHERE user_id=?`, [u.id, u.id, u.id, u.id]);
    return r.map(x => Number(x.school_id)).filter(Boolean);
  }
  async function schoolAccess(u, id) {
    const s = await scope(u);
    if (!Number.isInteger(Number(id)) || Number(id) < 1) throw fail('Choose a school');
    if (s && !s.includes(Number(id))) throw fail('School access denied', 403);
    const [[school]] = await db.query('SELECT id,name FROM schools WHERE id=?', [id]);
    if (!school) throw fail('School not found', 404);
    return school;
  }
  const select = `SELECT mr.*,s.name school_name,d.sport,d.home_team_id,d.home_team_name,d.away_team_id,d.away_team_name,d.home_score,d.away_score,d.venue,d.notes,d.player_ids,d.photos,d.updated_at FROM match_report_card mr JOIN schools s ON s.id=mr.school_id LEFT JOIN app_match_report_details d ON d.report_id=mr.id`;
  function format(r, u) {
    r.structured = !!r.home_team_name;
    if (r.match_date instanceof Date) r.match_date = r.match_date.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
    r.player_ids = parse(r.player_ids);
    r.photos = parse(r.photos);
    r.result = !r.structured ? 'UPLOADED' : r.home_score > r.away_score ? 'WIN' : r.home_score < r.away_score ? 'LOSS' : 'DRAW';
    r.can_edit = privileged(u) || Number(r.user_id) === Number(u.id);
    return r;
  }
  async function report(u, id, write = false) {
    if (!/^\d+$/.test(String(id))) throw fail('Invalid report ID');
    const [[r]] = await db.query(select + ' WHERE mr.id=?', [id]);
    if (!r) throw fail('Report not found', 404);
    await schoolAccess(u, r.school_id);
    if (write && !privileged(u) && Number(r.user_id) !== Number(u.id)) throw fail('Only the author can edit this report', 403);
    return format(r, u);
  }
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
      fileSize: 10 * 1024 * 1024,
      files: 7,
      fields: 25
    },
    fileFilter: (_req, f, cb) => {
      const allowed = f.fieldname === 'report' ? f.mimetype === 'application/pdf' : ['image/jpeg', 'image/png', 'image/webp'].includes(f.mimetype);
      cb(allowed ? null : new Error('Use a PDF report or JPEG, PNG or WebP photos'), allowed);
    }
  }).fields([{
    name: 'report',
    maxCount: 1
  }, {
    name: 'photos',
    maxCount: 6
  }]);
  const multipart = (req, res, next) => upload(req, res, e => e ? res.status(400).json({
    success: false,
    message: e.message
  }) : next());
  function checkedFiles(req) {
    const files = [...(req.files?.report || []), ...(req.files?.photos || [])];
    for (const f of files) {
      const b = f.buffer;
      const valid = f.fieldname === 'report' ? b.subarray(0, 5).toString() === '%PDF-' : b[0] === 0xff && b[1] === 0xd8 || b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) || b.subarray(0, 4).toString() === 'RIFF' && b.subarray(8, 12).toString() === 'WEBP';
      if (!valid) throw fail('Invalid PDF or photo content');
    }
    return files;
  }
  async function payload(req, u, old) {
    const b = req.body;
    const school = await schoolAccess(u, b.school_id || old?.school_id);
    const date = String(b.match_date || '').slice(0, 10) || new Date().toLocaleDateString('en-CA', {
      timeZone: 'Asia/Kolkata'
    });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(new Date(date + 'T00:00:00Z').getTime()) || new Date(date + 'T00:00:00Z').toISOString().slice(0, 10) !== date) throw fail('Use a valid match date (YYYY-MM-DD)');
    const structured = b.structured === 'true' || b.structured === true || !!old?.structured;
    let d = null;
    if (structured) {
      const homeId = b.home_team_id ? num(b.home_team_id) : null,
        awayId = b.away_team_id ? num(b.away_team_id) : null;
      const lookup = async (id, name) => {
        if (id) {
          const [[t]] = await db.query('SELECT id,name,sport FROM teams WHERE id=? AND school_id=?', [id, school.id]);
          if (!t) throw fail('Team must belong to the chosen school');
          return t;
        }
        const n = String(name || '').trim();
        if (!n || n.length > 255) throw fail('Choose or name both teams');
        return {
          id: null,
          name: n
        };
      };
      const h = await lookup(homeId, b.home_team_name),
        a = await lookup(awayId, b.away_team_name);
      if (h.name.toLowerCase() === a.name.toLowerCase() || h.id && h.id === a.id) throw fail('Choose two different teams');
      const scores = [num(b.home_score), num(b.away_score)];
      if (scores.some(x => !Number.isInteger(x) || x < 0 || x > 9999)) throw fail('Scores must be whole numbers from 0 to 9999');
      const sport = String(b.sport || h.sport || '').trim();
      if (!sport || sport.length > 100) throw fail('Choose a sport');
      const rawPlayers = parse(b.player_ids);
      if (!Array.isArray(rawPlayers)) throw fail('Invalid player selection');
      const ids = [...new Set(rawPlayers.map(Number))];
      if (ids.length > 200 || ids.some(x => !Number.isInteger(x) || x <= 0)) throw fail('Invalid players');
      if (ids.length) {
        const [players] = await db.query('SELECT id FROM students WHERE school_id=? AND id IN (?)', [school.id, ids]);
        if (players.length !== ids.length) throw fail('Players must belong to the selected school');
      }
      const retained = parse(b.retained_photos);
      if (!Array.isArray(retained)) throw fail('Invalid retained photos');
      if (retained.some(x => !(old?.photos || []).includes(x))) throw fail('Invalid retained photo');
      if (retained.length + (req.files?.photos?.length || 0) > 6) throw fail('Up to six photos per match');
      d = {
        sport,
        home_team_id: h.id,
        home_team_name: h.name,
        away_team_id: a.id,
        away_team_name: a.name,
        home_score: scores[0],
        away_score: scores[1],
        venue: String(b.venue || '').trim().slice(0, 255),
        notes: String(b.notes || '').trim().slice(0, 10000),
        player_ids: JSON.stringify(ids),
        photos: retained
      };
    }
    const files = checkedFiles(req);
    if (!d && !req.files?.report?.length && !old?.file_path) throw fail('Select a PDF report');
    return {
      school,
      date,
      d,
      files
    };
  }
  function saveFiles(files) {
    const dir = path.join(UPLOADS_DIR, 'match_reports');
    fs.mkdirSync(dir, {
      recursive: true
    });
    const saved = [];
    try {
      for (const f of files) {
        const ext = f.fieldname === 'report' ? '.pdf' : f.mimetype === 'image/png' ? '.png' : f.mimetype === 'image/webp' ? '.webp' : '.jpg';
        const rel = 'match_reports/' + crypto.randomUUID() + ext;
        fs.writeFileSync(path.join(UPLOADS_DIR, rel), f.buffer);
        saved.push({
          rel,
          field: f.fieldname
        });
      }
      return saved;
    } catch (e) {
      cleanup(saved.map(x => x.rel));
      throw e;
    }
  }
  function cleanup(files) {
    for (const f of files) {
      if (/^match_reports\/[a-f0-9-]+\.(pdf|png|webp|jpg)$/.test(f)) try {
        fs.unlinkSync(path.join(UPLOADS_DIR, f));
      } catch {}
    }
  }
  async function persist(req, res, edit) {
    const u = await identity(req);
    const old = edit ? await report(u, req.params.id, true) : null;
    const p = await payload(req, u, old);
    const saved = saveFiles(p.files);
    let reportFile = saved.find(x => x.field === 'report')?.rel || old?.file_path || '';
    const photos = saved.filter(x => x.field === 'photos').map(x => x.rel);
    // Materialize native scorecards too, so the shared web registry can open them.
    if (p.d) {
      try {
        const native = { ...p.d, school_id: p.school.id, school_name: p.school.name, match_date: p.date, player_ids: parse(p.d.player_ids), photos: [...p.d.photos, ...photos] };
        native.result = native.home_score > native.away_score ? 'WIN' : native.home_score < native.away_score ? 'LOSS' : 'DRAW';
        const bytes = await makePdf(native);
        reportFile = 'match_reports/' + crypto.randomUUID() + '.pdf';
        fs.writeFileSync(path.join(UPLOADS_DIR, reportFile), bytes);
        saved.push({ rel: reportFile, field: 'report' });
      } catch (e) { cleanup(saved.map(x => x.rel)); throw e; }
    }
    const conn = await db.getConnection();
    let id = old?.id;
    try {
      await conn.beginTransaction();
      if (edit) await conn.query('UPDATE match_report_card SET school_id=?,match_date=?,file_path=? WHERE id=?', [p.school.id, p.date, reportFile, id]);else {
        const [r] = await conn.query('INSERT INTO match_report_card(school_id,user_id,file_path,match_date) VALUES(?,?,?,?)', [p.school.id, u.id, reportFile, p.date]);
        id = r.insertId;
      }
      if (p.d) {
        const d = p.d;
        await conn.query(`INSERT INTO app_match_report_details (report_id,sport,home_team_id,home_team_name,away_team_id,away_team_name,home_score,away_score,venue,notes,player_ids,photos) VALUES(?,?,?,?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE sport=VALUES(sport),home_team_id=VALUES(home_team_id),home_team_name=VALUES(home_team_name),away_team_id=VALUES(away_team_id),away_team_name=VALUES(away_team_name),home_score=VALUES(home_score),away_score=VALUES(away_score),venue=VALUES(venue),notes=VALUES(notes),player_ids=VALUES(player_ids),photos=VALUES(photos)`, [id, d.sport, d.home_team_id, d.home_team_name, d.away_team_id, d.away_team_name, d.home_score, d.away_score, d.venue, d.notes, d.player_ids, JSON.stringify([...d.photos, ...photos])]);
      }
      await conn.commit();
      res.json({
        success: true,
        reportId: id,
        id
      });
    } catch (e) {
      await conn.rollback();
      cleanup(saved.map(x => x.rel));
      throw e;
    } finally {
      conn.release();
    }
  }
  app.get('/api/match-reports', wrap(async (req, res) => {
    const u = await identity(req),
      ids = await scope(u);
    const params = [];
    let sql = select;
    if (ids) {
      if (!ids.length) return res.json({
        success: true,
        reports: []
      });
      sql += ' WHERE mr.school_id IN (?)';
      params.push(ids);
    }
    sql += ' ORDER BY mr.created_at DESC,mr.id DESC';
    const [rows] = await db.query(sql, params);
    res.json({
      success: true,
      reports: rows.map(r => format(r, u))
    });
  }));
  app.get('/api/match-reports/options', wrap(async (req, res) => {
    const u = await identity(req);
    await schoolAccess(u, req.query.school_id);
    const [teams] = await db.query('SELECT id,name,sport FROM teams WHERE school_id=? ORDER BY name', [req.query.school_id]);
    const [players] = await db.query('SELECT id,name,std,division FROM students WHERE school_id=? AND (status=1 OR status IS NULL) ORDER BY name', [req.query.school_id]);
    res.json({
      success: true,
      teams,
      players
    });
  }));
  app.get('/api/match-reports/:id', wrap(async (req, res) => {
    const u = await identity(req),
      r = await report(u, req.params.id);
    r.players = [];
    if (r.player_ids.length) {
      const [players] = await db.query('SELECT id,name,std,division FROM students WHERE school_id=? AND id IN (?)', [r.school_id, r.player_ids]);
      r.players = players;
    }
    res.json({
      success: true,
      report: r
    });
  }));
  app.post('/api/match-reports', multipart, wrap((req, res) => persist(req, res, false)));
  app.put('/api/match-reports/:id', multipart, wrap((req, res) => persist(req, res, true)));
  app.post('/api/match-reports/:id/edit', multipart, wrap((req, res) => persist(req, res, true)));
  app.delete('/api/match-reports/:id', wrap(async (req, res) => {
    const u = await identity(req),
      r = await report(u, req.params.id, true);
    const c = await db.getConnection();
    try {
      await c.beginTransaction();
      await c.query('DELETE FROM app_match_report_details WHERE report_id=?', [r.id]);
      await c.query('DELETE FROM match_report_card WHERE id=?', [r.id]);
      await c.commit();
    } catch (e) {
      await c.rollback();
      throw e;
    } finally {
      c.release();
    } // shared legacy files intentionally retained; never delete web-owned media
    res.json({
      success: true
    });
  }));
  app.get('/api/match-reports/:id/pdf-link', wrap(async (req, res) => {
    const u = await identity(req),
      r = await report(u, req.params.id);
    const token = jwt.sign({
      purpose: 'match-report-download',
      report_id: r.id,
      id: u.id
    }, process.env.JWT_SECRET, {
      expiresIn: '5m'
    });
    res.json({
      success: true,
      path: `/api/match-report-pdf/${r.id}?token=${encodeURIComponent(token)}`
    });
  }));
  app.get('/api/match-report-pdf/:id', wrap(async (req, res) => {
    let claim;
    try {
      claim = jwt.verify(req.query.token || '', process.env.JWT_SECRET);
    } catch {
      throw fail('Download link expired. Open PDF again from the app.', 401);
    }
    if (claim.purpose !== 'match-report-download' || String(claim.report_id) !== req.params.id) throw fail('Invalid download link', 403);
    const u = await identity({
        user: {
          id: claim.id
        }
      }),
      r = await report(u, req.params.id);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="Match_Report_${r.id}.pdf"`);
    res.setHeader('Cache-Control', 'private, no-store');
    if (r.file_path) {
      const abs = path.resolve(UPLOADS_DIR, r.file_path);
      if (!abs.startsWith(path.resolve(UPLOADS_DIR) + path.sep)) throw fail('Invalid PDF path');
      if (!fs.existsSync(abs)) throw fail('Original uploaded PDF is missing from this server', 404);
      return res.sendFile(abs);
    }
    if (!r.structured) throw fail('No PDF uploaded for this report', 404);
    const bytes = await makePdf(r);
    res.send(Buffer.from(bytes));
  }));
  async function makePdf(r) {
    const pdf = await PDFDocument.create();
    const regular = await pdf.embedFont(StandardFonts.Helvetica),
      bold = await pdf.embedFont(StandardFonts.HelveticaBold);
    let page, y;
    const safe = t => String(t ?? '').replace(/[^\x20-\x7e]/g, ' ');
    function add() {
      page = pdf.addPage([595.28, 841.89]);
      page.drawRectangle({
        x: 0,
        y: 765,
        width: 596,
        height: 77,
        color: rgb(.07, .24, .17)
      });
      page.drawText('MARCOS QUAY  /  MATCH REPORT', {
        x: 36,
        y: 798,
        size: 18,
        font: bold,
        color: rgb(1, 1, 1)
      });
      y = 735;
    }
    function text(t, size = 12, weight = false) {
      const words = safe(t).split(/\s+/);
      let line = '';
      for (const w of words) {
        if ((weight ? bold : regular).widthOfTextAtSize(line + ' ' + w, size) > 520 && line) {
          draw(line);
          line = w;
        } else line += (line ? ' ' : '') + w;
      }
      if (line) draw(line);
      function draw(s) {
        if (y < 50) add();
        page.drawText(s, {
          x: 36,
          y,
          size,
          font: weight ? bold : regular,
          color: rgb(.12, .17, .15)
        });
        y -= size + 7;
      }
    }
    add();
    text(r.school_name, 18, true);
    text(`${String(r.match_date).slice(0, 10)} | ${r.sport} | ${r.venue || 'Venue not specified'}`);
    y -= 16;
    text(`${r.home_team_name}  ${r.home_score} : ${r.away_score}  ${r.away_team_name}`, 20, true);
    text(`Result: ${r.result} (home team)`);
    y -= 12;
    text('Match notes', 14, true);
    text(r.notes || 'No notes added.');
    y -= 14;
    text('Players', 14, true);
    if (r.player_ids.length) {
      const [players] = await db.query('SELECT name,std,division FROM students WHERE school_id=? AND id IN (?)', [r.school_id, r.player_ids]);
      for (const p of players) text(`${p.name} - ${p.std} ${p.division}`);
    } else text('No players selected.');
    for (const rel of r.photos) {
      if (!/^match_reports\/[a-f0-9-]+\.(png|jpg|webp)$/.test(rel) || rel.endsWith('.webp')) continue;
      const abs = path.join(UPLOADS_DIR, rel);
      if (!fs.existsSync(abs)) continue;
      const b = fs.readFileSync(abs);
      const img = rel.endsWith('.png') ? await pdf.embedPng(b) : await pdf.embedJpg(b);
      const scale = Math.min(520 / img.width, 500 / img.height);
      const w = img.width * scale,
        h = img.height * scale;
      if (y < h + 60) add();
      y -= h;
      page.drawImage(img, {
        x: 36,
        y,
        width: w,
        height: h
      });
      y -= 20;
    }
    return pdf.save();
  }
};
