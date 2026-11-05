const fs = require('fs');
const path = require('path');

const A4_WIDTH = 794;
const A4_HEIGHT = 1123;
const GALLERY_PER_PAGE = 9;
const ASSETS_DIR = path.join(__dirname, '..', 'assets', 'weekly-report');

function esc(v) {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatStatus(status) {
  if (!status) return 'In Progress';
  const s = String(status).toLowerCase();
  if (s === 'complete' || s === 'done' || s === 'completed') return 'Complete';
  return status;
}

function formatGradeDiv(grade, divisions) {
  if (!grade && !divisions) return 'N/A';
  return `${grade || '-'} (${divisions || '-'})`;
}

function formatDate(date) {
  if (!date) return 'TBD';
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return String(date);
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function formatTime(time) {
  if (!time) return '—';
  return String(time).substring(0, 5);
}

function weekLabelOf(weekNo) {
  const w = weekNo || '';
  return /^week/i.test(w) ? w : w ? `Week ${w}` : '';
}

function absUrl(base, p) {
  if (!p) return '';
  if (/^https?:\/\//i.test(p) || p.startsWith('data:')) return p;
  const clean = String(p).startsWith('/') ? p : `/${p}`;
  return `${base.replace(/\/$/, '')}${clean}`;
}

function buildCurriculumRows(reportData) {
  const rows = [];
  (reportData?.sports_reports || []).forEach((report) => {
    if (report.isExtraCard) return;
    (report.key_areas || []).forEach((area) => {
      if (area.is_extra) return;
      if (area.session_type === 'indoor-activity' || area.session_type === 'theory-activity') return;
      rows.push({
        coach_name: area.coach_name || report.coach_name,
        sport: area.sport || report.sport,
        covered_skill: area.name,
        objective: area.objective || 'N/A',
        grade_div: formatGradeDiv(area.grade, area.divisions),
        total_taken: '1 Lecture',
        status: formatStatus(area.status),
        remark: area.remark || 'N/A',
      });
    });
  });
  return rows;
}

function buildTypedRows(reportData, sessionType) {
  const rows = [];
  (reportData?.sports_reports || []).forEach((report) => {
    (report.key_areas || []).forEach((area) => {
      if (area.session_type !== sessionType) return;
      rows.push({
        coach_name: area.coach_name || report.coach_name,
        sport: area.sport || report.sport,
        covered_skill: area.name,
        objective: area.objective || 'N/A',
        grade_div: formatGradeDiv(area.grade, area.divisions),
        total_taken: '1 Lecture',
        status: formatStatus(area.status),
        remark: area.remark || 'N/A',
      });
    });
  });
  return rows;
}

function buildExtraRows(reportData) {
  const rows = [];
  (reportData?.sports_reports || []).forEach((report) => {
    if (!report.isExtraCard) return;
    (report.key_areas || []).forEach((area) => {
      if (area.session_type === 'indoor-activity' || area.session_type === 'theory-activity') return;
      rows.push({
        coach_name: area.coach_name || report.coach_name,
        sport: area.sport || report.sport,
        covered_skill: area.name,
        objective: area.objective || 'N/A',
        grade_div: formatGradeDiv(area.grade, area.divisions),
        status: formatStatus(area.status),
        remark: area.remark || 'N/A',
      });
    });
  });
  return rows;
}

function buildAttendanceRows(reportData) {
  return (reportData?.all_sessions || []).map((session) => ({
    date: formatDate(session.lecture_date || session.date),
    coach_name: session.coach_name || session.coach,
    sport: session.sport,
    time:
      session.start_time && session.end_time
        ? `${formatTime(session.start_time)} - ${formatTime(session.end_time)}`
        : '—',
    grade_div: formatGradeDiv(session.grades || session.grade, session.division || session.divisions),
    status: session.status || 'Done',
  }));
}

function mediaUrl(origin, img) {
  if (!img) return '';
  if (/^https?:\/\//i.test(img) || String(img).startsWith('data:')) return img;
  const pathPart = String(img).startsWith('/uploads/')
    ? img
    : String(img).startsWith('uploads/')
      ? `/${img}`
      : `/uploads/${img}`;
  return `${origin.replace(/\/$/, '')}${pathPart}`;
}

function buildGalleryItems(reportData, origin) {
  const items = [];
  const seen = new Set();
  (reportData?.sports_reports || []).forEach((report) => {
    (report.gallery || []).forEach((img) => {
      if (!seen.has(img)) {
        seen.add(img);
        items.push({ src: mediaUrl(origin, img), caption: report.sport || 'Activity' });
      }
    });
    (report.key_areas || []).forEach((area) => {
      (area.photos || []).forEach((img) => {
        if (!seen.has(img)) {
          seen.add(img);
          items.push({
            src: mediaUrl(origin, img),
            caption: area.name || report.sport || 'Activity',
          });
        }
      });
    });
  });
  return items;
}

function chunk(arr, size) {
  if (!arr.length) return [[]];
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function skillsTable(rows, emptyText) {
  const head = `<thead><tr>
    <th>Coach Name</th><th>Sport</th><th>Covered Skill</th><th>Objective</th>
    <th>Grade/Div</th><th>Total Taken</th><th>Status</th><th>Remark</th>
  </tr></thead>`;
  let body;
  if (!rows.length) {
    body = `<tbody><tr><td colspan="8" class="wrc-empty-cell">${esc(emptyText)}</td></tr></tbody>`;
  } else {
    body = `<tbody>${rows
      .map(
        (r) => `<tr>
      <td>${esc(r.coach_name)}</td><td>${esc(r.sport)}</td><td>${esc(r.covered_skill)}</td>
      <td>${esc(r.objective)}</td><td>${esc(r.grade_div)}</td><td>${esc(r.total_taken)}</td>
      <td>${esc(r.status)}</td><td>${esc(r.remark)}</td>
    </tr>`
      )
      .join('')}</tbody>`;
  }
  return `<div class="wrc-coach-table-wrap"><table class="wrc-coach-table wrc-coach-table--skills">${head}${body}</table></div>`;
}

function theoryTable(rows) {
  const head = `<thead><tr>
    <th>Coach Name</th><th>Sport</th><th>Activity Title</th><th>Objective</th>
    <th>Grade/Div</th><th>Total Taken</th><th>Status</th><th>Remark</th>
  </tr></thead>`;
  const body = `<tbody>${rows
    .map(
      (r) => `<tr>
    <td>${esc(r.coach_name)}</td><td>${esc(r.sport)}</td><td>${esc(r.covered_skill)}</td>
    <td>${esc(r.objective)}</td><td>${esc(r.grade_div)}</td><td>${esc(r.total_taken)}</td>
    <td>${esc(r.status)}</td><td>${esc(r.remark)}</td>
  </tr>`
    )
    .join('')}</tbody>`;
  return `<div class="wrc-coach-table-wrap"><table class="wrc-coach-table wrc-coach-table--theory">${head}${body}</table></div>`;
}

function attendanceTable(rows) {
  const head = `<thead><tr>
    <th>Date</th><th>Coach Name</th><th>Sport</th><th>Time</th><th>Grade/Div</th><th>Status</th>
  </tr></thead>`;
  const body = `<tbody>${rows
    .map(
      (r) => `<tr>
    <td>${esc(r.date)}</td><td>${esc(r.coach_name)}</td><td>${esc(r.sport)}</td>
    <td>${esc(r.time)}</td><td>${esc(r.grade_div)}</td><td>${esc(r.status)}</td>
  </tr>`
    )
    .join('')}</tbody>`;
  return `<div class="wrc-coach-table-wrap"><table class="wrc-coach-table wrc-coach-table--attendance">${head}${body}</table></div>`;
}

function extraTable(rows) {
  const head = `<thead><tr>
    <th>Coach Name</th><th>Sport</th><th>Covered Skill</th><th>Objective</th>
    <th>Grade/Div</th><th>Status</th><th>Remark</th>
  </tr></thead>`;
  const body = `<tbody>${rows
    .map(
      (r) => `<tr>
    <td>${esc(r.coach_name)}</td><td>${esc(r.sport)}</td><td>${esc(r.covered_skill)}</td>
    <td>${esc(r.objective)}</td><td>${esc(r.grade_div)}</td>
    <td>${esc(r.status)}</td><td>${esc(r.remark)}</td>
  </tr>`
    )
    .join('')}</tbody>`;
  return `<div class="wrc-coach-table-wrap"><table class="wrc-coach-table wrc-coach-table--extra">${head}${body}</table></div>`;
}

function section(title, inner) {
  return `<section class="wrc-coaches-section">
    <div class="wrc-coaches-section__head"><h2 class="wrc-coaches-section__title">${esc(title)}</h2></div>
    ${inner}
  </section>`;
}

function coverPage({ weekLabel, dateRangeText, locationText, school, companyLogoUrl, schoolLogoUrl }) {
  const schoolName = school?.name || '';
  const logo = schoolLogoUrl
    ? `<img class="wrc-school-logo" src="${esc(schoolLogoUrl)}" alt="${esc(schoolName)}" />`
    : `<div class="wrc-school-logo-fallback">${esc(schoolName.charAt(0) || 'S')}</div>`;
  const loc = locationText || schoolName;
  return `<div class="wrc-page-scaler wrc-page-scaler--cover">
    <div class="wrc-page-wrapper">
      <article class="wrc-report-page wrc-report-page--cover">
        <div class="wrc-bg-image" aria-hidden="true"></div>
        <svg class="wrc-shapes-layer" viewBox="0 0 794 1123" preserveAspectRatio="none" aria-hidden="true">
          <path d="M0,0 L0,310 C12,288 48,240 112,182 C178,122 262,64 352,26 C404,6 456,0 502,0 L0,0 Z" fill="#ec1c25" />
          <path d="M0,26 L0,268 C28,248 62,204 118,152 C182,96 258,46 340,14 C388,0 434,0 472,0 L0,26 Z" fill="#9d1f25" />
          <path d="M0,26 L0,268 C28,248 62,204 118,152 C182,96 258,46 340,14 C388,0 434,0 472,0" fill="none" stroke="#ffffff" stroke-width="2" opacity="0.9" />
          <path d="M794,1123 L794,362 C656,396 542,518 512,638 C488,748 392,848 278,932 C248,954 228,1018 218,1123 L794,1123 Z" fill="#ec1c25" />
          <path d="M794,1123 L794,388 C664,420 554,536 526,652 C504,756 412,848 308,924 C280,944 262,1002 254,1123 L794,1123 Z" fill="#9d1f25" />
          <path d="M794,388 C664,420 554,536 526,652 C504,756 412,848 308,924 C280,944 262,1002 254,1123" fill="none" stroke="#ffffff" stroke-width="2" opacity="0.9" />
        </svg>
        <header class="wrc-brand-block">
          <img class="wrc-brand-logo" src="${esc(companyLogoUrl)}" alt="Marcos Quay logo" />
        </header>
        <section class="wrc-hero-content">
          <p class="wrc-year-label">${esc(weekLabel)}</p>
          <h1 class="wrc-report-title">
            <span class="wrc-title-line"><span class="wrc-title-black">WEEKLY</span><span class="wrc-title-red"> REPORT</span></span>
            <span class="wrc-title-line wrc-title-black">CARD</span>
          </h1>
          <div class="wrc-school-name-row">
            ${logo}
            <p class="wrc-subtitle">${esc(schoolName)}</p>
          </div>
          <p class="wrc-description">
            ${locationText ? `<span>${esc(locationText)}</span>` : ''}
            ${locationText && dateRangeText ? '<span class="wrc-desc-separator"> • </span>' : ''}
            ${dateRangeText ? `<span>${esc(dateRangeText)}</span>` : ''}${dateRangeText || locationText ? '.' : ''}
            A concise overview of weekly achievements, coach feedback, and highlights from classroom and
            extracurricular activities.
          </p>
        </section>
        <footer class="wrc-page-footer">
          <div class="wrc-footer-item">
            <svg class="wrc-footer-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.5" />
              <path d="M2 12h20M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18" stroke="currentColor" stroke-width="1.5" />
            </svg>
            <span>www.marcosquay.com</span>
          </div>
          <div class="wrc-footer-item">
            <svg class="wrc-footer-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M12 21s7-4.5 7-11a7 7 0 1 0-14 0c0 6.5 7 11 7 11z" stroke="currentColor" stroke-width="1.5" />
              <circle cx="12" cy="10" r="2.5" stroke="currentColor" stroke-width="1.5" />
            </svg>
            <span>${esc(loc)}</span>
          </div>
        </footer>
      </article>
    </div>
  </div>`;
}

function coachesPage({ curriculumRows, indoorRows, theoryRows, attendanceRows, extraRows }) {
  let body = '';
  body += section('In this week we covered these skills', skillsTable(curriculumRows, 'No curriculum records for this week.'));
  if (indoorRows.length) body += section('Indoor Activities Logged', skillsTable(indoorRows, ''));
  if (theoryRows.length) body += section('Theory & Board Activities', theoryTable(theoryRows));
  if (attendanceRows.length) body += section('Weekly Attendance Log', attendanceTable(attendanceRows));
  if (extraRows.length) body += section('Extra Covered', extraTable(extraRows));

  return `<div class="wrc-page-scaler wrc-page-scaler--coaches">
    <div class="wrc-page-wrapper">
      <article class="wrc-report-page wrc-report-page--coaches" id="wrc-coaches-source">
        <header class="wrc-coaches-header"><h1 class="wrc-coaches-header__title">Coaches Overview</h1></header>
        <div class="wrc-coaches-body">${body}</div>
        <footer class="wrc-coaches-footer" aria-hidden="true"></footer>
      </article>
    </div>
  </div>`;
}

function galleryPage({ page, pageIdx, pageCount, companyLogoUrl, monthYear, weekLabel, emptyCameraUrl }) {
  let content;
  if (!page.length) {
    content = `<div class="wrc-gallery-empty-state">
      <div class="wrc-gallery-empty-icon"><img src="${esc(emptyCameraUrl)}" alt="No activity photos" /></div>
      <h2>No Activities Uploaded Yet</h2>
      <p style="font-size: 16px;">No activity photos were uploaded this week, as photography is not permitted on the school premises.</p>
      <span class="wrc-gallery-empty-note">Uploaded activities and sports moments will appear here.</span>
    </div>`;
  } else {
    content = `<div class="wrc-gallery-grid">${page
      .map(
        (item) => `<figure class="wrc-gallery-card">
        <div class="wrc-gallery-image"><img src="${esc(item.src)}" alt="${esc(item.caption)}" /></div>
        <figcaption class="wrc-gallery-caption">${esc(item.caption)}</figcaption>
      </figure>`
      )
      .join('')}</div>`;
  }

  const meta = pageCount > 1 ? `<span>Page ${pageIdx + 1} of ${pageCount}</span>` : '';

  return `<div class="wrc-page-scaler wrc-page-scaler--gallery">
    <div class="wrc-page-wrapper">
      <article class="wrc-report-page wrc-report-page--gallery wrc-gallery-page">
        <div class="wrc-gallery-accent"></div>
        <header class="wrc-gallery-top">
          <div>
            <h1 class="wrc-gallery-title">Activity &amp; Evidence Gallery</h1>
            <p class="wrc-gallery-subtitle">School activities, sports moments &amp; weekly evidence</p>
          </div>
          <div class="wrc-gallery-header-right">
            <img class="wrc-gallery-logo" src="${esc(companyLogoUrl)}" alt="Marcos Quay" />
            <div class="wrc-gallery-meta">${meta}</div>
          </div>
        </header>
        <div class="wrc-gallery-content">${content}</div>
        <footer class="wrc-gallery-footer">
          <div class="wrc-gallery-footer-line"></div>
          <div class="wrc-gallery-footer-content">
            <span>Marcos Quay</span>
            ${monthYear ? `<span>${esc(monthYear)}</span>` : ''}
            ${weekLabel ? `<span>${esc(weekLabel)}</span>` : ''}
          </div>
        </footer>
      </article>
    </div>
  </div>`;
}

function buildWeeklyReportCardHtml({ reportData, school, monthYear, weekNo, origin, uploadsDir }) {
  const css = fs.readFileSync(path.join(ASSETS_DIR, 'weekly-report-card.css'), 'utf8');
  const weekLabel = weekLabelOf(weekNo);
  const dateRangeText = [monthYear, weekLabel].filter(Boolean).join(' • ');
  const city = (school?.city || '').trim();
  const state = (school?.state || '').trim();
  const locationText = city && state ? `${city}, ${state}` : city || state || '';
  const companyLogoUrl = `${origin}/weekly-report-assets/new_logo.png`;
  const emptyCameraUrl = `${origin}/weekly-report-assets/gallery-empty-camera.png`;
  let schoolLogoUrl = '';
  if (school?.school_logo) {
    const logoPath = uploadsDir
      ? path.join(uploadsDir, school.school_logo)
      : null;
    const logoExists = logoPath ? fs.existsSync(logoPath) : true;
    if (logoExists) {
      schoolLogoUrl = `${origin}/uploads/${encodeURIComponent(school.school_logo)}`;
    }
  }

  const curriculumRows = buildCurriculumRows(reportData);
  const indoorRows = buildTypedRows(reportData, 'indoor-activity');
  const theoryRows = buildTypedRows(reportData, 'theory-activity');
  const attendanceRows = buildAttendanceRows(reportData);
  const extraRows = buildExtraRows(reportData);
  const galleryItems = buildGalleryItems(reportData, origin);
  const galleryPages = chunk(galleryItems, GALLERY_PER_PAGE);

  const fontsCss = `
@font-face { font-family: 'Poppins'; font-style: normal; font-weight: 400; src: url('${origin}/weekly-report-assets/fonts/poppins-latin-400-normal.woff2') format('woff2'); }
@font-face { font-family: 'Poppins'; font-style: normal; font-weight: 500; src: url('${origin}/weekly-report-assets/fonts/poppins-latin-500-normal.woff2') format('woff2'); }
@font-face { font-family: 'Poppins'; font-style: normal; font-weight: 600; src: url('${origin}/weekly-report-assets/fonts/poppins-latin-600-normal.woff2') format('woff2'); }
@font-face { font-family: 'Poppins'; font-style: normal; font-weight: 700; src: url('${origin}/weekly-report-assets/fonts/poppins-latin-700-normal.woff2') format('woff2'); }
@font-face { font-family: 'Poppins'; font-style: normal; font-weight: 800; src: url('${origin}/weekly-report-assets/fonts/poppins-latin-700-normal.woff2') format('woff2'); }
html, body { margin: 0; padding: 0; background: #fff; }
.wrc-root { --wrc-screen-scale: 1; }
.wrc-empty-cell { text-align: center; color: #64748b; font-style: italic; padding: 16px 8px !important; }
`;

  const pages =
    coverPage({ weekLabel, dateRangeText, locationText, school, companyLogoUrl, schoolLogoUrl }) +
    coachesPage({ curriculumRows, indoorRows, theoryRows, attendanceRows, extraRows }) +
    galleryPages
      .map((page, pageIdx) =>
        galleryPage({
          page,
          pageIdx,
          pageCount: galleryPages.length,
          companyLogoUrl,
          monthYear,
          weekLabel,
          emptyCameraUrl,
        })
      )
      .join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Weekly Report Card</title>
<style>${fontsCss}\n${css}</style>
</head>
<body>
<div class="wrc-root wrc-pdf-export" style="--wrc-screen-scale:1">
  <div class="wrc-preview-area" id="wrc-preview">
    ${pages}
  </div>
</div>
</body>
</html>`;
}

module.exports = {
  buildWeeklyReportCardHtml,
  A4_WIDTH,
  A4_HEIGHT,
  ASSETS_DIR,
};

