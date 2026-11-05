const puppeteer = require('puppeteer');
const { PDFDocument } = require('pdf-lib');
const jwt = require('jsonwebtoken');
const { buildWeeklyReportCardHtml, A4_WIDTH, A4_HEIGHT } = require('./weeklyReportCardHtml');

const COACHES_PDF_BG = '#f4f6f8';

async function fetchReportAndSchool({ origin, school_id, month_year, week_no, db }) {
  const [[school]] = await db.query(
    'SELECT id, name, school_logo, city, state FROM schools WHERE id = ? LIMIT 1',
    [school_id]
  );
  if (!school) throw new Error('School not found');

  const token = jwt.sign(
    { id: 0, role: 'internal-pdf', purpose: 'weekly-report-pdf' },
    process.env.JWT_SECRET,
    { expiresIn: '5m' }
  );
  const qs = new URLSearchParams({
    school_id: String(school_id),
    month_year: String(month_year),
    week_no: String(week_no),
  });
  const res = await fetch(`${origin}/api/curriculum/report-data?${qs}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const json = await res.json();
  if (!res.ok || !json?.success) {
    throw new Error(json?.message || `report-data failed (${res.status})`);
  }
  return { school, reportData: json.report };
}

async function paginateCoachesInPage(page) {
  await page.evaluate((A4_HEIGHT) => {
    const coachesPage = document.querySelector('#wrc-coaches-source');
    if (!coachesPage) return;

    const copyVueScope = () => {};
    const A4_WIDTH = 794;

    const mountPdfSheet = (article) => {
      const mount = document.createElement('div');
      mount.className = 'wrc-coaches-pdf-mount';
      mount.style.cssText = `position:fixed;left:-9999px;top:0;width:${A4_WIDTH}px;z-index:-1;`;
      mount.appendChild(article);
      const root = document.querySelector('.wrc-root') || document.body;
      root.appendChild(mount);
      return mount;
    };

    const measureInPdfContext = (build) => {
      const article = document.createElement('article');
      article.className = 'wrc-report-page wrc-report-page--coaches wrc-coaches-pdf-sheet wrc-coaches-pdf-sheet--continued';
      const body = document.createElement('div');
      body.className = 'wrc-coaches-body';
      body.style.flex = 'none';
      build(body);
      article.appendChild(body);
      const mount = mountPdfSheet(article);
      const target = body.firstElementChild;
      const height = target ? target.offsetHeight : body.offsetHeight;
      mount.remove();
      return height;
    };

    const measureTableRows = (section) => {
      const rows = [];
      measureInPdfContext((body) => {
        const clone = section.cloneNode(true);
        body.appendChild(clone);
        clone.querySelectorAll('tbody tr').forEach((tr) => {
          rows.push({ node: tr.cloneNode(true), height: tr.offsetHeight });
        });
      });
      // force measurement side-effect; height values filled above
      // re-measure properly:
      rows.length = 0;
      const article = document.createElement('article');
      article.className = 'wrc-report-page wrc-report-page--coaches wrc-coaches-pdf-sheet wrc-coaches-pdf-sheet--continued';
      const body = document.createElement('div');
      body.className = 'wrc-coaches-body';
      body.style.flex = 'none';
      const clone = section.cloneNode(true);
      body.appendChild(clone);
      article.appendChild(body);
      const mount = mountPdfSheet(article);
      clone.querySelectorAll('tbody tr').forEach((tr) => {
        rows.push({ node: tr.cloneNode(true), height: tr.offsetHeight });
      });
      mount.remove();
      return rows;
    };

    const buildTableSectionElement = (section, rows, continued) => {
      const sectionEl = document.createElement('section');
      sectionEl.className = section.className;
      const head = section.querySelector('.wrc-coaches-section__head')?.cloneNode(true);
      if (head && continued) {
        head.querySelector('.wrc-coaches-section__title')?.classList.add('wrc-coaches-section__title--continued');
      }
      if (head) sectionEl.appendChild(head);
      const wrap = document.createElement('div');
      wrap.className = 'wrc-coach-table-wrap';
      const sourceTable = section.querySelector('table');
      const table = sourceTable ? sourceTable.cloneNode(false) : document.createElement('table');
      if (sourceTable) table.className = sourceTable.className;
      const thead = section.querySelector('thead')?.cloneNode(true);
      if (thead) table.appendChild(thead);
      const tbody = document.createElement('tbody');
      rows.forEach((row) => tbody.appendChild(row.node.cloneNode(true)));
      table.appendChild(tbody);
      wrap.appendChild(table);
      sectionEl.appendChild(wrap);
      return sectionEl;
    };

    const createBuilder = (showOverviewHeader) => {
      const article = document.createElement('article');
      article.className = 'wrc-report-page wrc-report-page--coaches wrc-coaches-pdf-sheet';
      if (!showOverviewHeader) article.classList.add('wrc-coaches-pdf-sheet--continued');
      article.style.height = `${A4_HEIGHT}px`;
      article.style.overflow = 'hidden';
      if (showOverviewHeader) {
        const header = coachesPage.querySelector('.wrc-coaches-header')?.cloneNode(true);
        if (header) article.appendChild(header);
      }
      const body = document.createElement('div');
      body.className = 'wrc-coaches-body';
      body.style.flex = 'none';
      article.appendChild(body);
      const footer = coachesPage.querySelector('.wrc-coaches-footer')?.cloneNode(true);
      if (footer) article.appendChild(footer);
      const mount = mountPdfSheet(article);
      return {
        mount,
        article,
        body,
        isEmpty: () => body.children.length === 0,
        fitsWhenAppended(el) {
          body.appendChild(el);
          const fits = article.scrollHeight <= A4_HEIGHT;
          body.removeChild(el);
          return fits;
        },
        append(el) {
          body.appendChild(el);
        },
      };
    };

    const takeMaxTableRows = (builder, section, rows, continued) => {
      let best = 0;
      for (let n = 1; n <= rows.length; n++) {
        const candidate = buildTableSectionElement(section, rows.slice(0, n), continued);
        if (builder.fitsWhenAppended(candidate)) best = n;
        else break;
      }
      if (best === 0) best = 1;
      return {
        element: buildTableSectionElement(section, rows.slice(0, best), continued),
        rest: rows.slice(best),
      };
    };

    const sheets = [];
    let isFirst = true;
    let builder = createBuilder(true);

    const pushSheet = (b) => {
      if (b.body.children.length > 0) sheets.push(b);
      else b.mount.remove();
    };
    const startNewPage = () => {
      pushSheet(builder);
      isFirst = false;
      builder = createBuilder(false);
    };

    const appendTableSection = (section) => {
      let rows = measureTableRows(section);
      let continued = false;
      while (rows.length > 0) {
        if (!builder.isEmpty()) {
          const probe = buildTableSectionElement(section, rows.slice(0, 1), continued);
          if (!builder.fitsWhenAppended(probe)) startNewPage();
        }
        const { element, rest } = takeMaxTableRows(builder, section, rows, continued);
        builder.append(element);
        rows = rest;
        continued = true;
      }
    };

    coachesPage.querySelectorAll('.wrc-coaches-section').forEach((section) => {
      const clone = section.cloneNode(true);
      if (builder.fitsWhenAppended(clone)) {
        builder.append(clone);
        return;
      }
      if (section.querySelector('table')) appendTableSection(section);
      else builder.append(clone);
    });
    pushSheet(builder);

    // Replace original coaches scaler with PDF sheets
    const scaler = coachesPage.closest('.wrc-page-scaler');
    const preview = document.getElementById('wrc-preview');
    if (!scaler || !preview) return;

    const frag = document.createDocumentFragment();
    sheets.forEach(({ article, mount }) => {
      const pageScaler = document.createElement('div');
      pageScaler.className = 'wrc-page-scaler wrc-page-scaler--coaches';
      const wrapper = document.createElement('div');
      wrapper.className = 'wrc-page-wrapper';
      // move article out of offscreen mount into page flow
      mount.remove();
      article.style.position = 'relative';
      article.style.left = '0';
      wrapper.appendChild(article);
      pageScaler.appendChild(wrapper);
      frag.appendChild(pageScaler);
    });
    scaler.replaceWith(frag);
  }, A4_HEIGHT);
}

async function capturePagesToPdf(page) {
  // Ensure fixed page sizes for capture
  await page.evaluate((A4_WIDTH, A4_HEIGHT, COACHES_PDF_BG) => {
    document.querySelectorAll('.wrc-page-scaler').forEach((el) => {
      el.style.width = `${A4_WIDTH}px`;
      el.style.margin = '0';
      el.style.zoom = '1';
      el.style.transform = 'none';
    });
    document.querySelectorAll('.wrc-page-wrapper').forEach((el) => {
      el.style.boxShadow = 'none';
      el.style.borderRadius = '0';
      el.style.width = `${A4_WIDTH}px`;
      el.style.height = `${A4_HEIGHT}px`;
      el.style.overflow = 'hidden';
    });
    document.querySelectorAll('.wrc-report-page--cover, .wrc-report-page--gallery, .wrc-coaches-pdf-sheet').forEach((el) => {
      el.style.width = `${A4_WIDTH}px`;
      el.style.height = `${A4_HEIGHT}px`;
      el.style.minHeight = `${A4_HEIGHT}px`;
      el.style.overflow = 'hidden';
    });
    document.querySelectorAll('.wrc-coaches-pdf-sheet').forEach((el) => {
      el.style.background = COACHES_PDF_BG;
      el.style.display = 'flex';
      el.style.flexDirection = 'column';
    });
  }, A4_WIDTH, A4_HEIGHT, COACHES_PDF_BG);

  const handles = await page.$$('.wrc-page-wrapper .wrc-report-page');
  const pdfDoc = await PDFDocument.create();

  for (const handle of handles) {
    const isGallery = await handle.evaluate((el) => el.classList.contains('wrc-report-page--gallery'));
    const isCoaches = await handle.evaluate(
      (el) => el.classList.contains('wrc-report-page--coaches') || el.classList.contains('wrc-coaches-pdf-sheet')
    );
    const bg = isGallery ? '#1e2124' : isCoaches ? COACHES_PDF_BG : '#ffffff';

    const shot = await handle.screenshot({
      type: 'jpeg',
      quality: 98,
      omitBackground: false,
    });

    // Ensure background fill by drawing on a canvas-sized page
    const img = await pdfDoc.embedJpg(shot);
    const pdfPage = pdfDoc.addPage([595.28, 841.89]); // A4 points
    pdfPage.drawRectangle({ x: 0, y: 0, width: 595.28, height: 841.89, color: undefined });
    // pdf-lib needs rgb for fill - skip and just draw image
    pdfPage.drawImage(img, { x: 0, y: 0, width: 595.28, height: 841.89 });
  }

  return Buffer.from(await pdfDoc.save());
}

async function generateWeeklyReportCardPdf({ school_id, month_year, week_no, origin, db, uploadsDir }) {
  const { school, reportData } = await fetchReportAndSchool({
    origin,
    school_id,
    month_year,
    week_no,
    db,
  });

  const html = buildWeeklyReportCardHtml({
    reportData,
    school,
    monthYear: month_year,
    weekNo: week_no,
    origin,
    uploadsDir,
  });

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--font-render-hinting=none'],
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: A4_WIDTH, height: A4_HEIGHT, deviceScaleFactor: 2 });
    await page.setContent(html, { waitUntil: ['load', 'networkidle0'], timeout: 120000 });
    // wait fonts/images
    await page.evaluate(async () => {
      if (document.fonts?.ready) await document.fonts.ready;
      const imgs = Array.from(document.images);
      await Promise.all(
        imgs.map(
          (img) =>
            img.complete
              ? Promise.resolve()
              : new Promise((resolve) => {
                  img.onload = img.onerror = () => resolve();
                })
        )
      );
    });
    await paginateCoachesInPage(page);
    // re-wait layout
    await new Promise((r) => setTimeout(r, 200));
    return await capturePagesToPdf(page);
  } finally {
    await browser.close();
  }
}

async function buildWeeklyReportCardHtmlOnly({ school_id, month_year, week_no, origin, db, uploadsDir }) {
  const { school, reportData } = await fetchReportAndSchool({
    origin,
    school_id,
    month_year,
    week_no,
    db,
  });
  return buildWeeklyReportCardHtml({
    reportData,
    school,
    monthYear: month_year,
    weekNo: week_no,
    origin,
    uploadsDir,
  });
}

module.exports = {
  generateWeeklyReportCardPdf,
  buildWeeklyReportCardHtmlOnly,
  fetchReportAndSchool,
};
