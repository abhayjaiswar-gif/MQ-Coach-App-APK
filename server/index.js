const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const multer = require('multer');

const db = require('./db');
const { requireAuth } = require('./middleware/auth');
const mountLegacy = require('./lib/legacyMount');
const mountWeeklyReportCardPdf = require('./routes/weeklyReportCardPdf');

const PORT = Number(process.env.PORT) || 4000;
const UPLOADS_DIR = process.env.UPLOADS_DIR || path.join(__dirname, 'uploads');
const PDF_TEMP_DIR = process.env.PDF_TEMP_DIR
  ? path.resolve(__dirname, process.env.PDF_TEMP_DIR)
  : path.join(__dirname, 'tmp', 'pdf');

fs.mkdirSync(PDF_TEMP_DIR, { recursive: true });
fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const app = express();
app.use(cors());
app.use(morgan('dev'));
app.use(express.json({ limit: '25mb' }));
app.use(express.urlencoded({ extended: true, limit: '25mb' }));

// Shared media folder with MQ-Coach-App so existing images keep working.
app.use('/uploads', express.static(UPLOADS_DIR));
app.use('/files', express.static(path.join(UPLOADS_DIR, '..', 'files')));

// Require a valid login token on every /api route except login/refresh/logout and browser-opened PDFs/templates.
app.use('/api', requireAuth);

const ctx = { db, UPLOADS_DIR, PDF_TEMP_DIR, upload: null, socialUpload: null };
mountWeeklyReportCardPdf(app, ctx);
mountLegacy(app, ctx);

// Feature organisers (documentation + future splits)
['auth','dashboard','schools','gallery','achievements','curriculum','teams','sdp','students','attendance','fillMarks','reports','weeklyReport','helpdesk']
  .forEach((name) => require(`./routes/${name}`)(app, ctx));

app.get('/health', (_req, res) => res.json({ ok: true, service: 'myapp-server', port: PORT }));

app.use((err, _req, res, _next) => {
  console.error('UNHANDLED', err);
  res.status(500).json({ success: false, message: err.message || 'Server error' });
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`MyApp API running on http://localhost:${PORT}`);
    console.log(`Uploads: ${UPLOADS_DIR}`);
  });
}

module.exports = app;

