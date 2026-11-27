const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const tls = require('node:tls');
const crypto = require('node:crypto');
const { generateScoreReportPdf, buildPdfFilename } = require('./pdfReport');

const LOGO_PATH = path.join(__dirname, '..', 'public', 'assets', 'codeaura-logo.jpg');
let cachedLogoBuffer = null;

function getLogoBuffer() {
  if (cachedLogoBuffer !== null) return cachedLogoBuffer;
  try {
    if (fs.existsSync(LOGO_PATH)) {
      cachedLogoBuffer = fs.readFileSync(LOGO_PATH);
      return cachedLogoBuffer;
    }
  } catch {}
  cachedLogoBuffer = false;
  return null;
}

function getInlineLogoAttachment() {
  const buf = getLogoBuffer();
  if (!buf) return null;
  return {
    cid: 'codeaura-logo@codeaura',
    filename: 'codeaura-logo.jpg',
    contentType: 'image/jpeg',
    content: buf
  };
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function encodeMimeSubject(subject) {
  const str = String(subject || '');
  if (/^[\x20-\x7E]*$/.test(str)) {
    return str;
  }
  return `=?UTF-8?B?${Buffer.from(str, 'utf8').toString('base64')}?=`;
}

function wrapBufferBase64(bufOrText) {
  const buf = Buffer.isBuffer(bufOrText) ? bufOrText : Buffer.from(String(bufOrText || ''), 'utf8');
  const b64 = buf.toString('base64');
  return b64.match(/.{1,76}/g)?.join('\r\n') || '';
}

function sanitizeHeaderFilename(name, fallback = 'attachment.bin') {
  return String(name || fallback).replace(/[\r\n"\\]/g, '').trim() || fallback;
}

function dotStuff(str) {
  return str.replace(/\r?\n\./g, '\r\n..').replace(/^\./, '..');
}

function parseEmailList(raw) {
  return String(raw || '')
    .split(/[,;\s]+/)
    .map((e) => e.trim())
    .filter((e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e));
}

/**
 * Low-level SMTP conversation helper supporting port 465 (TLS) and 587 (STARTTLS).
 */
class SmtpConnection {
  constructor({ host, port, secure, timeoutMs = 15000, rejectUnauthorized = true }) {
    this.host = host;
    this.port = Number(port) || (secure ? 465 : 587);
    this.secure = Boolean(secure);
    this.timeoutMs = timeoutMs;
    this.rejectUnauthorized = rejectUnauthorized !== false;
    this.socket = null;
    this.buffer = '';
    this.pending = null;
  }

  _attachListeners(sock) {
    this.buffer = '';
    sock.setEncoding('utf8');
    sock.setTimeout(this.timeoutMs);

    sock.on('data', (chunk) => {
      this.buffer += chunk;
      this._tryResolveReply();
    });

    sock.on('error', (err) => {
      if (this.pending) {
        const { reject } = this.pending;
        this.pending = null;
        reject(err);
      }
    });

    sock.on('timeout', () => {
      const err = new Error(`SMTP connection timed out after ${this.timeoutMs}ms.`);
      if (this.pending) {
        const { reject } = this.pending;
        this.pending = null;
        reject(err);
      }
      sock.destroy();
    });

    sock.on('close', () => {
      if (this.pending) {
        const { reject } = this.pending;
        this.pending = null;
        reject(new Error('SMTP connection closed unexpectedly.'));
      }
    });
  }

  _tryResolveReply() {
    if (!this.pending) return;
    const lines = this.buffer.split(/\r?\n/);
    const completeCount = lines.length - 1;
    if (completeCount <= 0) return;

    const collected = [];
    for (let i = 0; i < completeCount; i++) {
      const line = lines[i];
      if (!line) continue;
      collected.push(line);
      if (/^\d{3} /.test(line)) {
        this.buffer = lines.slice(i + 1).join('\n');
        const code = Number(line.slice(0, 3));
        const text = collected.join('\n');
        const { resolve, reject } = this.pending;
        this.pending = null;
        if (code >= 400) {
          reject(new Error(`SMTP Error ${code}: ${text}`));
        } else {
          resolve({ code, text, lines: collected });
        }
        return;
      }
    }
  }

  readReply() {
    if (this.pending) {
      return Promise.reject(new Error('Concurrent SMTP read not allowed.'));
    }
    return new Promise((resolve, reject) => {
      this.pending = { resolve, reject };
      this._tryResolveReply();
    });
  }

  async command(cmd) {
    const replyPromise = this.readReply();
    this.socket.write(`${cmd}\r\n`);
    return replyPromise;
  }

  async connect() {
    await new Promise((resolve, reject) => {
      const onConnect = () => {
        this.socket.removeListener('error', onError);
        resolve();
      };
      const onError = (err) => {
        reject(err);
      };

      if (this.secure) {
        this.socket = tls.connect({
          host: this.host,
          port: this.port,
          servername: this.host,
          rejectUnauthorized: this.rejectUnauthorized
        }, onConnect);
      } else {
        this.socket = net.connect({
          host: this.host,
          port: this.port
        }, onConnect);
      }
      this.socket.once('error', onError);
      this._attachListeners(this.socket);
    });

    await this.readReply();
  }

  async upgradeStartTls() {
    await this.command('STARTTLS');
    const plainSocket = this.socket;
    plainSocket.removeAllListeners('data');
    plainSocket.removeAllListeners('error');
    plainSocket.removeAllListeners('timeout');
    plainSocket.removeAllListeners('close');

    await new Promise((resolve, reject) => {
      const tlsSock = tls.connect({
        socket: plainSocket,
        servername: this.host,
        rejectUnauthorized: this.rejectUnauthorized
      }, () => {
        this.socket = tlsSock;
        this._attachListeners(tlsSock);
        resolve();
      });
      tlsSock.once('error', reject);
    });
  }

  close() {
    if (this.socket) {
      try {
        this.socket.destroy();
      } catch {}
    }
  }
}

function buildMimeBody({ text, html, inlineImages = [], attachments = [] }) {
  const altBoundary = `ca_alt_${crypto.randomBytes(8).toString('hex')}`;
  const altSection = [
    `Content-Type: multipart/alternative; boundary="${altBoundary}"`,
    '',
    `--${altBoundary}`,
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: base64',
    '',
    wrapBufferBase64(text || ''),
    '',
    `--${altBoundary}`,
    'Content-Type: text/html; charset=utf-8',
    'Content-Transfer-Encoding: base64',
    '',
    wrapBufferBase64(html || text || ''),
    '',
    `--${altBoundary}--`
  ].join('\r\n');

  let contentSection = altSection;
  let rootContentType = `multipart/alternative; boundary="${altBoundary}"`;

  const validInline = (inlineImages || []).filter((img) => img && img.content && img.cid);
  if (validInline.length > 0) {
    const relBoundary = `ca_rel_${crypto.randomBytes(8).toString('hex')}`;
    const relParts = [
      `Content-Type: multipart/related; type="multipart/alternative"; boundary="${relBoundary}"`,
      '',
      `--${relBoundary}`,
      altSection
    ];
    for (const img of validInline) {
      const fname = sanitizeHeaderFilename(img.filename, 'image.jpg');
      relParts.push(
        '',
        `--${relBoundary}`,
        `Content-Type: ${img.contentType || 'image/jpeg'}; name="${fname}"`,
        'Content-Transfer-Encoding: base64',
        `Content-ID: <${img.cid}>`,
        `Content-Disposition: inline; filename="${fname}"`,
        '',
        wrapBufferBase64(img.content)
      );
    }
    relParts.push('', `--${relBoundary}--`);
    contentSection = relParts.join('\r\n');
    rootContentType = `multipart/related; type="multipart/alternative"; boundary="${relBoundary}"`;
  }

  const validAttachments = (attachments || []).filter((att) => att && att.content && att.filename);
  if (validAttachments.length > 0) {
    const mixBoundary = `ca_mix_${crypto.randomBytes(8).toString('hex')}`;
    const mixParts = [
      `--${mixBoundary}`,
      contentSection
    ];
    for (const att of validAttachments) {
      const fname = sanitizeHeaderFilename(att.filename, 'report.pdf');
      mixParts.push(
        '',
        `--${mixBoundary}`,
        `Content-Type: ${att.contentType || 'application/pdf'}; name="${fname}"`,
        'Content-Transfer-Encoding: base64',
        `Content-Disposition: attachment; filename="${fname}"`,
        '',
        wrapBufferBase64(att.content)
      );
    }
    mixParts.push('', `--${mixBoundary}--`);
    return {
      rootContentType: `multipart/mixed; boundary="${mixBoundary}"`,
      body: mixParts.join('\r\n')
    };
  }

  // Strip top Content-Type line if no wrapper was added because top headers set it
  const strippedAlt = altSection.split('\r\n').slice(2).join('\r\n');
  const finalBody = validInline.length > 0
    ? contentSection.split('\r\n').slice(2).join('\r\n')
    : strippedAlt;

  return {
    rootContentType,
    body: finalBody
  };
}

async function sendSmtpMail({
  host,
  port,
  secure,
  user,
  pass,
  from,
  to,
  subject,
  text,
  html,
  inlineImages = [],
  attachments = [],
  timeoutMs = 15000,
  rejectUnauthorized = true
}) {
  const recipients = Array.isArray(to) ? to : parseEmailList(to);
  if (recipients.length === 0) {
    throw new Error('No valid recipient email addresses specified.');
  }
  if (!host || !user || !pass) {
    throw new Error('SMTP host, username, and password are required.');
  }

  const fromAddr = from || user;
  const conn = new SmtpConnection({ host, port, secure, timeoutMs, rejectUnauthorized });

  try {
    await conn.connect();
    let ehlo = await conn.command('EHLO codeaura.local');

    if (!secure && /STARTTLS/i.test(ehlo.text)) {
      await conn.upgradeStartTls();
      ehlo = await conn.command('EHLO codeaura.local');
    }

    if (/AUTH[^\n]*PLAIN/i.test(ehlo.text)) {
      const token = Buffer.from(`\u0000${user}\u0000${pass}`, 'utf8').toString('base64');
      await conn.command(`AUTH PLAIN ${token}`);
    } else {
      await conn.command('AUTH LOGIN');
      await conn.command(Buffer.from(user, 'utf8').toString('base64'));
      await conn.command(Buffer.from(pass, 'utf8').toString('base64'));
    }

    await conn.command(`MAIL FROM:<${fromAddr}>`);
    for (const rcpt of recipients) {
      await conn.command(`RCPT TO:<${rcpt}>`);
    }

    await conn.command('DATA');

    const { rootContentType, body } = buildMimeBody({ text, html, inlineImages, attachments });
    const msgId = `<${crypto.randomBytes(12).toString('hex')}@${host}>`;
    const headers = [
      `From: CodeAura Exam Portal <${fromAddr}>`,
      `To: ${recipients.join(', ')}`,
      `Subject: ${encodeMimeSubject(subject)}`,
      `Date: ${new Date().toUTCString()}`,
      `Message-ID: ${msgId}`,
      'MIME-Version: 1.0',
      `Content-Type: ${rootContentType}`
    ].join('\r\n');

    const fullPayload = dotStuff(`${headers}\r\n\r\n${body}`);
    const dataReply = conn.readReply();
    conn.socket.write(`${fullPayload}\r\n.\r\n`);
    await dataReply;

    try {
      await conn.command('QUIT');
    } catch {}

    return { ok: true, recipients };
  } finally {
    conn.close();
  }
}

function buildResultEmail({ submission, instituteName, teacherName }) {
  const inst = String(instituteName || 'CodeAura Classroom').trim() || 'CodeAura Classroom';
  const subject = `[${inst}] ${submission.studentName} (${submission.rollNumber}) — Exam Score Report PDF | ${submission.examTitle}`;
  const pdfFilename = buildPdfFilename(submission);

  const text = [
    `${inst} — Exam Score Report`,
    `Student: ${submission.studentName} (Roll No: ${submission.rollNumber})`,
    `Exam: ${submission.examTitle}`,
    `Please open the attached PDF file (${pdfFilename}) for the official result.`
  ].join('\n');

  const html = `
  <div style="font-family:'Segoe UI',Arial,sans-serif;font-size:14px;color:#0f172a;line-height:1.5;padding:4px 0;">
    <p style="margin:0 0 6px;"><strong>${escapeHtml(inst)}</strong> &mdash; Official Exam Score Report</p>
    <p style="margin:0;color:#475569;font-size:13px;">
      Student: <strong style="color:#0f172a;">${escapeHtml(submission.studentName)}</strong> (${escapeHtml(submission.rollNumber)}) &bull;
      Exam: <strong style="color:#0f172a;">${escapeHtml(submission.examTitle)}</strong><br/>
      Please open the attached PDF file (<strong>${escapeHtml(pdfFilename)}</strong>).
    </p>
  </div>`;

  const pdfBuffer = generateScoreReportPdf({ submission, instituteName: inst, teacherName });

  return {
    subject,
    text,
    html,
    inlineImages: [],
    attachments: [
      {
        filename: pdfFilename,
        contentType: 'application/pdf',
        content: pdfBuffer
      }
    ],
    pdfFilename,
    pdfBuffer
  };
}

module.exports = {
  parseEmailList,
  sendSmtpMail,
  buildResultEmail,
  getInlineLogoAttachment
};
