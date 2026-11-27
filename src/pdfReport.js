const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const PAGE_W = 595.28; // A4 portrait width in pt
const PAGE_H = 841.89; // A4 portrait height in pt
const MARGIN_X = 40;
const CONTENT_W = PAGE_W - MARGIN_X * 2;
const TOP_MARGIN_P1 = 30;
const TOP_MARGIN_NEXT = 54;
const BOTTOM_LIMIT = PAGE_H - 48;

const DEFAULT_LOGO_PATH = path.join(__dirname, '..', 'public', 'assets', 'codeaura-logo.jpg');
let cachedLogo = null;

// Standard Adobe AFM widths (1/1000 em) for ASCII 32..126
const HELVETICA_WIDTHS = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556,
  1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556,
  333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556,
  556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584
];

const HELVETICA_BOLD_WIDTHS = [
  278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611,
  975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556,
  333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611,
  611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584
];

const WINANSI_MAP = new Map([
  [0x20AC, 0x80], [0x201A, 0x82], [0x0192, 0x83], [0x201E, 0x84], [0x2026, 0x85],
  [0x2020, 0x86], [0x2021, 0x87], [0x02C6, 0x88], [0x2030, 0x89], [0x0160, 0x8A],
  [0x2039, 0x8B], [0x0152, 0x8C], [0x017D, 0x8E], [0x2018, 0x91], [0x2019, 0x92],
  [0x201C, 0x93], [0x201D, 0x94], [0x2022, 0x95], [0x2013, 0x96], [0x2014, 0x97],
  [0x02DC, 0x98], [0x2122, 0x99], [0x0161, 0x9A], [0x203A, 0x9B], [0x0153, 0x9C],
  [0x017E, 0x9E], [0x0178, 0x9F]
]);

function normalizeTextForPdf(input) {
  return String(input ?? '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\t/g, '  ')
    .replace(/[✓✔]/g, '[OK]')
    .replace(/[✕✖✘]/g, '[X]')
    .replace(/→/g, '->')
    .replace(/←/g, '<-')
    .replace(/≥/g, '>=')
    .replace(/≤/g, '<=')
    .replace(/≠/g, '!=')
    .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '');
}

function toWinAnsiBytes(str) {
  const clean = normalizeTextForPdf(str);
  const bytes = [];
  for (const ch of clean) {
    const code = ch.codePointAt(0);
    if (code === undefined) continue;
    if (code >= 0x20 && code <= 0x7E) {
      bytes.push(code);
    } else if (WINANSI_MAP.has(code)) {
      bytes.push(WINANSI_MAP.get(code));
    } else if (code >= 0xA0 && code <= 0xFF) {
      bytes.push(code);
    } else if (code === 0x0A) {
      bytes.push(0x20);
    } else {
      bytes.push(0x3F);
    }
  }
  return bytes;
}

function toPdfHexString(str) {
  return `<${Buffer.from(toWinAnsiBytes(str)).toString('hex').toUpperCase()}>`;
}

function getGlyphWidthUnits(byte, fontKey) {
  if (fontKey === 'F3' || fontKey === 'F4') return 600;
  const widths = fontKey === 'F2' ? HELVETICA_BOLD_WIDTHS : HELVETICA_WIDTHS;
  if (byte >= 32 && byte <= 126) return widths[byte - 32];
  if (byte === 0x95) return 350;
  if (byte === 0x96 || byte === 0x97) return 556;
  if (byte === 0x85) return 1000;
  return 556;
}

function measureTextWidth(str, fontKey, fontSize) {
  const bytes = toWinAnsiBytes(str);
  let total = 0;
  for (const b of bytes) {
    total += getGlyphWidthUnits(b, fontKey);
  }
  return (total * fontSize) / 1000;
}

function wrapText(text, maxWidth, fontKey = 'F1', fontSize = 10) {
  const normalized = normalizeTextForPdf(text);
  const paragraphs = normalized.split('\n');
  const lines = [];

  for (const para of paragraphs) {
    const trimmed = para.replace(/\s+$/, '');
    if (!trimmed.trim()) {
      lines.push('');
      continue;
    }

    const words = trimmed.split(/(\s+)/).filter((part) => part.length > 0);
    let current = '';

    for (const token of words) {
      const candidate = current ? current + token : token.replace(/^\s+/, '');
      if (measureTextWidth(candidate, fontKey, fontSize) <= maxWidth) {
        current = candidate;
        continue;
      }

      if (current.trim()) {
        lines.push(current.trimEnd());
        current = '';
      }

      const word = token.trim();
      if (!word) continue;

      if (measureTextWidth(word, fontKey, fontSize) <= maxWidth) {
        current = word;
      } else {
        let chunk = '';
        for (const ch of word) {
          if (measureTextWidth(chunk + ch, fontKey, fontSize) > maxWidth && chunk) {
            lines.push(chunk);
            chunk = ch;
          } else {
            chunk += ch;
          }
        }
        current = chunk;
      }
    }

    if (current.trim() || lines.length === 0) {
      lines.push(current.trimEnd());
    }
  }

  return lines.length > 0 ? lines : [''];
}

function truncateText(text, maxWidth, fontKey = 'F1', fontSize = 10) {
  const clean = normalizeTextForPdf(text).replace(/\s+/g, ' ').trim();
  if (measureTextWidth(clean, fontKey, fontSize) <= maxWidth) return clean;
  let out = '';
  for (const ch of clean) {
    if (measureTextWidth(`${out}${ch}...`, fontKey, fontSize) > maxWidth) break;
    out += ch;
  }
  return `${out.trimEnd()}...`;
}

function rgbStr(color) {
  return color.map((c) => c.toFixed(4)).join(' ');
}

function parseHexColor(hex) {
  const clean = String(hex || '#1E293B').replace('#', '').trim();
  if (!/^[0-9a-fA-F]{6}$/.test(clean)) return [0.118, 0.161, 0.231];
  return [
    parseInt(clean.slice(0, 2), 16) / 255,
    parseInt(clean.slice(2, 4), 16) / 255,
    parseInt(clean.slice(4, 6), 16) / 255
  ];
}

// Restrained institutional monochrome + slate palette
const C = {
  ink: parseHexColor('#0F172A'),
  slateDark: parseHexColor('#1E293B'),
  muted: parseHexColor('#475569'),
  subtle: parseHexColor('#64748B'),
  border: parseHexColor('#E2E8F0'),
  borderStrong: parseHexColor('#CBD5E1'),
  surface: parseHexColor('#F8FAFC'),
  surfaceAlt: parseHexColor('#F1F5F9'),
  cream: parseHexColor('#FFF8EC'),
  white: [1, 1, 1],
  passText: parseHexColor('#15803D'),
  failText: parseHexColor('#B91C1C')
};

function parseJpegInfo(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 4 || buffer[0] !== 0xFF || buffer[1] !== 0xD8) {
    return null;
  }
  let offset = 2;
  while (offset + 3 < buffer.length) {
    if (buffer[offset] !== 0xFF) {
      offset += 1;
      continue;
    }
    while (offset < buffer.length && buffer[offset] === 0xFF) offset += 1;
    if (offset >= buffer.length) break;
    const marker = buffer[offset];
    offset += 1;

    if (marker === 0xD8 || marker === 0xD9 || marker === 0x01 || (marker >= 0xD0 && marker <= 0xD7)) {
      continue;
    }
    if (offset + 2 > buffer.length) break;
    const segLen = buffer.readUInt16BE(offset);
    if (segLen < 2 || offset + segLen > buffer.length) break;

    if (
      (marker >= 0xC0 && marker <= 0xC3) ||
      (marker >= 0xC5 && marker <= 0xC7) ||
      (marker >= 0xC9 && marker <= 0xCB) ||
      (marker >= 0xCD && marker <= 0xCF)
    ) {
      if (segLen >= 8) {
        return {
          bytes: buffer,
          bitsPerComponent: buffer[offset + 2],
          height: buffer.readUInt16BE(offset + 3),
          width: buffer.readUInt16BE(offset + 5),
          components: buffer[offset + 7]
        };
      }
    }
    offset += segLen;
  }
  return null;
}

function loadLogoAsset() {
  if (cachedLogo !== null) return cachedLogo;
  try {
    if (fs.existsSync(DEFAULT_LOGO_PATH)) {
      const buf = fs.readFileSync(DEFAULT_LOGO_PATH);
      const parsed = parseJpegInfo(buf);
      if (parsed && parsed.width > 0 && parsed.height > 0) {
        cachedLogo = parsed;
        return cachedLogo;
      }
    }
  } catch {}
  cachedLogo = false;
  return null;
}

class PdfDocumentBuilder {
  constructor(logoAsset) {
    this.logoAsset = logoAsset || null;
    this.pages = [];
    this.currentOps = [];
    this.y = TOP_MARGIN_P1;
  }

  py(topY) {
    return PAGE_H - topY;
  }

  newPage() {
    if (this.currentOps.length > 0 || this.pages.length > 0) {
      this.pages.push(this.currentOps);
    }
    this.currentOps = [];
    this.y = this.pages.length === 0 ? TOP_MARGIN_P1 : TOP_MARGIN_NEXT;
  }

  ensureSpace(heightNeeded) {
    if (this.y + heightNeeded > BOTTOM_LIMIT) {
      this.newPage();
      return true;
    }
    return false;
  }

  pushOp(op) {
    this.currentOps.push(op);
  }

  drawRect(x, y, w, h, { fill = null, stroke = null, lineWidth = 0.75 } = {}) {
    if (!fill && !stroke) return;
    const ops = ['q'];
    if (fill) ops.push(`${rgbStr(fill)} rg`);
    if (stroke) {
      ops.push(`${rgbStr(stroke)} RG`);
      ops.push(`${lineWidth.toFixed(2)} w`);
    }
    ops.push(`${x.toFixed(2)} ${this.py(y + h).toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re`);
    if (fill && stroke) ops.push('B');
    else if (fill) ops.push('f');
    else ops.push('S');
    ops.push('Q');
    this.pushOp(ops.join('\n'));
  }

  drawRoundedRect(x, y, w, h, r, { fill = null, stroke = null, lineWidth = 0.75 } = {}) {
    if (!fill && !stroke) return;
    const rad = Math.max(0, Math.min(r, w / 2, h / 2));
    if (rad < 0.5) {
      this.drawRect(x, y, w, h, { fill, stroke, lineWidth });
      return;
    }
    const x0 = x;
    const x1 = x + w;
    const yBottom = this.py(y + h);
    const yTop = this.py(y);
    const k = 0.55228475 * rad;

    this.pushOp([
      'q',
      ...(fill ? [`${rgbStr(fill)} rg`] : []),
      ...(stroke ? [`${rgbStr(stroke)} RG`, `${lineWidth.toFixed(2)} w`] : []),
      `${(x0 + rad).toFixed(2)} ${yBottom.toFixed(2)} m`,
      `${(x1 - rad).toFixed(2)} ${yBottom.toFixed(2)} l`,
      `${(x1 - rad + k).toFixed(2)} ${yBottom.toFixed(2)} ${x1.toFixed(2)} ${(yBottom + rad - k).toFixed(2)} ${x1.toFixed(2)} ${(yBottom + rad).toFixed(2)} c`,
      `${x1.toFixed(2)} ${(yTop - rad).toFixed(2)} l`,
      `${x1.toFixed(2)} ${(yTop - rad + k).toFixed(2)} ${(x1 - rad + k).toFixed(2)} ${yTop.toFixed(2)} ${(x1 - rad).toFixed(2)} ${yTop.toFixed(2)} c`,
      `${(x0 + rad).toFixed(2)} ${yTop.toFixed(2)} l`,
      `${(x0 + rad - k).toFixed(2)} ${yTop.toFixed(2)} ${x0.toFixed(2)} ${(yTop - rad + k).toFixed(2)} ${x0.toFixed(2)} ${(yTop - rad).toFixed(2)} c`,
      `${x0.toFixed(2)} ${(yBottom + rad).toFixed(2)} l`,
      `${x0.toFixed(2)} ${(yBottom + rad - k).toFixed(2)} ${(x0 + rad - k).toFixed(2)} ${yBottom.toFixed(2)} ${(x0 + rad).toFixed(2)} ${yBottom.toFixed(2)} c`,
      'h',
      fill && stroke ? 'B' : fill ? 'f' : 'S',
      'Q'
    ].join('\n'));
  }

  drawLine(x1, y1, x2, y2, color = C.border, lineWidth = 0.75) {
    this.pushOp([
      'q',
      `${rgbStr(color)} RG`,
      `${lineWidth.toFixed(2)} w`,
      `${x1.toFixed(2)} ${this.py(y1).toFixed(2)} m`,
      `${x2.toFixed(2)} ${this.py(y2).toFixed(2)} l`,
      'S',
      'Q'
    ].join('\n'));
  }

  drawText(text, x, baselineY, { font = 'F1', size = 10, color = C.ink, align = 'left' } = {}) {
    const clean = normalizeTextForPdf(text).replace(/\n+/g, ' ');
    let drawX = x;
    if (align === 'right') {
      drawX = x - measureTextWidth(clean, font, size);
    } else if (align === 'center') {
      drawX = x - measureTextWidth(clean, font, size) / 2;
    }
    this.pushOp([
      'BT',
      `/${font} ${size.toFixed(2)} Tf`,
      `${rgbStr(color)} rg`,
      `1 0 0 1 ${drawX.toFixed(2)} ${this.py(baselineY).toFixed(2)} Tm`,
      `${toPdfHexString(clean)} Tj`,
      'ET'
    ].join('\n'));
  }

  drawLines(lines, x, firstBaselineY, { font = 'F1', size = 10, lineHeight = 13.5, color = C.ink } = {}) {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line) continue;
      this.drawText(line, x, firstBaselineY + i * lineHeight, { font, size, color });
    }
  }

  drawImage(name, x, y, w, h) {
    this.pushOp([
      'q',
      `${w.toFixed(2)} 0 0 ${h.toFixed(2)} ${x.toFixed(2)} ${this.py(y + h).toFixed(2)} cm`,
      `/${name} Do`,
      'Q'
    ].join('\n'));
  }

  buildBuffer({ studentLabel, examTitle, instituteName }) {
    if (this.currentOps.length > 0) {
      this.pages.push(this.currentOps);
      this.currentOps = [];
    }

    const totalPages = this.pages.length || 1;
    const finalizedStreams = [];

    for (let i = 0; i < totalPages; i++) {
      const origOps = this.pages[i] || [];
      this.currentOps = [];

      // Running clean monochrome header on Page 2+
      if (i > 0) {
        this.drawText(`${instituteName}  —  Exam Score Report`, MARGIN_X, 31, { font: 'F2', size: 8.5, color: C.slateDark });
        this.drawText(
          truncateText(`${studentLabel}  •  ${examTitle}`, 265, 'F1', 8.5),
          MARGIN_X + CONTENT_W,
          31,
          { font: 'F1', size: 8.5, color: C.muted, align: 'right' }
        );
        this.drawLine(MARGIN_X, 38, MARGIN_X + CONTENT_W, 38, C.borderStrong, 0.75);
      }

      // Consistent clean footer on every page
      const footerRuleY = PAGE_H - 36;
      this.drawLine(MARGIN_X, footerRuleY, MARGIN_X + CONTENT_W, footerRuleY, C.borderStrong, 0.7);
      this.drawText(
        `${instituteName}  •  Official Exam Score Report`,
        MARGIN_X,
        PAGE_H - 22,
        { font: 'F1', size: 8, color: C.subtle }
      );
      this.drawText(
        `Page ${i + 1} of ${totalPages}`,
        MARGIN_X + CONTENT_W,
        PAGE_H - 22,
        { font: 'F2', size: 8, color: C.muted, align: 'right' }
      );

      finalizedStreams.push([...this.currentOps, ...origOps].join('\n'));
    }

    const objects = [];
    const addObj = (bodyBufOrStr) => {
      objects.push(Buffer.isBuffer(bodyBufOrStr) ? bodyBufOrStr : Buffer.from(bodyBufOrStr, 'latin1'));
      return objects.length;
    };

    const catalogNum = 1;
    const pagesNum = 2;
    addObj('');
    addObj('');

    const f1 = addObj('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
    const f2 = addObj('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
    const f3 = addObj('<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>');
    const f4 = addObj('<< /Type /Font /Subtype /Type1 /BaseFont /Courier-Bold /Encoding /WinAnsiEncoding >>');

    let imgObjNum = null;
    if (this.logoAsset && this.logoAsset.bytes) {
      const cs = this.logoAsset.components === 1 ? '/DeviceGray'
        : this.logoAsset.components === 4 ? '/DeviceCMYK'
        : '/DeviceRGB';
      const dict = `<< /Type /XObject /Subtype /Image /Width ${this.logoAsset.width} /Height ${this.logoAsset.height} /ColorSpace ${cs} /BitsPerComponent ${this.logoAsset.bitsPerComponent || 8} /Filter /DCTDecode /Length ${this.logoAsset.bytes.length} >>\nstream\n`;
      imgObjNum = addObj(Buffer.concat([
        Buffer.from(dict, 'latin1'),
        this.logoAsset.bytes,
        Buffer.from('\nendstream', 'latin1')
      ]));
    }

    const xObjectDict = imgObjNum ? `/XObject << /Im1 ${imgObjNum} 0 R >>` : '';
    const resourceDict = `<< /Font << /F1 ${f1} 0 R /F2 ${f2} 0 R /F3 ${f3} 0 R /F4 ${f4} 0 R >> ${xObjectDict} >>`;

    const pageObjNums = [];
    for (const streamText of finalizedStreams) {
      const compressed = zlib.deflateSync(Buffer.from(streamText, 'latin1'));
      const contentNum = addObj(Buffer.concat([
        Buffer.from(`<< /Length ${compressed.length} /Filter /FlateDecode >>\nstream\n`, 'latin1'),
        compressed,
        Buffer.from('\nendstream', 'latin1')
      ]));
      const pageNum = addObj(
        `<< /Type /Page /Parent ${pagesNum} 0 R /MediaBox [0 0 ${PAGE_W.toFixed(2)} ${PAGE_H.toFixed(2)}] /Resources ${resourceDict} /Contents ${contentNum} 0 R >>`
      );
      pageObjNums.push(pageNum);
    }

    objects[catalogNum - 1] = Buffer.from(`<< /Type /Catalog /Pages ${pagesNum} 0 R >>`, 'latin1');
    objects[pagesNum - 1] = Buffer.from(
      `<< /Type /Pages /Count ${pageObjNums.length} /Kids [${pageObjNums.map((n) => `${n} 0 R`).join(' ')}] >>`,
      'latin1'
    );

    const chunks = [Buffer.from('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n', 'binary')];
    let byteOffset = chunks[0].length;
    const offsets = [0];

    for (let i = 0; i < objects.length; i++) {
      offsets.push(byteOffset);
      const header = Buffer.from(`${i + 1} 0 obj\n`, 'latin1');
      const footer = Buffer.from('\nendobj\n', 'latin1');
      chunks.push(header, objects[i], footer);
      byteOffset += header.length + objects[i].length + footer.length;
    }

    const xrefOffset = byteOffset;
    const xrefLines = [
      `xref`,
      `0 ${objects.length + 1}`,
      `0000000000 65535 f `
    ];
    for (let i = 1; i <= objects.length; i++) {
      xrefLines.push(`${String(offsets[i]).padStart(10, '0')} 00000 n `);
    }
    const trailer = [
      ...xrefLines,
      `trailer`,
      `<< /Size ${objects.length + 1} /Root ${catalogNum} 0 R >>`,
      `startxref`,
      `${xrefOffset}`,
      `%%EOF`,
      ''
    ].join('\n');

    chunks.push(Buffer.from(trailer, 'latin1'));
    return Buffer.concat(chunks);
  }
}

function formatDuration(totalSeconds) {
  const s = Math.max(0, Math.floor(Number(totalSeconds) || 0));
  const mins = Math.floor(s / 60);
  const secs = s % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

function formatReportDate(iso) {
  const d = iso ? new Date(iso) : new Date();
  if (Number.isNaN(d.getTime())) return 'N/A';
  try {
    return d.toLocaleString('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true
    });
  } catch {
    return d.toISOString().replace('T', ' ').slice(0, 16);
  }
}

function sanitizeFilenamePart(val, fallback = 'Report') {
  const clean = normalizeTextForPdf(val || '')
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 32);
  return clean || fallback;
}

function buildPdfFilename(submission) {
  const roll = sanitizeFilenamePart(submission.rollNumber, 'Roll');
  const name = sanitizeFilenamePart(submission.studentName, 'Student');
  const exam = sanitizeFilenamePart(submission.examTitle, 'Exam');
  return `CodeAura-Score-Report-${roll}-${name}-${exam}.pdf`;
}

function drawSectionHeading(doc, title, subtitle = '') {
  doc.ensureSpace(28);
  const y = doc.y;
  doc.drawText(title, MARGIN_X, y + 11, { font: 'F2', size: 11, color: C.ink });
  if (subtitle) {
    doc.drawText(subtitle, MARGIN_X + CONTENT_W, y + 11, { font: 'F1', size: 8.5, color: C.subtle, align: 'right' });
  }
  doc.drawLine(MARGIN_X, y + 17, MARGIN_X + CONTENT_W, y + 17, C.borderStrong, 0.8);
  doc.y += 24;
}

function generateScoreReportPdf({ submission, instituteName = 'CodeAura Classroom', teacherName = 'Sir' }) {
  const logoAsset = loadLogoAsset();
  const doc = new PdfDocumentBuilder(logoAsset);
  doc.newPage();

  const inst = String(instituteName || 'CodeAura Classroom').trim() || 'CodeAura Classroom';
  const passed = Boolean(submission.passed);
  const statusLabel = passed ? 'PASSED' : 'NEEDS PRACTICE';
  const statusColor = passed ? C.passText : C.failText;

  // 1. Clean Top Executive Letterhead (White background, single slate hairline, CodeAura logo + compact Score Box)
  doc.drawLine(MARGIN_X, doc.y, MARGIN_X + CONTENT_W, doc.y, C.slateDark, 1.8);
  doc.y += 10;

  const headerH = 72;
  const logoW = 108;
  const logoH = 62;
  doc.drawRoundedRect(MARGIN_X, doc.y + 4, logoW, logoH, 5, { fill: C.cream, stroke: C.border, lineWidth: 0.7 });

  if (logoAsset) {
    const pad = 2;
    const scale = Math.min((logoW - pad * 2) / logoAsset.width, (logoH - pad * 2) / logoAsset.height);
    const dw = logoAsset.width * scale;
    const dh = logoAsset.height * scale;
    doc.drawImage(
      'Im1',
      MARGIN_X + (logoW - dw) / 2,
      doc.y + 4 + (logoH - dh) / 2,
      dw,
      dh
    );
  } else {
    doc.drawText('</> CodeAura', MARGIN_X + logoW / 2, doc.y + 39, { font: 'F2', size: 11, color: C.ink, align: 'center' });
  }

  const scoreBoxW = 132;
  const scoreBoxH = 62;
  const scoreBoxX = MARGIN_X + CONTENT_W - scoreBoxW;
  const scoreBoxY = doc.y + 4;
  doc.drawRoundedRect(scoreBoxX, scoreBoxY, scoreBoxW, scoreBoxH, 5, { fill: C.surface, stroke: C.borderStrong, lineWidth: 0.8 });
  doc.drawText('SCORE OBTAINED', scoreBoxX + scoreBoxW / 2, scoreBoxY + 15, { font: 'F2', size: 7.5, color: C.subtle, align: 'center' });
  const scoreStr = `${submission.score ?? 0} / ${submission.totalMarks ?? 0}`;
  const scoreFontSize = measureTextWidth(scoreStr, 'F2', 19) > scoreBoxW - 16 ? 15 : 19;
  doc.drawText(scoreStr, scoreBoxX + scoreBoxW / 2, scoreBoxY + 37, { font: 'F2', size: scoreFontSize, color: C.ink, align: 'center' });
  doc.drawText(`${submission.percentage ?? 0}%  •  ${statusLabel}`, scoreBoxX + scoreBoxW / 2, scoreBoxY + 53, {
    font: 'F2',
    size: 8.2,
    color: statusColor,
    align: 'center'
  });

  const titleX = MARGIN_X + logoW + 14;
  const titleMaxW = scoreBoxX - titleX - 14;
  doc.drawText(inst.toUpperCase(), titleX, doc.y + 18, { font: 'F2', size: 8.5, color: C.muted });
  doc.drawText(truncateText('Official Exam Score Report', titleMaxW, 'F2', 17), titleX, doc.y + 37, {
    font: 'F2',
    size: 17,
    color: C.ink
  });
  doc.drawText(
    truncateText(`Examiner: ${teacherName || 'Sir'}  •  Report ID: ${submission.id || 'N/A'}`, titleMaxW, 'F1', 8.5),
    titleX,
    doc.y + 52,
    { font: 'F1', size: 8.5, color: C.muted }
  );
  doc.drawText(
    `Date: ${formatReportDate(submission.submittedAt)}  •  Pass Criteria: >= ${submission.passPercentage || 40}%`,
    titleX,
    doc.y + 64,
    { font: 'F1', size: 8, color: C.subtle }
  );

  doc.y += headerH + 6;
  doc.drawLine(MARGIN_X, doc.y, MARGIN_X + CONTENT_W, doc.y, C.borderStrong, 0.8);
  doc.y += 14;

  // 2. Simple Candidate & Examination Details Grid
  const metaH = 76;
  doc.drawRoundedRect(MARGIN_X, doc.y, CONTENT_W, metaH, 5, { fill: C.white, stroke: C.borderStrong, lineWidth: 0.75 });
  doc.drawRect(MARGIN_X + 0.5, doc.y + 0.5, CONTENT_W - 1, 18, { fill: C.surfaceAlt });
  doc.drawLine(MARGIN_X, doc.y + 18.5, MARGIN_X + CONTENT_W, doc.y + 18.5, C.borderStrong, 0.65);
  doc.drawText('CANDIDATE & EXAM DETAILS', MARGIN_X + 10, doc.y + 12.5, { font: 'F2', size: 8, color: C.slateDark });

  const col1X = MARGIN_X + 10;
  const col2X = MARGIN_X + CONTENT_W * 0.57;
  const lblW1 = 74;
  const lblW2 = 66;
  const maxW1 = CONTENT_W * 0.57 - 16 - lblW1;
  const maxW2 = CONTENT_W * 0.43 - 16 - lblW2;

  const metaRows = [
    ['Student Name:', submission.studentName || 'N/A', 'Roll Number:', submission.rollNumber || 'N/A'],
    ['Examination:', submission.examTitle || 'Exam', 'Batch / Div:', submission.batch || 'General'],
    ['Student Email:', submission.studentEmail || 'Not Provided', 'Time Taken:', formatDuration(submission.timeTakenSeconds)]
  ];

  let my = doc.y + 32;
  for (const [l1, v1, l2, v2] of metaRows) {
    doc.drawText(l1, col1X, my, { font: 'F1', size: 8.6, color: C.subtle });
    doc.drawText(truncateText(v1, maxW1, 'F2', 8.6), col1X + lblW1, my, { font: 'F2', size: 8.6, color: C.ink });
    doc.drawText(l2, col2X, my, { font: 'F1', size: 8.6, color: C.subtle });
    doc.drawText(truncateText(v2, maxW2, 'F2', 8.6), col2X + lblW2, my, { font: 'F2', size: 8.6, color: C.ink });
    my += 15;
  }
  doc.y += metaH + 16;

  // 3. Subject-Wise Performance Table (clean neutral header & crisp rules)
  const subjects = Array.isArray(submission.subjectBreakdown) ? submission.subjectBreakdown : [];
  if (subjects.length > 0) {
    drawSectionHeading(
      doc,
      'Subject-Wise Breakdown',
      `Correct: ${submission.correctCount ?? 0}  •  Wrong: ${submission.wrongCount ?? 0}  •  Skipped: ${submission.skippedCount ?? 0}`
    );

    const cols = [
      { label: 'Subject', w: 185.28, align: 'left' },
      { label: 'Marks', w: 80, align: 'center' },
      { label: 'Accuracy', w: 72, align: 'center' },
      { label: 'Correct', w: 59, align: 'center' },
      { label: 'Wrong', w: 59, align: 'center' },
      { label: 'Skipped', w: 60, align: 'center' }
    ];

    const drawTableHeader = () => {
      doc.ensureSpace(44);
      const hy = doc.y;
      doc.drawRect(MARGIN_X, hy, CONTENT_W, 21, { fill: C.surfaceAlt, stroke: C.borderStrong, lineWidth: 0.7 });
      let cx = MARGIN_X;
      for (const col of cols) {
        const tx = col.align === 'center' ? cx + col.w / 2 : cx + 10;
        doc.drawText(col.label, tx, hy + 13.8, { font: 'F2', size: 8.4, color: C.slateDark, align: col.align });
        cx += col.w;
      }
      doc.y += 21;
    };

    drawTableHeader();

    subjects.forEach((sb, idx) => {
      if (doc.ensureSpace(22)) drawTableHeader();
      const ry = doc.y;
      const bg = idx % 2 === 1 ? C.surface : C.white;
      doc.drawRect(MARGIN_X, ry, CONTENT_W, 21, { fill: bg, stroke: C.border, lineWidth: 0.55 });

      const subAcc = sb.maxMarks > 0 ? `${Math.max(0, Math.round((sb.marksObtained / sb.maxMarks) * 100))}%` : '0%';
      let cx = MARGIN_X;

      doc.drawText(truncateText(sb.subjectName || sb.subjectId || 'Subject', cols[0].w - 16, 'F2', 8.8), cx + 10, ry + 13.5, {
        font: 'F2',
        size: 8.8,
        color: C.ink
      });
      cx += cols[0].w;

      doc.drawText(`${sb.marksObtained ?? 0} / ${sb.maxMarks ?? 0}`, cx + cols[1].w / 2, ry + 13.5, {
        font: 'F2',
        size: 8.8,
        color: C.ink,
        align: 'center'
      });
      cx += cols[1].w;

      doc.drawText(subAcc, cx + cols[2].w / 2, ry + 13.5, { font: 'F1', size: 8.8, color: C.muted, align: 'center' });
      cx += cols[2].w;

      doc.drawText(String(sb.correct ?? 0), cx + cols[3].w / 2, ry + 13.5, { font: 'F2', size: 8.8, color: C.ink, align: 'center' });
      cx += cols[3].w;

      doc.drawText(String(sb.wrong ?? 0), cx + cols[4].w / 2, ry + 13.5, { font: 'F2', size: 8.8, color: C.ink, align: 'center' });
      cx += cols[4].w;

      doc.drawText(String(sb.skipped ?? 0), cx + cols[5].w / 2, ry + 13.5, { font: 'F1', size: 8.8, color: C.subtle, align: 'center' });
      doc.y += 21;
    });

    if (subjects.length > 1) {
      doc.ensureSpace(22);
      const ry = doc.y;
      doc.drawRect(MARGIN_X, ry, CONTENT_W, 21, { fill: C.surfaceAlt, stroke: C.borderStrong, lineWidth: 0.7 });
      let cx = MARGIN_X;
      doc.drawText('TOTAL', cx + 10, ry + 13.5, { font: 'F2', size: 8.5, color: C.ink });
      cx += cols[0].w;
      doc.drawText(`${submission.score ?? 0} / ${submission.totalMarks ?? 0}`, cx + cols[1].w / 2, ry + 13.5, { font: 'F2', size: 8.5, color: C.ink, align: 'center' });
      cx += cols[1].w;
      doc.drawText(`${submission.percentage ?? 0}%`, cx + cols[2].w / 2, ry + 13.5, { font: 'F2', size: 8.5, color: C.ink, align: 'center' });
      cx += cols[2].w;
      doc.drawText(String(submission.correctCount ?? 0), cx + cols[3].w / 2, ry + 13.5, { font: 'F2', size: 8.5, color: C.ink, align: 'center' });
      cx += cols[3].w;
      doc.drawText(String(submission.wrongCount ?? 0), cx + cols[4].w / 2, ry + 13.5, { font: 'F2', size: 8.5, color: C.ink, align: 'center' });
      cx += cols[4].w;
      doc.drawText(String(submission.skippedCount ?? 0), cx + cols[5].w / 2, ry + 13.5, { font: 'F1', size: 8.5, color: C.subtle, align: 'center' });
      doc.y += 21;
    }

    doc.y += 16;
  }

  // 4. Clean Monochrome Answer Sheet Review
  const review = Array.isArray(submission.review) ? submission.review : [];
  drawSectionHeading(
    doc,
    'Checked Answer Sheet',
    review.length > 0 ? `${review.length} Questions` : 'Summary Only'
  );

  if (review.length === 0) {
    doc.ensureSpace(44);
    doc.drawRoundedRect(MARGIN_X, doc.y, CONTENT_W, 38, 5, { fill: C.surface, stroke: C.border, lineWidth: 0.75 });
    doc.drawText(
      submission.reviewHidden
        ? 'Detailed question-by-question answer review is hidden by Sir for this exam.'
        : 'Question review details are not attached to this summary copy.',
      MARGIN_X + 12,
      doc.y + 22,
      { font: 'F1', size: 9, color: C.muted }
    );
    doc.y += 46;
  } else {
    const letters = ['A', 'B', 'C', 'D'];
    const innerW = CONTENT_W - 24;

    review.forEach((item, idx) => {
      const qStatus = item.status || 'skipped';
      const statusColor = qStatus === 'correct' ? C.passText : qStatus === 'wrong' ? C.failText : C.subtle;
      const statusText = qStatus === 'correct'
        ? `Correct (+${item.marksAwarded ?? 1})`
        : qStatus === 'wrong'
          ? `Wrong (${item.marksAwarded ?? 0})`
          : 'Skipped (0)';

      const qLines = wrapText(item.question || '', innerW, 'F2', 9.4);
      const codeLines = item.code ? wrapText(item.code, innerW - 14, 'F3', 8) : [];

      const hasChosen = item.selectedIndex !== null && item.selectedIndex !== undefined && item.options?.[item.selectedIndex] !== undefined;
      const chosenStr = hasChosen ? `${letters[item.selectedIndex]}. ${item.options[item.selectedIndex]}` : 'Not Attempted';
      const correctStr = item.options?.[item.correctIndex] !== undefined
        ? `${letters[item.correctIndex]}. ${item.options[item.correctIndex]}`
        : 'N/A';

      const ansLabelW = 76;
      const selectedLines = wrapText(chosenStr, innerW - ansLabelW, qStatus === 'wrong' ? 'F2' : 'F1', 8.7);
      const correctLines = wrapText(correctStr, innerW - ansLabelW, 'F2', 8.7);
      const expLines = item.explanation ? wrapText(`Note: ${item.explanation}`, innerW, 'F1', 8.1) : [];

      const headerH = 21;
      const qH = qLines.length * 12.5 + 4;
      const codeH = codeLines.length > 0 ? codeLines.length * 10.5 + 18 : 0;
      const selH = selectedLines.length * 11.5 + 3;
      const corH = correctLines.length * 11.5 + 4;
      const expH = expLines.length > 0 ? expLines.length * 10.5 + 6 : 0;
      const cardH = headerH + 10 + qH + codeH + selH + corH + expH + 8;

      if (cardH <= BOTTOM_LIMIT - TOP_MARGIN_NEXT) {
        doc.ensureSpace(cardH + 8);
      } else {
        doc.ensureSpace(140);
      }

      const cy = doc.y;
      doc.drawRoundedRect(MARGIN_X, cy, CONTENT_W, cardH, 5, { fill: C.white, stroke: C.borderStrong, lineWidth: 0.7 });
      doc.drawRect(MARGIN_X + 0.5, cy + 0.5, CONTENT_W - 1, headerH, { fill: C.surface });
      doc.drawLine(MARGIN_X, cy + headerH, MARGIN_X + CONTENT_W, cy + headerH, C.border, 0.6);

      doc.drawText(`Q${idx + 1}  •  ${item.subjectName || 'MCQ'}`, MARGIN_X + 12, cy + 14, {
        font: 'F2',
        size: 8.6,
        color: C.slateDark
      });
      doc.drawText(statusText, MARGIN_X + CONTENT_W - 12, cy + 14, {
        font: 'F2',
        size: 8.4,
        color: statusColor,
        align: 'right'
      });

      let cursorY = cy + headerH + 14;
      const textX = MARGIN_X + 12;

      doc.drawLines(qLines, textX, cursorY, { font: 'F2', size: 9.4, lineHeight: 12.5, color: C.ink });
      cursorY += qLines.length * 12.5 + 2;

      if (codeLines.length > 0) {
        const boxTop = cursorY - 5;
        const boxH = codeLines.length * 10.5 + 10;
        doc.drawRoundedRect(textX, boxTop, innerW, boxH, 4, { fill: C.surface, stroke: C.border, lineWidth: 0.6 });
        doc.drawLines(codeLines, textX + 8, boxTop + 12, { font: 'F3', size: 8, lineHeight: 10.5, color: C.slateDark });
        cursorY = boxTop + boxH + 13;
      }

      doc.drawText('Your Answer:', textX, cursorY, { font: 'F1', size: 8.6, color: C.subtle });
      doc.drawLines(selectedLines, textX + ansLabelW, cursorY, {
        font: qStatus === 'wrong' ? 'F2' : 'F1',
        size: 8.7,
        lineHeight: 11.5,
        color: qStatus === 'wrong' ? C.failText : C.ink
      });
      cursorY += selectedLines.length * 11.5 + 3;

      doc.drawText('Correct Answer:', textX, cursorY, { font: 'F2', size: 8.6, color: C.passText });
      doc.drawLines(correctLines, textX + ansLabelW, cursorY, {
        font: 'F2',
        size: 8.7,
        lineHeight: 11.5,
        color: C.passText
      });
      cursorY += correctLines.length * 11.5 + 4;

      if (expLines.length > 0) {
        doc.drawLines(expLines, textX, cursorY + 1, { font: 'F1', size: 8.1, lineHeight: 10.5, color: C.muted });
      }

      doc.y = cy + cardH + 8;
    });
  }

  return doc.buildBuffer({
    studentLabel: `${submission.studentName || 'Student'} (${submission.rollNumber || ''})`,
    examTitle: submission.examTitle || 'Exam',
    instituteName: inst
  });
}

module.exports = {
  generateScoreReportPdf,
  buildPdfFilename
};
