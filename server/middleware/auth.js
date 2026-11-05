const jwt = require('jsonwebtoken');

// Public routes that must work without a Bearer token.
const PUBLIC = [
  /^\/api\/login$/,
  /^\/api\/refresh$/,
  /^\/api\/logout$/,
  /^\/api\/fill-marks\/template/, // printable HTML opened in the phone browser
  /^\/api\/reports\/download-single\//, // PDF opened in the phone browser
  /^\/api\/reports\/download-zip/,
  /^\/api\/reports\/detail-pdf\//,
  /^\/api\/curriculum\/weekly-report-pdf$/,
  /^\/api\/curriculum\/weekly-report-html$/,
  /^\/api\/curriculum\/report-pdf$/,
  /^\/weekly-report-assets\//,
  /^\/uploads\//,
  /^\/files\//,
];

function isPublic(req) {
  const full = (req.originalUrl || req.url || '').split('?')[0];
  const stripped = (req.path || '').split('?')[0];
  const candidates = [full, '/api' + (stripped.startsWith('/') ? stripped : '/' + stripped), stripped];
  return PUBLIC.some((re) => candidates.some((p) => re.test(p)));
}

function requireAuth(req, res, next) {
  if (isPublic(req)) return next();
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ success: false, message: 'Login required' });
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    return next();
  } catch {
    return res.status(401).json({ success: false, message: 'Session expired. Please log in again.' });
  }
}

module.exports = { requireAuth, isPublic };

