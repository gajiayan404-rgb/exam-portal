const net = require('node:net');
const tls = require('node:tls');
const crypto = require('node:crypto');

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

function wrapBase64(text) {
  const b64 = Buffer.from(String(text || ''), 'utf8').toString('base64');
  return b64.match(/.{1,76}/g)?.join('\r\n') || '';
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
  constructor({ host, port, secure, timeoutMs = 10000, rejectUnauthorized = true }) {
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
    // Keep last potentially incomplete line in buffer
    const completeCount = lines.length - 1;
    if (completeCount <= 0) return;

    const collected = [];
    for (let i = 0; i < completeCount; i++) {
      const line = lines[i];
      if (!line) continue;
      collected.push(line);
      // Final line of SMTP reply has space at index 3: e.g. "250 OK"
      if (/^\d{3} /.test(line)) {
        const consumedLines = lines.slice(0, i + 1).join('\n').length + 1;
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

    // Greeting 220
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

async function sendSmtpMail({ host, port, secure, user, pass, from, to, subject, text, html, timeoutMs = 10000, rejectUnauthorized = true }) {
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

    // Authenticate (prefer AUTH PLAIN if advertised, else AUTH LOGIN)
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

    const boundary = `ca_part_${crypto.randomBytes(8).toString('hex')}`;
    const msgId = `<${crypto.randomBytes(12).toString('hex')}@${host}>`;
    const headers = [
      `From: CodeAura Exam Portal <${fromAddr}>`,
      `To: ${recipients.join(', ')}`,
      `Subject: ${encodeMimeSubject(subject)}`,
      `Date: ${new Date().toUTCString()}`,
      `Message-ID: ${msgId}`,
      'MIME-Version: 1.0',
      `Content-Type: multipart/alternative; boundary="${boundary}"`
    ].join('\r\n');

    const body = [
      `--${boundary}`,
      'Content-Type: text/plain; charset=utf-8',
      'Content-Transfer-Encoding: base64',
      '',
      wrapBase64(text || ''),
      '',
      `--${boundary}`,
      'Content-Type: text/html; charset=utf-8',
      'Content-Transfer-Encoding: base64',
      '',
      wrapBase64(html || text || ''),
      '',
      `--${boundary}--`
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
  const statusLabel = submission.passed ? 'PASSED' : 'NEEDS PRACTICE';
  const statusColor = submission.passed ? '#059669' : '#dc2626';

  const subject = `[${instituteName}] ${submission.studentName} (${submission.rollNumber}) — ${submission.score}/${submission.totalMarks} (${submission.percentage}%) | ${submission.examTitle}`;

  const subjLines = (submission.subjectBreakdown || [])
    .map((sb) => `  - ${sb.subjectName}: ${sb.marksObtained}/${sb.maxMarks} (${sb.correct}/${sb.totalQuestions} correct)`)
    .join('\n');

  const proctor = submission.proctoring || {};
  const vCount = Number(proctor.violationsCount) || 0;
  const proctorLine = vCount > 0
    ? `Proctoring Flags: ${vCount} violation(s)${proctor.autoSubmittedReason === 'proctor-limit' ? ' (Auto-submitted on limit)' : ''}`
    : 'Proctoring: Clean (0 violations)';

  const text = [
    `${instituteName} — Exam Result Report`,
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
    `Submitted At: ${new Date(submission.submittedAt).toLocaleString()}`,
    `Sent automatically by ${instituteName} (${teacherName || 'Sir'})`
  ].filter(Boolean).join('\n');

  const letters = ['A', 'B', 'C', 'D'];
  const subjHtmlRows = (submission.subjectBreakdown || []).map((sb) => `
    <tr>
      <td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;font-weight:600;">${escapeHtml(sb.subjectName)}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;">${sb.marksObtained} / ${sb.maxMarks}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;color:#059669;">✓ ${sb.correct}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;color:#dc2626;">✕ ${sb.wrong}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #e2e8f0;color:#64748b;">– ${sb.skipped}</td>
    </tr>
  `).join('');

  const reviewRows = (submission.review || []).map((item, idx) => {
    const chosenText = item.selectedIndex !== null && item.selectedIndex !== undefined
      ? `${letters[item.selectedIndex]}. ${item.options[item.selectedIndex]}`
      : 'Not Answered';
    const correctText = `${letters[item.correctIndex]}. ${item.options[item.correctIndex]}`;
    const badgeBg = item.status === 'correct' ? '#ecfdf5' : item.status === 'wrong' ? '#fef2f2' : '#f1f5f9';
    const badgeColor = item.status === 'correct' ? '#059669' : item.status === 'wrong' ? '#dc2626' : '#475569';
    const statusText = item.status === 'correct' ? `Correct (+${item.marksAwarded})` : item.status === 'wrong' ? `Wrong (${item.marksAwarded})` : 'Skipped';

    return `
      <div style="border:1px solid #e2e8f0;border-radius:10px;padding:12px 14px;margin-bottom:10px;background:#ffffff;">
        <div style="display:flex;justify-content:space-between;margin-bottom:6px;">
          <span style="font-size:12px;font-weight:700;color:#4f46e5;">Q${idx + 1} • ${escapeHtml(item.subjectName)}</span>
          <span style="font-size:12px;font-weight:700;padding:2px 8px;border-radius:999px;background:${badgeBg};color:${badgeColor};">${statusText}</span>
        </div>
        <div style="font-weight:600;color:#0f172a;margin-bottom:6px;">${escapeHtml(item.question)}</div>
        ${item.code ? `<pre style="background:#0f172a;color:#f1f5f9;padding:8px 10px;border-radius:6px;font-size:12px;overflow-x:auto;">${escapeHtml(item.code)}</pre>` : ''}
        <div style="font-size:13px;color:#334155;">
          <div><strong>Selected:</strong> ${escapeHtml(chosenText)}</div>
          <div style="color:#059669;"><strong>Correct:</strong> ${escapeHtml(correctText)}</div>
        </div>
      </div>
    `;
  }).join('');

  const html = `
  <div style="font-family:Segoe UI,Arial,sans-serif;background:#f8fafc;padding:24px;color:#0f172a;">
    <div style="max-width:680px;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:14px;overflow:hidden;">
      <div style="background:#4f46e5;color:#ffffff;padding:20px 24px;">
        <div style="font-size:12px;opacity:0.9;text-transform:uppercase;letter-spacing:0.06em;">${escapeHtml(instituteName)}</div>
        <h1 style="margin:4px 0 0;font-size:20px;">Exam Score Report</h1>
      </div>
      <div style="padding:22px 24px;">
        <div style="margin-bottom:16px;">
          <div style="font-size:18px;font-weight:700;">${escapeHtml(submission.examTitle)}</div>
          <div style="color:#475569;font-size:14px;margin-top:4px;">
            Student: <strong>${escapeHtml(submission.studentName)}</strong> &bull;
            Roll No: <strong>${escapeHtml(submission.rollNumber)}</strong>
            ${submission.batch ? ` &bull; Batch: <strong>${escapeHtml(submission.batch)}</strong>` : ''}
            ${submission.studentEmail ? ` &bull; Email: ${escapeHtml(submission.studentEmail)}` : ''}
          </div>
        </div>

        <div style="background:#eef2ff;border:1px solid #c7d2fe;border-radius:12px;padding:16px;text-align:center;margin-bottom:18px;">
          <div style="font-size:12px;font-weight:700;color:#4f46e5;text-transform:uppercase;">Total Marks Obtained</div>
          <div style="font-size:34px;font-weight:900;color:#312e81;margin:4px 0;">${submission.score} / ${submission.totalMarks}</div>
          <div style="font-size:15px;font-weight:700;color:${statusColor};">${submission.percentage}% &bull; ${statusLabel}</div>
          <div style="font-size:13px;color:#475569;margin-top:6px;">
            Correct: ${submission.correctCount} &bull; Wrong: ${submission.wrongCount} &bull; Skipped: ${submission.skippedCount} &bull; Time: ${formatDuration(submission.timeTakenSeconds)}
          </div>
          <div style="font-size:12.5px;margin-top:6px;font-weight:700;color:${vCount > 0 ? '#dc2626' : '#059669'};">
            ${escapeHtml(proctorLine)}
          </div>
        </div>

        <h3 style="margin:0 0 8px;font-size:15px;">Subject-wise Breakdown</h3>
        <table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:20px;border:1px solid #e2e8f0;">
          <thead>
            <tr style="background:#f1f5f9;text-align:left;">
              <th style="padding:8px 12px;">Subject</th>
              <th style="padding:8px 12px;">Marks</th>
              <th style="padding:8px 12px;">Correct</th>
              <th style="padding:8px 12px;">Wrong</th>
              <th style="padding:8px 12px;">Skipped</th>
            </tr>
          </thead>
          <tbody>${subjHtmlRows}</tbody>
        </table>

        <h3 style="margin:0 0 10px;font-size:15px;">Checked Answer Sheet</h3>
        ${reviewRows}
      </div>
    </div>
  </div>`;

  return { subject, text, html };
}

module.exports = {
  parseEmailList,
  sendSmtpMail,
  buildResultEmail
};
