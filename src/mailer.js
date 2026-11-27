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

function formatDuration(totalSeconds) {
  const s = Math.max(0, Math.floor(Number(totalSeconds) || 0));
  const mins = Math.floor(s / 60);
  const secs = s % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
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

function buildResultEmail({ submission, instituteName, teacherName, includePdf = true }) {
  const inst = String(instituteName || 'CodeAura Classroom').trim() || 'CodeAura Classroom';
  const passed = Boolean(submission.passed);
  const statusLabel = passed ? 'PASSED' : 'NEEDS PRACTICE';
  const statusColor = passed ? '#059669' : '#dc2626';
  const statusBg = passed ? '#ecfdf5' : '#fef2f2';
  const statusBorder = passed ? '#a7f3d0' : '#fecaca';

  const subject = `[${inst}] ${submission.studentName} (${submission.rollNumber}) — ${submission.score}/${submission.totalMarks} (${submission.percentage}%) | ${submission.examTitle}`;

  const subjLines = (submission.subjectBreakdown || [])
    .map((sb) => `  - ${sb.subjectName}: ${sb.marksObtained}/${sb.maxMarks} (${sb.correct}/${sb.totalQuestions} correct)`)
    .join('\n');

  const proctor = submission.proctoring || {};
  const vCount = Number(proctor.violationsCount) || 0;
  const proctorLine = vCount > 0
    ? `Proctoring Flags: ${vCount} violation(s)${proctor.autoSubmittedReason === 'proctor-limit' ? ' (Auto-submitted on limit)' : ''}`
    : 'Proctoring Integrity: Clean (0 violations)';

  const pdfFilename = buildPdfFilename(submission);

  const text = [
    `${inst} — Official Exam Score Report`,
    `========================================`,
    `Exam: ${submission.examTitle}`,
    `Student: ${submission.studentName}`,
    `Roll No: ${submission.rollNumber}`,
    submission.batch ? `Batch: ${submission.batch}` : null,
    submission.studentEmail ? `Student Email: ${submission.studentEmail}` : null,
    ``,
    `Result: ${statusLabel}`,
    `Total Marks: ${submission.score} / ${submission.totalMarks} (${submission.percentage}%)`,
    `Correct: ${submission.correctCount} | Wrong: ${submission.wrongCount} | Skipped: ${submission.skippedCount}`,
    `Time Taken: ${formatDuration(submission.timeTakenSeconds)}`,
    proctorLine,
    ``,
    `Subject-wise Breakdown:`,
    subjLines,
    ``,
    includePdf ? `Attached PDF Score Report: ${pdfFilename}` : null,
    `Submitted At: ${new Date(submission.submittedAt).toLocaleString()}`,
    `Sent automatically by ${inst} (${teacherName || 'Sir'})`
  ].filter(Boolean).join('\n');

  const inlineLogo = getInlineLogoAttachment();
  const inlineImages = inlineLogo ? [inlineLogo] : [];
  const logoHtml = inlineLogo
    ? `<img src="cid:${inlineLogo.cid}" alt="CodeAura Logo" width="108" style="display:block;width:108px;height:auto;border-radius:8px;border:1px solid #fde68a;" />`
    : `<div style="padding:10px 14px;background:#0f766e;color:#ffffff;font-weight:800;border-radius:8px;font-size:15px;">&lt;/&gt; CodeAura</div>`;

  const letters = ['A', 'B', 'C', 'D'];
  const subjHtmlRows = (submission.subjectBreakdown || []).map((sb, idx) => `
    <tr style="background:${idx % 2 === 1 ? '#f8fafc' : '#ffffff'};">
      <td style="padding:9px 8px;border-bottom:1px solid #e2e8f0;font-weight:700;color:#0f172a;">${escapeHtml(sb.subjectName)}</td>
      <td style="padding:9px 6px;border-bottom:1px solid #e2e8f0;color:#0f172a;text-align:center;font-weight:600;">${sb.marksObtained}/${sb.maxMarks}</td>
      <td style="padding:9px 6px;border-bottom:1px solid #e2e8f0;color:#059669;text-align:center;font-weight:700;">${sb.correct}</td>
      <td style="padding:9px 6px;border-bottom:1px solid #e2e8f0;color:#dc2626;text-align:center;font-weight:700;">${sb.wrong}</td>
      <td style="padding:9px 6px;border-bottom:1px solid #e2e8f0;color:#64748b;text-align:center;">${sb.skipped}</td>
    </tr>
  `).join('');

  const reviewRows = (submission.review || []).map((item, idx) => {
    const chosenText = item.selectedIndex !== null && item.selectedIndex !== undefined && item.options?.[item.selectedIndex] !== undefined
      ? `${letters[item.selectedIndex]}. ${item.options[item.selectedIndex]}`
      : 'Not Attempted';
    const correctText = item.options?.[item.correctIndex] !== undefined
      ? `${letters[item.correctIndex]}. ${item.options[item.correctIndex]}`
      : 'N/A';
    const badgeBg = item.status === 'correct' ? '#ecfdf5' : item.status === 'wrong' ? '#fef2f2' : '#f1f5f9';
    const badgeColor = item.status === 'correct' ? '#059669' : item.status === 'wrong' ? '#dc2626' : '#475569';
    const statusText = item.status === 'correct' ? `Correct (+${item.marksAwarded})` : item.status === 'wrong' ? `Wrong (${item.marksAwarded})` : 'Skipped';

    return `
      <div style="border:1px solid #e2e8f0;border-left:4px solid ${badgeColor};border-radius:10px;padding:12px 14px;margin-bottom:10px;background:#ffffff;">
        <table role="presentation" style="width:100%;border-collapse:collapse;margin-bottom:6px;">
          <tr>
            <td style="font-size:12px;font-weight:700;color:#0f766e;">Q${idx + 1} &bull; ${escapeHtml(item.subjectName)}</td>
            <td style="text-align:right;">
              <span style="display:inline-block;font-size:11px;font-weight:700;padding:2px 9px;border-radius:999px;background:${badgeBg};color:${badgeColor};">${statusText}</span>
            </td>
          </tr>
        </table>
        <div style="font-weight:600;color:#0f172a;font-size:14px;margin-bottom:6px;line-height:1.45;">${escapeHtml(item.question)}</div>
        ${item.code ? `<pre style="background:#0f172a;color:#f1f5f9;padding:8px 10px;border-radius:6px;font-size:12px;overflow-x:auto;margin:6px 0 8px;">${escapeHtml(item.code)}</pre>` : ''}
        <div style="font-size:13px;color:#334155;line-height:1.5;">
          <div><strong style="color:#475569;">Selected:</strong> <span style="color:${item.status === 'wrong' ? '#dc2626' : '#0f172a'};">${escapeHtml(chosenText)}</span></div>
          <div style="color:#059669;"><strong>Correct:</strong> ${escapeHtml(correctText)}</div>
        </div>
      </div>
    `;
  }).join('');

  const html = `
  <div style="font-family:'Segoe UI',Arial,sans-serif;background:#f1f5f9;padding:16px 10px;color:#0f172a;">
    <div style="max-width:660px;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:14px;overflow:hidden;">
      <table role="presentation" style="width:100%;border-collapse:collapse;">
        <tr>
          <td style="width:72%;height:5px;background:#0f766e;"></td>
          <td style="width:28%;height:5px;background:#f97316;"></td>
        </tr>
      </table>

      <div style="background:#fffdf8;padding:18px 20px;border-bottom:1px solid #e2e8f0;">
        <table role="presentation" style="width:100%;border-collapse:collapse;">
          <tr>
            <td style="width:116px;vertical-align:middle;padding-right:14px;">
              <div style="background:#fff8ec;border-radius:10px;padding:4px;display:inline-block;">
                ${logoHtml}
              </div>
            </td>
            <td style="vertical-align:middle;">
              <div style="font-size:11px;font-weight:700;color:#0f766e;text-transform:uppercase;letter-spacing:0.07em;">${escapeHtml(inst)}</div>
              <h1 style="margin:3px 0 4px;font-size:20px;color:#0f172a;line-height:1.2;">Official Exam Score Report</h1>
              <div style="font-size:12px;color:#64748b;">Examiner: ${escapeHtml(teacherName || 'Sir')} &bull; ID: ${escapeHtml(submission.id)}</div>
            </td>
          </tr>
        </table>
      </div>

      <div style="padding:18px 20px;">
        <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:12px 14px;margin-bottom:16px;">
          <div style="font-size:17px;font-weight:700;color:#0f172a;margin-bottom:4px;">${escapeHtml(submission.examTitle)}</div>
          <div style="color:#475569;font-size:13px;line-height:1.55;">
            Student: <strong style="color:#0f172a;">${escapeHtml(submission.studentName)}</strong> &bull;
            Roll No: <strong style="color:#0f172a;">${escapeHtml(submission.rollNumber)}</strong>
            ${submission.batch ? ` &bull; Batch: <strong style="color:#0f172a;">${escapeHtml(submission.batch)}</strong>` : ''}
            ${submission.studentEmail ? `<br/>Email: ${escapeHtml(submission.studentEmail)}` : ''}
          </div>
        </div>

        <div style="background:#f0fdfa;border:1px solid #99f6e4;border-radius:12px;padding:16px;text-align:center;margin-bottom:14px;">
          <div style="font-size:11px;font-weight:700;color:#0f766e;text-transform:uppercase;letter-spacing:0.06em;">Total Marks Obtained</div>
          <div style="font-size:36px;font-weight:900;color:#134e4a;margin:4px 0;line-height:1.1;">${submission.score} / ${submission.totalMarks}</div>
          <div style="display:inline-block;margin:4px 0 6px;padding:4px 12px;border-radius:999px;font-size:13px;font-weight:700;background:${statusBg};border:1px solid ${statusBorder};color:${statusColor};">
            ${submission.percentage}% &bull; ${statusLabel}
          </div>
          <div style="font-size:13px;color:#334155;margin-top:6px;">
            Correct: <strong style="color:#059669;">${submission.correctCount}</strong> &bull;
            Wrong: <strong style="color:#dc2626;">${submission.wrongCount}</strong> &bull;
            Skipped: <strong>${submission.skippedCount}</strong> &bull;
            Time: <strong>${formatDuration(submission.timeTakenSeconds)}</strong>
          </div>
          <div style="font-size:12px;margin-top:6px;font-weight:700;color:${vCount > 0 ? '#dc2626' : '#059669'};">
            ${escapeHtml(proctorLine)}
          </div>
        </div>

        ${includePdf ? `
          <div style="background:#fff7ed;border:1px solid #fed7aa;border-radius:8px;padding:10px 12px;font-size:12.5px;color:#9a3412;margin-bottom:16px;">
            <strong>Official PDF Attached:</strong> Open <strong>${escapeHtml(pdfFilename)}</strong> attached below for the full branded CodeAura printable report.
          </div>
        ` : ''}

        <h3 style="margin:0 0 8px;font-size:14px;color:#0f172a;">Subject-wise Breakdown</h3>
        <div style="overflow-x:auto;margin-bottom:18px;">
          <table style="width:100%;border-collapse:collapse;font-size:12.5px;border:1px solid #e2e8f0;background:#ffffff;">
            <thead>
              <tr style="background:#134e4a;color:#ffffff;">
                <th style="padding:8px;text-align:left;">Subject</th>
                <th style="padding:8px;text-align:center;">Marks</th>
                <th style="padding:8px;text-align:center;">Correct</th>
                <th style="padding:8px;text-align:center;">Wrong</th>
                <th style="padding:8px;text-align:center;">Skip</th>
              </tr>
            </thead>
            <tbody>${subjHtmlRows}</tbody>
          </table>
        </div>

        <h3 style="margin:0 0 10px;font-size:14px;color:#0f172a;">Checked Answer Sheet</h3>
        ${reviewRows.length > 0 ? reviewRows : `<div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:12px;font-size:13px;color:#64748b;">Detailed answer review is hidden by Sir for this exam.</div>`}
      </div>
    </div>
  </div>`;

  const attachments = [];
  let pdfBuffer = null;
  if (includePdf) {
    pdfBuffer = generateScoreReportPdf({ submission, instituteName: inst, teacherName });
    attachments.push({
      filename: pdfFilename,
      contentType: 'application/pdf',
      content: pdfBuffer
    });
  }

  return {
    subject,
    text,
    html,
    inlineImages,
    attachments,
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
