const { PDFDocument, rgb, StandardFonts } = require("pdf-lib");
const fs = require("fs");
const path = require("path");
const LOGO_PATH = path.join(__dirname, "../src/assets/marcos_quay_logo.png");

const WATERMARK_PATH = path.join(
  __dirname,
  "../src/assets/pdf-watermark-page.png",
);

function formatDateLong(d) {
  const day = String(d.getDate()).padStart(2, "0");
  const months = [
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

  return `${day} ${months[d.getMonth()]} ${d.getFullYear()}`;
}

function loadImageBuffer(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`PDF asset not found: ${filePath}`);
  }

  return fs.readFileSync(filePath);
}

function safeFilenamePart(input) {
  return String(input || "")
    .trim()
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

function gradeOrder(gradeRaw) {
  const g = String(gradeRaw || "").trim();
  const lower = g.toLowerCase();

  if (!g) return 9999;
  if (lower === "nursery") return 1;
  if (lower === "jr. kg" || lower === "jr kg" || lower === "jkg") return 2;
  if (lower === "sr. kg" || lower === "sr kg" || lower === "skg") return 3;

  const m = g.match(/grade\s+(\d+)/i);
  if (m) return 4 + parseInt(m[1], 10);

  if (/^\d+$/.test(g)) return 4 + parseInt(g, 10);

  return 999;
}

function weekOrder(weekRaw, lpNoRaw) {
  const wk = String(weekRaw || "").trim();
  const m = wk.match(/(\d+)/);

  if (m) return parseInt(m[1], 10);

  const n = parseInt(String(lpNoRaw || ""), 10);

  return Number.isFinite(n) ? n : 9999;
}

function sanitizeWinAnsiText(text) {
  return String(text || "")
    .replace(/→/g, ">")
    .replace(/←/g, "<")
    .replace(/•/g, "*")
    .replace(/–/g, "-")
    .replace(/—/g, "-")
    .replace(/∞/g, "infinity")
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2022\u2023\u25E6\u2043\u204C\u204D]/g, "*")
    .replace(/[^\x00-\xFF]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function wrapText(text, maxW, font, fontSize) {
  const clean = sanitizeWinAnsiText(text);

  if (!clean) return [];

  const words = clean.split(" ");
  const lines = [];
  let current = words[0];

  for (let i = 1; i < words.length; i++) {
    const candidate = `${current} ${words[i]}`;
    const w = font.widthOfTextAtSize(candidate, fontSize);

    if (w <= maxW) {
      current = candidate;
    } else {
      lines.push(current);
      current = words[i];
    }
  }

  lines.push(current);

  return lines;
}

function groupLessonPlans(rows) {
  const sportMap = new Map();

  for (const r of rows) {
    const sport = String(r.sport || "Unknown").trim() || "Unknown";
    const grade = String(r.grade || "Unknown").trim() || "Unknown";

    if (!sportMap.has(sport)) {
      sportMap.set(sport, new Map());
    }

    const gradeMap = sportMap.get(sport);

    if (!gradeMap.has(grade)) {
      gradeMap.set(grade, []);
    }

    gradeMap.get(grade).push(r);
  }

  const sports = Array.from(sportMap.entries()).map(([sport, gradeMap]) => {
    const grades = Array.from(gradeMap.entries())
      .map(([grade, lessons]) => {
        lessons.sort((a, b) => {
          const wa = weekOrder(a.week, a.lp_no);
          const wb = weekOrder(b.week, b.lp_no);

          if (wa !== wb) return wa - wb;

          const na = parseInt(String(a.lp_no || ""), 10);
          const nb = parseInt(String(b.lp_no || ""), 10);

          if (Number.isFinite(na) && Number.isFinite(nb) && na !== nb) {
            return na - nb;
          }

          return (a.id || 0) - (b.id || 0);
        });

        return { grade, lessons };
      })
      .sort((a, b) => gradeOrder(a.grade) - gradeOrder(b.grade));

    return { sport, grades };
  });

  sports.sort((a, b) => a.sport.localeCompare(b.sport));

  return sports;
}

async function generateCurriculumPdf({ schoolName, lessonPlans }) {
  const pdfDoc = await PDFDocument.create();

  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const pageSize = {
    width: 595.28,
    height: 841.89,
  };

  const margin = 40;
  const lineGap = 4;
  const sectionGap = 10;

  let page = pdfDoc.addPage([pageSize.width, pageSize.height]);

  let y = pageSize.height - margin;

  const ensureSpace = (needed) => {
    if (y - needed < margin) {
      page = pdfDoc.addPage([pageSize.width, pageSize.height]);

      y = pageSize.height - margin;
    }
  };

  const drawHr = () => {
    ensureSpace(12);

    page.drawLine({
      start: {
        x: margin,
        y,
      },
      end: {
        x: pageSize.width - margin,
        y,
      },
      thickness: 1,
      color: rgb(0.85, 0.85, 0.85),
    });

    y -= 12;
  };

  const drawTextLine = (text, opts = {}) => {
    const {
      size = 11,
      bold = false,
      color = rgb(0.12, 0.12, 0.12),
      x = margin,
      align = "left",
    } = opts;

    const sanitized = sanitizeWinAnsiText(text);

    if (!sanitized) return;

    ensureSpace(size + lineGap);

    const f = bold ? fontBold : font;
    const w = f.widthOfTextAtSize(sanitized, size);

    const xPos =
      align === "center"
        ? (pageSize.width - w) / 2
        : align === "right"
          ? pageSize.width - margin - w
          : x;

    page.drawText(sanitized, {
      x: xPos,
      y,
      size,
      font: f,
      color,
    });

    y -= size + lineGap;
  };

  const drawLabelValue = (label, value) => {
    drawTextLine(label, {
      size: 10,
      bold: true,
      color: rgb(0.35, 0.35, 0.35),
    });

    drawTextLine(value, {
      size: 13,
      bold: true,
    });

    y -= 6;
  };

  const drawParagraph = (label, value) => {
    if (!value) return;

    ensureSpace(22);

    drawTextLine(label, {
      size: 9,
      bold: true,
      color: rgb(0.35, 0.35, 0.35),
    });

    const maxW = pageSize.width - margin * 2;

    const lines = wrapText(String(value), maxW, font, 10);

    for (const l of lines) {
      drawTextLine(l, {
        size: 10,
      });
    }

    y -= 2;
  };

  // ===== Cover / Header =====

  drawHr();

  drawTextLine("Marcos Quay", {
    size: 18,
    bold: true,
    align: "center",
  });

  drawTextLine("Curriculum Report", {
    size: 14,
    bold: true,
    align: "center",
  });

  drawHr();

  drawLabelValue("School", schoolName);

  drawLabelValue("Generated On", formatDateLong(new Date()));

  drawTextLine("=====================================================", {
    size: 10,
    color: rgb(0.55, 0.55, 0.55),
  });

  const sports = groupLessonPlans(lessonPlans);

  for (const sportGroup of sports) {
    ensureSpace(80);

    y -= sectionGap;

    drawTextLine("SPORT", {
      size: 10,
      bold: true,
      color: rgb(0.35, 0.35, 0.35),
    });

    drawTextLine(sportGroup.sport, {
      size: 16,
      bold: true,
    });

    drawHr();

    for (const gradeGroup of sportGroup.grades) {
      ensureSpace(40);

      drawTextLine(String(gradeGroup.grade), {
        size: 13,
        bold: true,
      });

      y -= 4;

      for (const lp of gradeGroup.lessons) {
        const heading = lp.lp_no
          ? `Lesson Plan ${lp.lp_no}`
          : String(lp.week || "").trim() || "Lesson Plan";

        ensureSpace(70);

        drawTextLine(heading, {
          size: 11,
          bold: true,
          color: rgb(0.12, 0.25, 0.55),
        });

        const topicParts = [lp.skill, lp.sub_skill].filter(Boolean).map(String);

        const topic = topicParts.join(" · ");

        drawParagraph("Topic", topic);

        drawParagraph("Objectives", lp.objective);

        const activitiesParts = [];

        if (lp.warm_up) {
          activitiesParts.push(`Warm Up: ${lp.warm_up}`);
        }

        if (lp.skill_implementation) {
          activitiesParts.push(`Skill: ${lp.skill_implementation}`);
        }

        if (lp.cool_down) {
          activitiesParts.push(`Cool Down: ${lp.cool_down}`);
        }

        drawParagraph("Activities", activitiesParts.join("  "));

        drawParagraph("Equipment", lp.teaching_aids);

        const assessmentParts = [];

        if (lp.summarization) {
          assessmentParts.push(lp.summarization);
        }

        if (lp.life_skill) {
          assessmentParts.push(`Life Skill: ${lp.life_skill}`);
        }

        drawParagraph("Assessment", assessmentParts.join("  "));

        drawTextLine("-------------------------------------", {
          size: 10,
          color: rgb(0.7, 0.7, 0.7),
        });
      }

      drawTextLine("=====================================================", {
        size: 10,
        color: rgb(0.55, 0.55, 0.55),
      });
    }
  }

  y -= 8;

  const pdfBytes = await pdfDoc.save();

  const fileName = `Curriculum Report - ${safeFilenamePart(schoolName)}.pdf`;

  return {
    pdfBytes,
    fileName,
  };
}

async function generatePreWeeklyPlannerPdf({ schoolName, lessonPlans }) {
  const pdfDoc = await PDFDocument.create();

  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);

  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const logoBytes = loadImageBuffer(LOGO_PATH);
  const watermarkBytes = loadImageBuffer(WATERMARK_PATH);

  const logo = await pdfDoc.embedPng(logoBytes);
  const watermark = await pdfDoc.embedPng(watermarkBytes);

  const pageSize = {
    width: 595.28,
    height: 841.89,
  };

  const margin = 40;
  const contentWidth = pageSize.width - margin * 2;

  const lineGap = 4;

  let page = pdfDoc.addPage([pageSize.width, pageSize.height]);

  let y = pageSize.height - margin;

  const drawWatermark = () => {
    const wmWidth = 300;
    const wmHeight = 245;

    page.drawImage(watermark, {
      x: (pageSize.width - wmWidth) / 2,
      y: (pageSize.height - wmHeight) / 2 - 60,
      width: wmWidth,
      height: wmHeight,
      opacity: 0.12,
    });
  };

  const drawFooter = () => {
    const footerText = `Generated: ${formatDateLong(
      new Date(),
    )} · www.marcosquay.com`;

    const footerSize = 7;

    const footerWidth = font.widthOfTextAtSize(footerText, footerSize);

    page.drawText(footerText, {
      x: (pageSize.width - footerWidth) / 2,
      y: 20,
      size: footerSize,
      font,
      color: rgb(0.47, 0.47, 0.47),
    });
  };

  const drawPageLogo = () => {
    const logoWidth = 115;
    const logoHeight = 86;

    page.drawImage(logo, {
      x: (pageSize.width - logoWidth) / 2,
      y: pageSize.height - 125,
      width: logoWidth,
      height: logoHeight,
    });
  };

  const addNewPage = () => {
    page = pdfDoc.addPage([pageSize.width, pageSize.height]);

    y = pageSize.height - margin;

    drawWatermark();
    drawFooter();
  };

  const ensureSpace = (needed) => {
    if (y - needed < margin + 20) {
      addNewPage();
    }
  };

  const drawTextLine = (text, opts = {}) => {
    const {
      size = 11,
      bold = false,
      color = rgb(0.12, 0.12, 0.12),
      x = margin,
      align = "left",
    } = opts;

    const sanitized = sanitizeWinAnsiText(text);

    if (!sanitized) return;

    ensureSpace(size + lineGap);

    const f = bold ? fontBold : font;

    const w = f.widthOfTextAtSize(sanitized, size);

    const xPos =
      align === "center"
        ? (pageSize.width - w) / 2
        : align === "right"
          ? pageSize.width - margin - w
          : x;

    page.drawText(sanitized, {
      x: xPos,
      y,
      size,
      font: f,
      color,
    });

    y -= size + lineGap;
  };

  const drawHr = () => {
    ensureSpace(12);

    page.drawLine({
      start: {
        x: margin,
        y,
      },
      end: {
        x: pageSize.width - margin,
        y,
      },
      thickness: 1,
      color: rgb(0.85, 0.85, 0.85),
    });

    y -= 12;
  };

  const drawParagraph = (label, value, options = {}) => {
    if (!value) return;

    const { labelSize = 9, valueSize = 10, gapAfter = 4 } = options;

    const labelText = `${label}:`;

    ensureSpace(labelSize + valueSize + 12);

    drawTextLine(labelText, {
      size: labelSize,
      bold: true,
      color: rgb(0.35, 0.35, 0.35),
    });

    const lines = wrapText(String(value), contentWidth, font, valueSize);

    for (const line of lines) {
      drawTextLine(line, {
        size: valueSize,
      });
    }

    y -= gapAfter;
  };

  const drawGradeHeader = (sport, grade) => {
    ensureSpace(48);

    const height = 38;

    page.drawRectangle({
      x: margin,
      y: y - height + 10,
      width: contentWidth,
      height,
      color: rgb(0.94, 0.94, 0.94),
    });

    const gradeText = `${sport} - ${grade}`;

    page.drawText(gradeText, {
      x: margin + 12,
      y: y - 13,
      size: 13,
      font: fontBold,
      color: rgb(0.12, 0.12, 0.12),
    });

    y -= height + 8;
  };

  // =========================================================
  // FIRST PAGE BRANDING
  // =========================================================

  drawPageLogo();

  drawWatermark();
  drawFooter();

  // Move content below the logo.
  y = pageSize.height - 155;

  // =========================================================
  // HEADER
  // =========================================================

  drawTextLine(schoolName, {
    size: 13,
    bold: true,
    color: rgb(0.2, 0.2, 0.2),
  });

  y -= 8;

  drawHr();

  drawTextLine(formatDateLong(new Date()), {
    size: 9,
    color: rgb(0.47, 0.47, 0.47),
  });

  y -= 8;

  // =========================================================
  // LESSON PLANS
  // =========================================================

  const sports = groupLessonPlans(lessonPlans);

  for (const sportGroup of sports) {
    ensureSpace(55);

    drawTextLine(sportGroup.sport, {
      size: 16,
      bold: true,
    });

    y -= 5;

    for (const gradeGroup of sportGroup.grades) {
      drawGradeHeader(sportGroup.sport, gradeGroup.grade);

      let lessonIndex = 0;

      for (const lp of gradeGroup.lessons) {
        ensureSpace(35);

        const heading = lp.lp_no
          ? `${lessonIndex + 1}. Lesson Plan ${lp.lp_no} · ${lp.skill || "Session"}`
          : `${lessonIndex + 1}. Lesson Plan`;

        drawTextLine(heading, {
          size: 12,
          bold: true,
          color: rgb(0.12, 0.12, 0.12),
        });

        // Sub Skill
        if (lp.sub_skill) {
          drawTextLine(`Sub Skill: ${lp.sub_skill}`, {
            size: 10,
          });
        }

        // Learning Objectives
        if (lp.objective) {
          drawTextLine("Learning Objectives:", {
            size: 10.5,
            bold: true,
            color: rgb(0.2, 0.2, 0.2),
          });

          const objectives = String(lp.objective)
            .split(/[\n,|;]+/)
            .map((item) => item.trim())
            .filter(Boolean);

          for (const objective of objectives) {
            drawTextLine(`• ${objective}`, {
              size: 10,
              x: margin + 10,
            });
          }
        }

        // Teaching Aids
        if (lp.teaching_aids) {
          drawTextLine(
            `Teaching Aids: ${String(lp.teaching_aids)
              .split(/[\n,|;]+/)
              .map((item) => item.trim())
              .filter(Boolean)
              .join(" | ")}`,
            {
              size: 8,
              color: rgb(0.35, 0.35, 0.35),
            },
          );
        }

        // Session Review
        if (lp.summarization) {
          drawTextLine(`Session Review: "${lp.summarization}"`, {
            size: 8,
            color: rgb(0.35, 0.35, 0.35),
          });
        }

        y -= 5;

        lessonIndex += 1;
      }

      y -= 5;
    }
  }

  ensureSpace(30);

  drawHr();

  const pdfBytes = await pdfDoc.save();

  const fileName = `Curriculum Report - ${safeFilenamePart(schoolName)}.pdf`;

  return {
    pdfBytes,
    fileName,
  };
}

async function buildPreWeeklyPlannerPdf({ schoolName, lessonPlans }) {
  return await generatePreWeeklyPlannerPdf({
    schoolName,
    lessonPlans,
  });
}

module.exports = {
  generateCurriculumPdf,
  buildPreWeeklyPlannerPdf,
};
