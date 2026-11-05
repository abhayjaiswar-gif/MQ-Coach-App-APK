const path = require('path');
const fs = require('fs');
const {
  generateWeeklyReportCardPdf,
  buildWeeklyReportCardHtmlOnly,
} = require('../lib/weeklyReportCardPdf');

function originFromReq(req) {
  const host = req.get('host') || `127.0.0.1:${process.env.PORT || 4000}`;
  // Prefer loopback for puppeteer / self-fetch reliability.
  const loopHost = host.replace(/^\d+\.\d+\.\d+\.\d+/, '127.0.0.1').replace(/^localhost/i, '127.0.0.1');
  const proto = req.protocol || 'http';
  return `${proto}://${loopHost}`;
}

function pdfFilePath(UPLOADS_DIR, school_id, month_year, week_no) {
  const dir = path.join(UPLOADS_DIR, 'weekly_reports');
  const safeMonth = String(month_year).replace(/[^a-zA-Z0-9]+/g, '_');
  const safeWeek = String(week_no).replace(/[^a-zA-Z0-9]+/g, '_');
  const fname = `Weekly_Report_${school_id}_${safeMonth}_${safeWeek}.pdf`;
  return { dir, fname, filePath: path.join(dir, fname) };
}

module.exports = function mountWeeklyReportCardPdf(app, ctx) {
  const { db, UPLOADS_DIR } = ctx;

  app.use(
    '/weekly-report-assets',
    require('express').static(path.join(__dirname, '..', 'assets', 'weekly-report'))
  );

  // Ensure publish always attaches the designed card PDF when the client omits pdf_base64.
  app.post('/api/curriculum/publish-report', async (req, res, next) => {
    try {
      if (!req.body?.pdf_base64 && req.body?.school_id && req.body?.month_year && req.body?.week_no) {
        const origin = `http://127.0.0.1:${process.env.PORT || 4000}`;
        const pdfBuf = await generateWeeklyReportCardPdf({
          school_id: req.body.school_id,
          month_year: req.body.month_year,
          week_no: req.body.week_no,
          origin,
          db,
          uploadsDir: UPLOADS_DIR,
        });
        req.body.pdf_base64 = pdfBuf.toString('base64');
        const { dir, fname, filePath } = pdfFilePath(
          UPLOADS_DIR,
          req.body.school_id,
          req.body.month_year,
          req.body.week_no
        );
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(filePath, pdfBuf);
        console.log(`[weekly-report-pdf] generated for publish -> ${fname}`);
      }
    } catch (err) {
      console.error('[weekly-report-pdf] publish generate failed:', err.message);
      // still allow publish without PDF rather than blocking
    }
    next();
  });

  app.get('/api/curriculum/weekly-report-html', async (req, res) => {
    try {
      const { school_id, month_year, week_no } = req.query;
      if (!school_id || !month_year || !week_no) {
        return res.status(400).json({ success: false, message: 'Missing school_id, month_year or week_no' });
      }
      const origin = originFromReq(req);
      const html = await buildWeeklyReportCardHtmlOnly({
        school_id,
        month_year,
        week_no,
        origin,
        db,
        uploadsDir: UPLOADS_DIR,
      });
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.send(html);
    } catch (err) {
      console.error('weekly-report-html', err);
      res.status(500).json({ success: false, message: err.message || 'Failed to build HTML' });
    }
  });

  app.get('/api/curriculum/weekly-report-pdf', async (req, res) => {
    try {
      const { school_id, month_year, week_no } = req.query;
      if (!school_id || !month_year || !week_no) {
        return res.status(400).json({ success: false, message: 'Missing school_id, month_year or week_no' });
      }
      const origin = `http://127.0.0.1:${process.env.PORT || 4000}`;
      const pdfBuf = await generateWeeklyReportCardPdf({
        school_id,
        month_year,
        week_no,
        origin,
        db,
          uploadsDir: UPLOADS_DIR,
      });

      const { dir, fname, filePath } = pdfFilePath(UPLOADS_DIR, school_id, month_year, week_no);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(filePath, pdfBuf);

      if (String(req.query.format || '').toLowerCase() === 'base64') {
        return res.json({
          success: true,
          filename: fname,
          pdf_base64: pdfBuf.toString('base64'),
        });
      }

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename="${fname}"`);
      res.send(pdfBuf);
    } catch (err) {
      console.error('weekly-report-pdf', err);
      res.status(500).json({ success: false, message: err.message || 'Failed to build PDF' });
    }
  });

  // Public serve of stored (or freshly generated card) PDF — replaces stripped legacy report-pdf.
  app.get('/api/curriculum/report-pdf', async (req, res) => {
    try {
      const { school_id, month_year, week_no } = req.query;
      if (!school_id || !month_year || !week_no) {
        return res.status(400).json({ success: false, message: 'Missing required parameters' });
      }
      const { dir, fname, filePath } = pdfFilePath(UPLOADS_DIR, school_id, month_year, week_no);
      if (!fs.existsSync(filePath)) {
        const origin = `http://127.0.0.1:${process.env.PORT || 4000}`;
        const pdfBuf = await generateWeeklyReportCardPdf({
          school_id,
          month_year,
          week_no,
          origin,
          db,
          uploadsDir: UPLOADS_DIR,
        });
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(filePath, pdfBuf);
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `inline; filename="${fname}"`);
        return res.send(pdfBuf);
      }
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename="${fname}"`);
      fs.createReadStream(filePath).pipe(res);
    } catch (err) {
      console.error('report-pdf', err);
      res.status(500).json({ success: false, message: 'Error serving PDF' });
    }
  });
};
