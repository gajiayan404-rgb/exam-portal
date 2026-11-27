const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const PAGE_W = 595.28; // A4 width in pt
const PAGE_H = 841.89; // A4 height in pt
const MARGIN_X = 36;
const CONTENT_W = PAGE_W - MARGIN_X * 2;
const TOP_MARGIN_P1 = 28;
const TOP_MARGIN_NEXT = 54;
const BOTTOM_LIMIT = PAGE_H - 48;

const DEFAULT_LOGO_PATH = path.join(__dirname, '..', 'public', 'assets', 'codeaura-logo.jpg');
let cachedLogo = null;

// Standard Adobe AFM widths (in 1/1000 em) for ASCII 32..126
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
      bytes.push(0x3F); // '?' fallback for unencodable glyphs
    }
  }
  return bytes;
}

function toPdfHexString(str) {
  const bytes = toWinAnsiBytes(str);
  return `<${Buffer.from(bytes).toString('hex').toUpperCase()}>`;
}

function getGlyphWidthUnits(byte, fontKey) {
  if (fontKey === 'F3' || fontKey === 'F4') return 600;
  const widths = fontKey === 'F2' ? HELVETICA_BOLD_WIDTHS : HELVETICA_WIDTHS;
  if (byte >= 32 && byte <= 126) {
    return widths[byte - 32];
  }
  if (byte === 0x95) return 350; // bullet
  if (byte === 0x96 || byte === 0x97) return fontKey === 'F2' ? 556 : 556; // en/em dash
  if (byte === 0x85) return 1000; // ellipsis
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
        // Hard-break ultra-long tokens (URLs, minified identifiers)
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
  const clean = String(hex || '#0F766E').replace('#', '').trim();
  if (!/^[0-9a-fA-F]{6}$/.test(clean)) return [0.059, 0.463, 0.431];
  return [
    parseInt(clean.slice(0, 2), 16) / 255,
    parseInt(clean.slice(2, 4), 16) / 255,
    parseInt(clean.slice(4, 6), 16) / 255
  ];
}

const C = {
  teal: parseHexColor('#0F766E'),
  tealDark: parseHexColor('#134E4A'),
  tealSoft: parseHexColor('#F0FDFA'),
  tealBorder: parseHexColor('#99F6E4'),
  orange: parseHexColor('#F97316'),
  cream: parseHexColor('#FFF8EC'),
  creamBorder: parseHexColor('#FDE68A'),
  ink: parseHexColor('#0F172A'),
  muted: parseHexColor('#475569'),
  subtle: parseHexColor('#64748B'),
  border: parseHexColor('#E2E8F0'),
  borderStrong: parseHexColor('#CBD5E1'),
  surface: parseHexColor('#F8FAFC'),
  surfaceAlt: parseHexColor('#F1F5F9'),
  white: [1, 1, 1],
  green: parseHexColor('#059669'),
  greenSoft: parseHexColor('#ECFDF5'),
  greenBorder: parseHexColor('#A7F3D0'),
  red: parseHexColor('#DC2626'),
  redSoft: parseHexColor('#FEF2F2'),
  redBorder: parseHexColor('#FECACA'),
  amber: parseHexColor('#B45309'),
  amberSoft: parseHexColor('#FFFBEB'),
  amberBorder: parseHexColor('#FDE68A'),
  codeBg: parseHexColor('#0F172A'),
  codeText: parseHexColor('#E2E8F0')
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
    while (offset < buffer.length && buffer[offset] === 0xFF) {
      offset += 1;
    }
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
        const bitsPerComponent = buffer[offset + 2];
        const height = buffer.readUInt16BE(offset + 3);
        const width = buffer.readUInt16BE(offset + 5);
        const components = buffer[offset + 7];
        return { bytes: buffer, width, height, components, bitsPerComponent };
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
    const bx = x.toFixed(2);
    const by = this.py(y + h).toFixed(2);
    const bw = w.toFixed(2);
    const bh = h.toFixed(2);

    const ops = ['q'];
    if (fill) ops.push(`${rgbStr(fill)} rg`);
    if (stroke) {
      ops.push(`${rgbStr(stroke)} RG`);
      ops.push(`${lineWidth.toFixed(2)} w`);
    }
    ops.push(`${bx} ${by} ${bw} ${bh} re`);
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

    const pathOps = [
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
    ];
    this.pushOp(pathOps.join('\n'));
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

  drawCircle(cx, cy, r, { fill = null, stroke = null, lineWidth = 0.75 } = {}) {
    const k = 0.55228475 * r;
    const py = this.py(cy);
    const ops = [
      'q',
      ...(fill ? [`${rgbStr(fill)} rg`] : []),
      ...(stroke ? [`${rgbStr(stroke)} RG`, `${lineWidth.toFixed(2)} w`] : []),
      `${(cx + r).toFixed(2)} ${py.toFixed(2)} m`,
      `${(cx + r).toFixed(2)} ${(py + k).toFixed(2)} ${(cx + k).toFixed(2)} ${(py + r).toFixed(2)} ${cx.toFixed(2)} ${(py + r).toFixed(2)} c`,
      `${(cx - k).toFixed(2)} ${(py + r).toFixed(2)} ${(cx - r).toFixed(2)} ${(py + k).toFixed(2)} ${(cx - r).toFixed(2)} ${py.toFixed(2)} c`,
      `${(cx - r).toFixed(2)} ${(py - k).toFixed(2)} ${(cx - k).toFixed(2)} ${(py - r).toFixed(2)} ${cx.toFixed(2)} ${(py - r).toFixed(2)} c`,
      `${(cx + k).toFixed(2)} ${(py - r).toFixed(2)} ${(cx + r).toFixed(2)} ${(py - k).toFixed(2)} ${(cx + r).toFixed(2)} ${py.toFixed(2)} c`,
      'h',
      fill && stroke ? 'B' : fill ? 'f' : 'S',
      'Q'
    ];
    this.pushOp(ops.join('\n'));
  }

  drawCheckVector(cx, cy, size, color = C.green) {
    const s = size / 2;
    this.pushOp([
      'q',
      `${rgbStr(color)} RG`,
      '1.60 w',
      '1 J',
      '1 j',
      `${(cx - s * 0.72).toFixed(2)} ${this.py(cy).toFixed(2)} m`,
      `${(cx - s * 0.15).toFixed(2)} ${this.py(cy + s * 0.58).toFixed(2)} l`,
      `${(cx + s * 0.78).toFixed(2)} ${this.py(cy - s * 0.55).toFixed(2)} l`,
      'S',
      'Q'
    ].join('\n'));
  }

  drawCrossVector(cx, cy, size, color = C.red) {
    const s = size * 0.38;
    this.pushOp([
      'q',
      `${rgbStr(color)} RG`,
      '1.50 w',
      '1 J',
      `${(cx - s).toFixed(2)} ${this.py(cy - s).toFixed(2)} m`,
      `${(cx + s).toFixed(2)} ${this.py(cy + s).toFixed(2)} l`,
      `${(cx + s).toFixed(2)} ${this.py(cy - s).toFixed(2)} m`,
      `${(cx - s).toFixed(2)} ${this.py(cy + s).toFixed(2)} l`,
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

      // Running slim header on Page 2+
      if (i > 0) {
        this.drawRect(MARGIN_X, 18, CONTENT_W * 0.72, 2.2, { fill: C.teal });
        this.drawRect(MARGIN_X + CONTENT_W * 0.72, 18, CONTENT_W * 0.28, 2.2, { fill: C.orange });
        this.drawText(`${instituteName}  •  Exam Score Report`, MARGIN_X, 33, { font: 'F2', size: 8.5, color: C.tealDark });
        this.drawText(
          truncateText(`${studentLabel}  •  ${examTitle}`, 265, 'F1', 8.5),
          MARGIN_X + CONTENT_W,
          33,
          { font: 'F1', size: 8.5, color: C.muted, align: 'right' }
        );
        this.drawLine(MARGIN_X, 40, MARGIN_X + CONTENT_W, 40, C.border, 0.7);
      }

      // Consistent professional footer on every page
      const footerRuleY = PAGE_H - 36;
      this.drawLine(MARGIN_X, footerRuleY, MARGIN_X + CONTENT_W, footerRuleY, C.border, 0.75);
      this.drawText(
        `${instituteName}  •  Official Auto-Graded Exam Score Report`,
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

      const combinedStream = [...this.currentOps, ...origOps].join('\n');
      finalizedStreams.push(combinedStream);
    }

    // Build PDF objects deterministically
    const objects = [];
    const addObj = (bodyBufOrStr) => {
      objects.push(Buffer.isBuffer(bodyBufOrStr) ? bodyBufOrStr : Buffer.from(bodyBufOrStr, 'latin1'));
      return objects.length; // 1-based object number
    };

    const catalogNum = 1;
    const pagesNum = 2;
    addObj(''); // placeholder 1
    addObj(''); // placeholder 2

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

function drawSectionHeading(doc, title, badgeText = '') {
  doc.ensureSpace(28);
  const y = doc.y;
  doc.drawRoundedRect(MARGIN_X, y + 1, 4, 14, 2, { fill: C.teal });
  doc.drawText(title, MARGIN_X + 11, y + 12, { font: 'F2', size: 11.5, color: C.ink });
  if (badgeText) {
    const bw = measureTextWidth(badgeText, 'F2', 8) + 14;
    doc.drawRoundedRect(MARGIN_X + CONTENT_W - bw, y, bw, 16, 8, { fill: C.tealSoft, stroke: C.tealBorder, lineWidth: 0.7 });
    doc.drawText(badgeText, MARGIN_X + CONTENT_W - bw / 2, y + 10.8, { font: 'F2', size: 8, color: C.tealDark, align: 'center' });
  }
  doc.y += 22;
}

function generateScoreReportPdf({ submission, instituteName = 'CodeAura Classroom', teacherName = 'Sir' }) {
  const logoAsset = loadLogoAsset();
  const doc = new PdfDocumentBuilder(logoAsset);
  doc.newPage();

  const inst = String(instituteName || 'CodeAura Classroom').trim() || 'CodeAura Classroom';
  const passed = Boolean(submission.passed);
  const statusLabel = passed ? 'PASSED' : 'NEEDS PRACTICE';
  const statusColor = passed ? C.green : C.red;
  const statusSoft = passed ? C.greenSoft : C.redSoft;
  const statusBorder = passed ? C.greenBorder : C.redBorder;

  // 1. Top Dual-Color Brand Bar (Teal + Orange matching CodeAura Logo)
  doc.drawRect(MARGIN_X, doc.y, CONTENT_W * 0.72, 4, { fill: C.teal });
  doc.drawRect(MARGIN_X + CONTENT_W * 0.72, doc.y, CONTENT_W * 0.28, 4, { fill: C.orange });
  doc.y += 8;

  // 2. Official Letterhead Card with Embedded CodeAura Logo
  const headerH = 82;
  doc.drawRoundedRect(MARGIN_X, doc.y, CONTENT_W, headerH, 8, { fill: C.white, stroke: C.border, lineWidth: 0.9 });

  const logoBoxX = MARGIN_X + 10;
  const logoBoxY = doc.y + 8;
  const logoBoxW = 118;
  const logoBoxH = 66;
  doc.drawRoundedRect(logoBoxX, logoBoxY, logoBoxW, logoBoxH, 7, { fill: C.cream, stroke: C.creamBorder, lineWidth: 0.8 });

  if (logoAsset) {
    const pad = 2;
    const maxW = logoBoxW - pad * 2;
    const maxH = logoBoxH - pad * 2;
    const scale = Math.min(maxW / logoAsset.width, maxH / logoAsset.height);
    const dw = logoAsset.width * scale;
    const dh = logoAsset.height * scale;
    doc.drawImage(
      'Im1',
      logoBoxX + (logoBoxW - dw) / 2,
      logoBoxY + (logoBoxH - dh) / 2,
      dw,
      dh
    );
  } else {
    doc.drawText('</> CodeAura', logoBoxX + logoBoxW / 2, logoBoxY + 36, { font: 'F2', size: 12, color: C.tealDark, align: 'center' });
  }

  const textStartX = logoBoxX + logoBoxW + 14;
  const statusPillW = 110;
  const titleMaxW = CONTENT_W - (textStartX - MARGIN_X) - statusPillW - 18;

  doc.drawText(inst.toUpperCase(), textStartX, doc.y + 22, { font: 'F2', size: 8.5, color: C.teal });
  doc.drawText(truncateText('Official Exam Score Report', titleMaxW, 'F2', 16), textStartX, doc.y + 41, {
    font: 'F2',
    size: 16,
    color: C.ink
  });
  doc.drawText(
    truncateText(`Examiner: ${teacherName || 'Sir'}  •  Report ID: ${submission.id || 'N/A'}`, titleMaxW, 'F1', 8.5),
    textStartX,
    doc.y + 56,
    { font: 'F1', size: 8.5, color: C.muted }
  );
  doc.drawText(
    `Submitted: ${formatReportDate(submission.submittedAt)}`,
    textStartX,
    doc.y + 69,
    { font: 'F1', size: 8, color: C.subtle }
  );

  // Right status pill inside letterhead
  const pillX = MARGIN_X + CONTENT_W - statusPillW - 12;
  const pillY = doc.y + 18;
  doc.drawRoundedRect(pillX, pillY, statusPillW, 24, 12, { fill: statusSoft, stroke: statusBorder, lineWidth: 1 });
  if (passed) {
    doc.drawCheckVector(pillX + 16, pillY + 12, 8, statusColor);
  } else {
    doc.drawCrossVector(pillX + 16, pillY + 12, 8, statusColor);
  }
  doc.drawText(statusLabel, pillX + 26 + (statusPillW - 30) / 2, pillY + 15.2, {
    font: 'F2',
    size: 8.8,
    color: statusColor,
    align: 'center'
  });
  doc.drawText(`Pass Mark: >= ${submission.passPercentage || 40}%`, pillX + statusPillW / 2, pillY + 37, {
    font: 'F1',
    size: 7.8,
    color: C.subtle,
    align: 'center'
  });

  doc.y += headerH + 12;

  // 3. Candidate & Examination Metadata Grid
  const metaH = 74;
  doc.drawRoundedRect(MARGIN_X, doc.y, CONTENT_W, metaH, 7, { fill: C.surface, stroke: C.border, lineWidth: 0.8 });
  doc.drawRect(MARGIN_X + 0.5, doc.y + 0.5, CONTENT_W - 1, 18, { fill: C.surfaceAlt });
  doc.drawLine(MARGIN_X, doc.y + 18.5, MARGIN_X + CONTENT_W, doc.y + 18.5, C.border, 0.7);
  doc.drawText('CANDIDATE & ASSESSMENT DETAILS', MARGIN_X + 10, doc.y + 12.5, { font: 'F2', size: 8, color: C.tealDark });

  const col1X = MARGIN_X + 10;
  const col2X = MARGIN_X + CONTENT_W * 0.57;
  const valOffset1 = 74;
  const valOffset2 = 68;
  const maxValW1 = CONTENT_W * 0.57 - 16 - valOffset1;
  const maxValW2 = CONTENT_W * 0.43 - 16 - valOffset2;

  const metaRows = [
    ['Student Name:', submission.studentName || 'N/A', 'Roll Number:', submission.rollNumber || 'N/A'],
    ['Examination:', submission.examTitle || 'Exam', 'Batch / Div:', submission.batch || 'General'],
    ['Student Email:', submission.studentEmail || 'Not Provided', 'Total MCQs:', `${submission.totalQuestions || 0} Questions`]
  ];

  let my = doc.y + 32;
  for (const [l1, v1, l2, v2] of metaRows) {
    doc.drawText(l1, col1X, my, { font: 'F2', size: 8.5, color: C.subtle });
    doc.drawText(truncateText(v1, maxValW1, 'F2', 8.5), col1X + valOffset1, my, { font: 'F2', size: 8.5, color: C.ink });
    doc.drawText(l2, col2X, my, { font: 'F2', size: 8.5, color: C.subtle });
    doc.drawText(truncateText(v2, maxValW2, 'F2', 8.5), col2X + valOffset2, my, { font: 'F2', size: 8.5, color: C.ink });
    my += 15;
  }
  doc.y += metaH + 12;

  // 4. Executive Score & KPI Breakdown
  const heroGap = 10;
  const heroW = 206;
  const kpiAreaW = CONTENT_W - heroW - heroGap;
  const kpiGap = 8;
  const kpiCardW = (kpiAreaW - kpiGap) / 2;
  const scoreBlockH = 92;

  // Left Score Hero Card
  doc.drawRoundedRect(MARGIN_X, doc.y, heroW, scoreBlockH, 8, { fill: C.tealSoft, stroke: C.tealBorder, lineWidth: 1 });
  doc.drawText('TOTAL MARKS OBTAINED', MARGIN_X + heroW / 2, doc.y + 18, { font: 'F2', size: 8, color: C.tealDark, align: 'center' });
  const scoreMain = `${submission.score ?? 0} / ${submission.totalMarks ?? 0}`;
  const scoreSize = measureTextWidth(scoreMain, 'F2', 22) > heroW - 24 ? 17 : 22;
  doc.drawText(scoreMain, MARGIN_X + heroW / 2, doc.y + 44, { font: 'F2', size: scoreSize, color: C.ink, align: 'center' });

  // Vector progress bar
  const barX = MARGIN_X + 20;
  const barY = doc.y + 54;
  const barW = heroW - 40;
  const pct = Math.max(0, Math.min(100, Number(submission.percentage) || 0));
  doc.drawRoundedRect(barX, barY, barW, 7, 3.5, { fill: C.white, stroke: C.tealBorder, lineWidth: 0.6 });
  if (pct > 0) {
    doc.drawRoundedRect(barX, barY, Math.max(7, (barW * pct) / 100), 7, 3.5, { fill: statusColor });
  }
  doc.drawText(`${submission.percentage ?? 0}% Overall Score  •  ${statusLabel}`, MARGIN_X + heroW / 2, doc.y + 77, {
    font: 'F2',
    size: 9,
    color: statusColor,
    align: 'center'
  });

  // Right 2x2 KPI Mini-Cards
  const kpiH = (scoreBlockH - kpiGap) / 2;
  const kpis = [
    { label: 'CORRECT ANSWERS', value: String(submission.correctCount ?? 0), accent: C.green, bg: C.greenSoft, border: C.greenBorder },
    { label: 'WRONG ANSWERS', value: String(submission.wrongCount ?? 0), accent: C.red, bg: C.redSoft, border: C.redBorder },
    { label: 'SKIPPED QUESTIONS', value: String(submission.skippedCount ?? 0), accent: C.subtle, bg: C.surface, border: C.border },
    { label: 'TIME TAKEN', value: formatDuration(submission.timeTakenSeconds), accent: C.teal, bg: C.tealSoft, border: C.tealBorder }
  ];

  const kpiX0 = MARGIN_X + heroW + heroGap;
  for (let i = 0; i < kpis.length; i++) {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const kx = kpiX0 + col * (kpiCardW + kpiGap);
    const ky = doc.y + row * (kpiH + kpiGap);
    const item = kpis[i];
    doc.drawRoundedRect(kx, ky, kpiCardW, kpiH, 6, { fill: item.bg, stroke: item.border, lineWidth: 0.8 });
    doc.drawRoundedRect(kx + 0.5, ky + 6, 3, kpiH - 12, 1.5, { fill: item.accent });
    doc.drawText(item.label, kx + 11, ky + 15, { font: 'F2', size: 7.2, color: C.subtle });
    doc.drawText(item.value, kx + 11, ky + 33, { font: i === 3 ? 'F4' : 'F2', size: 15, color: item.accent });
  }

  doc.y += scoreBlockH + 9;

  // 5. Proctoring Compliance Strip
  const proctor = submission.proctoring || {};
  const vCount = Number(proctor.violationsCount) || 0;
  const proctorText = vCount > 0
    ? `Proctoring Alert: ${vCount} Violation(s) Logged${proctor.autoSubmittedReason === 'proctor-limit' ? ' (Auto-submitted on violation limit)' : ''}`
    : 'Proctoring Integrity: Clean (0 Violations Recorded)';
  const pBg = vCount > 0 ? C.redSoft : C.greenSoft;
  const pBorder = vCount > 0 ? C.redBorder : C.greenBorder;
  const pColor = vCount > 0 ? C.red : C.green;

  const events = vCount > 0 && Array.isArray(proctor.events) ? proctor.events.slice(0, 4) : [];
  const eventSummary = events.length > 0
    ? `Events: ${events.map((ev) => `${ev.type || 'flag'} on Q${ev.questionNumber || '?'}`).join('  |  ')}`
    : '';
  const proctorH = eventSummary ? 36 : 24;

  doc.drawRoundedRect(MARGIN_X, doc.y, CONTENT_W, proctorH, 6, { fill: pBg, stroke: pBorder, lineWidth: 0.8 });
  if (vCount > 0) {
    doc.drawCrossVector(MARGIN_X + 14, doc.y + 12, 7.5, pColor);
  } else {
    doc.drawCheckVector(MARGIN_X + 14, doc.y + 12, 7.5, pColor);
  }
  doc.drawText(truncateText(proctorText, CONTENT_W - 34, 'F2', 8.8), MARGIN_X + 26, doc.y + 15, {
    font: 'F2',
    size: 8.8,
    color: pColor
  });
  if (eventSummary) {
    doc.drawText(truncateText(eventSummary, CONTENT_W - 34, 'F1', 7.8), MARGIN_X + 26, doc.y + 28, {
      font: 'F1',
      size: 7.8,
      color: C.muted
    });
  }
  doc.y += proctorH + 14;

  // 6. Subject-Wise Performance Breakdown Table
  const subjects = Array.isArray(submission.subjectBreakdown) ? submission.subjectBreakdown : [];
  if (subjects.length > 0) {
    drawSectionHeading(doc, 'Subject-Wise Performance Breakdown', `${subjects.length} Subject${subjects.length === 1 ? '' : 's'}`);

    const cols = [
      { label: 'Subject', w: 179.28, align: 'left' },
      { label: 'Marks', w: 80, align: 'center' },
      { label: 'Accuracy', w: 72, align: 'center' },
      { label: 'Correct', w: 64, align: 'center' },
      { label: 'Wrong', w: 64, align: 'center' },
      { label: 'Skipped', w: 64, align: 'center' }
    ];

    const drawTableHeader = () => {
      doc.ensureSpace(44);
      const hy = doc.y;
      doc.drawRoundedRect(MARGIN_X, hy, CONTENT_W, 22, 5, { fill: C.tealDark });
      let cx = MARGIN_X;
      for (const col of cols) {
        const tx = col.align === 'center' ? cx + col.w / 2 : cx + 10;
        doc.drawText(col.label, tx, hy + 14.5, { font: 'F2', size: 8.5, color: C.white, align: col.align });
        cx += col.w;
      }
      doc.y += 22;
    };

    drawTableHeader();

    subjects.forEach((sb, idx) => {
      if (doc.ensureSpace(22)) {
        drawTableHeader();
      }
      const ry = doc.y;
      const bg = idx % 2 === 1 ? C.surface : C.white;
      doc.drawRect(MARGIN_X, ry, CONTENT_W, 21, { fill: bg, stroke: C.border, lineWidth: 0.5 });

      const subAcc = sb.maxMarks > 0 ? `${Math.max(0, Math.round((sb.marksObtained / sb.maxMarks) * 100))}%` : '0%';
      const dotColor = parseHexColor(sb.color || '#0F766E');

      let cx = MARGIN_X;
      doc.drawCircle(cx + 12, ry + 10.5, 3, { fill: dotColor });
      doc.drawText(truncateText(sb.subjectName || sb.subjectId || 'Subject', cols[0].w - 24, 'F2', 8.8), cx + 20, ry + 13.5, {
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

      doc.drawText(String(sb.correct ?? 0), cx + cols[3].w / 2, ry + 13.5, { font: 'F2', size: 8.8, color: C.green, align: 'center' });
      cx += cols[3].w;

      doc.drawText(String(sb.wrong ?? 0), cx + cols[4].w / 2, ry + 13.5, { font: 'F2', size: 8.8, color: C.red, align: 'center' });
      cx += cols[4].w;

      doc.drawText(String(sb.skipped ?? 0), cx + cols[5].w / 2, ry + 13.5, { font: 'F1', size: 8.8, color: C.subtle, align: 'center' });
      doc.y += 21;
    });

    if (subjects.length > 1) {
      doc.ensureSpace(22);
      const ry = doc.y;
      doc.drawRect(MARGIN_X, ry, CONTENT_W, 21, { fill: C.tealSoft, stroke: C.tealBorder, lineWidth: 0.7 });
      let cx = MARGIN_X;
      doc.drawText('OVERALL TOTAL', cx + 10, ry + 13.5, { font: 'F2', size: 8.5, color: C.tealDark });
      cx += cols[0].w;
      doc.drawText(`${submission.score ?? 0} / ${submission.totalMarks ?? 0}`, cx + cols[1].w / 2, ry + 13.5, { font: 'F2', size: 8.5, color: C.tealDark, align: 'center' });
      cx += cols[1].w;
      doc.drawText(`${submission.percentage ?? 0}%`, cx + cols[2].w / 2, ry + 13.5, { font: 'F2', size: 8.5, color: C.tealDark, align: 'center' });
      cx += cols[2].w;
      doc.drawText(String(submission.correctCount ?? 0), cx + cols[3].w / 2, ry + 13.5, { font: 'F2', size: 8.5, color: C.green, align: 'center' });
      cx += cols[3].w;
      doc.drawText(String(submission.wrongCount ?? 0), cx + cols[4].w / 2, ry + 13.5, { font: 'F2', size: 8.5, color: C.red, align: 'center' });
      cx += cols[4].w;
      doc.drawText(String(submission.skippedCount ?? 0), cx + cols[5].w / 2, ry + 13.5, { font: 'F2', size: 8.5, color: C.subtle, align: 'center' });
      doc.y += 21;
    }

    doc.y += 14;
  }

  // 7. Auto-Checked Answer Sheet
  const review = Array.isArray(submission.review) ? submission.review : [];
  drawSectionHeading(
    doc,
    'Checked Answer Sheet',
    review.length > 0 ? `${review.length} Question${review.length === 1 ? '' : 's'}` : 'Summary Only'
  );

  if (review.length === 0) {
    doc.ensureSpace(44);
    doc.drawRoundedRect(MARGIN_X, doc.y, CONTENT_W, 38, 6, { fill: C.surface, stroke: C.border, lineWidth: 0.8 });
    doc.drawText(
      submission.reviewHidden
        ? 'Detailed question-by-question answer review is currently hidden by Sir for this exam.'
        : 'Question review details are not attached to this summary copy.',
      MARGIN_X + 12,
      doc.y + 22,
      { font: 'F1', size: 9, color: C.muted }
    );
    doc.y += 46;
  } else {
    const letters = ['A', 'B', 'C', 'D'];
    const innerPad = 12;
    const innerW = CONTENT_W - innerPad * 2 - 4;

    review.forEach((item, idx) => {
      const qStatus = item.status || 'skipped';
      const accent = qStatus === 'correct' ? C.green : qStatus === 'wrong' ? C.red : C.subtle;
      const badgeBg = qStatus === 'correct' ? C.greenSoft : qStatus === 'wrong' ? C.redSoft : C.surfaceAlt;
      const badgeBorder = qStatus === 'correct' ? C.greenBorder : qStatus === 'wrong' ? C.redBorder : C.borderStrong;
      const statusText = qStatus === 'correct'
        ? `CORRECT (+${item.marksAwarded ?? 1})`
        : qStatus === 'wrong'
          ? `WRONG (${item.marksAwarded ?? 0})`
          : 'SKIPPED (0)';

      const qLines = wrapText(item.question || '', innerW, 'F2', 9.5);
      const codeLines = item.code ? wrapText(item.code, innerW - 14, 'F3', 8) : [];

      const hasChosen = item.selectedIndex !== null && item.selectedIndex !== undefined && item.options?.[item.selectedIndex] !== undefined;
      const chosenStr = hasChosen ? `${letters[item.selectedIndex]}. ${item.options[item.selectedIndex]}` : 'Not Attempted';
      const correctStr = item.options?.[item.correctIndex] !== undefined
        ? `${letters[item.correctIndex]}. ${item.options[item.correctIndex]}`
        : 'N/A';

      const ansLabelW = 78;
      const selectedLines = wrapText(chosenStr, innerW - ansLabelW, qStatus === 'wrong' ? 'F2' : 'F1', 8.7);
      const correctLines = wrapText(correctStr, innerW - ansLabelW, 'F2', 8.7);
      const expLines = item.explanation ? wrapText(`Explanation: ${item.explanation}`, innerW - 12, 'F1', 8.2) : [];

      const headerH = 22;
      const qH = qLines.length * 12.5 + 4;
      const codeH = codeLines.length > 0 ? codeLines.length * 10.5 + 22 : 0;
      const selH = selectedLines.length * 11.5 + 3;
      const corH = correctLines.length * 11.5 + 4;
      const expH = expLines.length > 0 ? expLines.length * 10.5 + 16 : 0;
      const cardH = headerH + 10 + qH + codeH + selH + corH + expH + 10;

      if (cardH <= BOTTOM_LIMIT - TOP_MARGIN_NEXT) {
        doc.ensureSpace(cardH + 8);
      } else {
        doc.ensureSpace(140);
      }

      const cy = doc.y;
      doc.drawRoundedRect(MARGIN_X, cy, CONTENT_W, cardH, 7, { fill: C.white, stroke: C.border, lineWidth: 0.8 });
      // Left status stripe
      doc.drawRoundedRect(MARGIN_X + 0.5, cy + 4, 3.5, cardH - 8, 1.8, { fill: accent });

      // Top strip inside question card
      doc.drawRect(MARGIN_X + 4.5, cy + 0.5, CONTENT_W - 5, headerH, { fill: C.surface });
      doc.drawLine(MARGIN_X + 4.5, cy + headerH, MARGIN_X + CONTENT_W, cy + headerH, C.border, 0.5);

      doc.drawText(`Q${idx + 1}  •  ${item.subjectName || 'MCQ'}`, MARGIN_X + 14, cy + 14.5, {
        font: 'F2',
        size: 8.6,
        color: C.tealDark
      });

      const pillW = measureTextWidth(statusText, 'F2', 7.6) + 16;
      const pillXPos = MARGIN_X + CONTENT_W - pillW - 8;
      doc.drawRoundedRect(pillXPos, cy + 3.5, pillW, 15, 7.5, { fill: badgeBg, stroke: badgeBorder, lineWidth: 0.6 });
      doc.drawText(statusText, pillXPos + pillW / 2, cy + 13.5, {
        font: 'F2',
        size: 7.6,
        color: accent,
        align: 'center'
      });

      let cursorY = cy + headerH + 14;
      const textX = MARGIN_X + 14;

      // Question text
      doc.drawLines(qLines, textX, cursorY, { font: 'F2', size: 9.5, lineHeight: 12.5, color: C.ink });
      cursorY += qLines.length * 12.5 + 2;

      // Optional code snippet
      if (codeLines.length > 0) {
        const boxTop = cursorY - 6;
        const boxH = codeLines.length * 10.5 + 11;
        doc.drawRoundedRect(textX, boxTop, innerW, boxH, 5, { fill: C.codeBg });
        doc.drawLines(codeLines, textX + 8, boxTop + 12.5, { font: 'F3', size: 8, lineHeight: 10.5, color: C.codeText });
        cursorY = boxTop + boxH + 14;
      }

      // Selected Answer
      doc.drawText('Your Answer:', textX, cursorY, { font: 'F2', size: 8.6, color: C.subtle });
      doc.drawLines(selectedLines, textX + ansLabelW, cursorY, {
        font: qStatus === 'wrong' ? 'F2' : 'F1',
        size: 8.7,
        lineHeight: 11.5,
        color: qStatus === 'wrong' ? C.red : qStatus === 'correct' ? C.green : C.subtle
      });
      cursorY += selectedLines.length * 11.5 + 3;

      // Correct Answer
      doc.drawText('Correct Answer:', textX, cursorY, { font: 'F2', size: 8.6, color: C.green });
      doc.drawLines(correctLines, textX + ansLabelW, cursorY, {
        font: 'F2',
        size: 8.7,
        lineHeight: 11.5,
        color: C.green
      });
      cursorY += correctLines.length * 11.5 + 4;

      // Optional Explanation
      if (expLines.length > 0) {
        const expTop = cursorY - 7;
        const expBoxH = expLines.length * 10.5 + 8;
        doc.drawRoundedRect(textX, expTop, innerW, expBoxH, 4, { fill: C.tealSoft, stroke: C.tealBorder, lineWidth: 0.5 });
        doc.drawLines(expLines, textX + 7, expTop + 11, { font: 'F1', size: 8.2, lineHeight: 10.5, color: C.muted });
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
