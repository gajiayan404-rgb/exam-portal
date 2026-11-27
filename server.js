const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { URL } = require('node:url');
const { ExamStore } = require('./src/store');
const { parseEmailList, sendSmtpMail, buildResultEmail, getInlineLogoAttachment } = require('./src/mailer');
const { generateScoreReportPdf, buildPdfFilename } = require('./src/pdfReport');
const { fetchAvailableModels, generateMcqsWithAi, generateMixedSubjectMcqs } = require('./src/aiGenerator');

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_DIR = path.join(__dirname, 'data');
const SECRET_PATH = path.join(DATA_DIR, '.session-secret');

const store = new ExamStore();
const sseClients = new Set();

async function dispatchSubmissionEmail(submissionId, { forceSend = false, customTo = '' } = {}) {
  const submission = store.getSubmission(submissionId);
  if (!submission) {
    const err = new Error('Submission not found.');
    err.statusCode = 404;
    throw err;
  }

  const emailCfg = store.getRawEmailConfig();
  const settings = store.data.settings;

  if (!forceSend && !emailCfg.enabled) {
    return store.setSubmissionEmailStatus(submissionId, {
      status: 'disabled',
      recipients: [],
      error: '',
      sentAt: null
    });
  }

  if (!emailCfg.smtpHost || !emailCfg.smtpUser || !emailCfg.smtpPass) {
    const delivery = {
      status: 'failed',
      recipients: [],
      error: 'SMTP host, sender email, or password/app-password is not configured in Settings.',
      sentAt: null
    };
    return store.setSubmissionEmailStatus(submissionId, delivery);
  }

  const teacherRecipients = (customTo ? parseEmailList(customTo) : (emailCfg.sendToTeacher ? parseEmailList(emailCfg.teacherEmails) : []));
  const studentRecipients = (!customTo && emailCfg.sendToStudent && submission.studentEmail)
    ? parseEmailList(submission.studentEmail)
    : [];

  const allRecipients = [...new Set([...teacherRecipients, ...studentRecipients])];
  if (allRecipients.length === 0) {
    const delivery = {
      status: 'failed',
      recipients: [],
      error: 'No recipient email address found (configure Sir Email in Settings or collect Student Email).',
      sentAt: null
    };
    return store.setSubmissionEmailStatus(submissionId, delivery);
  }

  const exam = store.data.exams.find((e) => e.id === submission.examId);
  const hideReviewFromStudent = exam && exam.showResultsImmediately === false;

  try {
    const smtpOpts = {
      host: emailCfg.smtpHost,
      port: Number(emailCfg.smtpPort) || (emailCfg.smtpSecure ? 465 : 587),
      secure: emailCfg.smtpSecure !== false,
      user: emailCfg.smtpUser,
      pass: emailCfg.smtpPass,
      from: emailCfg.smtpUser,
      timeoutMs: 15000,
      rejectUnauthorized: emailCfg.rejectUnauthorized !== false
    };

    if (hideReviewFromStudent && studentRecipients.length > 0 && teacherRecipients.length > 0) {
      const teacherMail = buildResultEmail({
        submission,
        instituteName: settings.instituteName,
        teacherName: settings.teacherName
      });
      await sendSmtpMail({ ...smtpOpts, to: teacherRecipients, ...teacherMail });

      const studentMail = buildResultEmail({
        submission: { ...submission, review: [] },
        instituteName: settings.instituteName,
        teacherName: settings.teacherName
      });
      await sendSmtpMail({ ...smtpOpts, to: studentRecipients, ...studentMail });
    } else {
      const subForMail = (hideReviewFromStudent && teacherRecipients.length === 0)
        ? { ...submission, review: [] }
        : submission;
      const mail = buildResultEmail({
        submission: subForMail,
        instituteName: settings.instituteName,
        teacherName: settings.teacherName
      });
      await sendSmtpMail({ ...smtpOpts, to: allRecipients, ...mail });
    }

    return store.setSubmissionEmailStatus(submissionId, {
      status: 'sent',
      recipients: allRecipients,
      error: '',
      sentAt: new Date().toISOString()
    });
  } catch (err) {
    return store.setSubmissionEmailStatus(submissionId, {
      status: 'failed',
      recipients: allRecipients,
      error: err.message || 'SMTP delivery failed.',
      sentAt: null
    });
  }
}

function getSessionSecret() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (fs.existsSync(SECRET_PATH)) {
    return fs.readFileSync(SECRET_PATH, 'utf8').trim();
  }
  const secret = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(SECRET_PATH, secret, 'utf8');
  return secret;
}

const SESSION_SECRET = getSessionSecret();

function signToken(payload) {
  const data = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(data).digest('base64url');
  return `${data}.${sig}`;
}

function verifyToken(token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [data, sig] = parts;
  const expected = crypto.createHmac('sha256', SESSION_SECRET).update(data).digest('base64url');
  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return null;
  }
  try {
    const decoded = JSON.parse(Buffer.from(data, 'base64url').toString('utf8'));
    if (decoded.exp && Date.now() > decoded.exp) return null;
    return decoded;
  } catch {
    return null;
  }
}

function getLanUrls(port) {
  const interfaces = os.networkInterfaces();
  const urls = [];
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name] || []) {
      if (iface.family === 'IPv4' && !iface.internal) {
        urls.push(`http://${iface.address}:${port}`);
      }
    }
  }
  return urls;
}

function broadcastEvent(eventName, payload) {
  const message = `event: ${eventName}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const res of sseClients) {
    try {
      res.write(message);
    } catch {
      sseClients.delete(res);
    }
  }
}

function sendJson(res, statusCode, data) {
  const body = JSON.stringify(data);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

function sendError(res, err) {
  const status = err.statusCode || 500;
  sendJson(res, status, {
    error: err.message || 'Internal Server Error'
  });
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let totalBytes = 0;
    const MAX_BYTES = 2 * 1024 * 1024; // 2 MB

    req.on('data', (chunk) => {
      totalBytes += chunk.length;
      if (totalBytes > MAX_BYTES) {
        const err = new Error('Request payload too large.');
        err.statusCode = 413;
        reject(err);
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => {
      if (chunks.length === 0) {
        resolve({});
        return;
      }
      const raw = Buffer.concat(chunks).toString('utf8');
      try {
        resolve(JSON.parse(raw));
      } catch {
        const err = new Error('Invalid JSON payload.');
        err.statusCode = 400;
        reject(err);
      }
    });

    req.on('error', (e) => reject(e));
  });
}

function requireTeacherAuth(req) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  const session = verifyToken(token);
  if (!session || session.role !== 'teacher') {
    const err = new Error('Teacher authentication required.');
    err.statusCode = 401;
    throw err;
  }
  return session;
}

function sendPdfResponse(res, submission, { hideReview = false } = {}) {
  const settings = store.data.settings;
  const subForPdf = hideReview ? { ...submission, reviewHidden: true, review: [] } : submission;
  const pdfBuffer = generateScoreReportPdf({
    submission: subForPdf,
    instituteName: settings.instituteName,
    teacherName: settings.teacherName
  });
  const filename = buildPdfFilename(subForPdf);
  res.writeHead(200, {
    'Content-Type': 'application/pdf',
    'Content-Disposition': `attachment; filename="${filename}"`,
    'Content-Length': pdfBuffer.length,
    'Cache-Control': 'no-store'
  });
  res.end(pdfBuffer);
}

function csvEscape(val) {
  const str = String(val ?? '');
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon'
};

function serveStaticFile(res, filePath) {
  const resolved = path.resolve(filePath);
  if (!resolved.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }
  fs.readFile(resolved, (err, content) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not Found');
      return;
    }
    const ext = path.extname(resolved).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
      'Cache-Control': 'no-cache'
    });
    res.end(content);
  });
}

async function handleApi(req, res, url) {
  const pathname = url.pathname;
  const method = req.method.toUpperCase();

  try {
    // --- SSE Live Events ---
    if (method === 'GET' && pathname === '/api/events') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive'
      });
      res.write(`event: connected\ndata: ${JSON.stringify({ ok: true, time: Date.now() })}\n\n`);
      sseClients.add(res);
      req.on('close', () => {
        sseClients.delete(res);
      });
      return;
    }

    // --- Public Info ---
    if (method === 'GET' && pathname === '/api/public/info') {
      const lanUrls = getLanUrls(PORT);
      return sendJson(res, 200, {
        ...store.getPublicInfo(),
        lanUrls
      });
    }

    // --- Student Endpoints ---
    if (method === 'GET' && pathname === '/api/student/exams') {
      return sendJson(res, 200, {
        exams: store.listLiveExamsForStudent(),
        info: store.getPublicInfo()
      });
    }

    const studentExamMatch = pathname.match(/^\/api\/student\/exams\/([^/]+)$/);
    if (method === 'GET' && studentExamMatch) {
      const examId = decodeURIComponent(studentExamMatch[1]);
      const roll = url.searchParams.get('roll') || '';
      const rawExam = store.getExamForStudent(examId, roll);
      const { _paperSpec, ...exam } = rawExam;
      const paperToken = signToken({
        role: 'exam-paper',
        examId: exam.id,
        spec: _paperSpec,
        exp: Date.now() + 24 * 60 * 60 * 1000
      });
      return sendJson(res, 200, { exam: { ...exam, paperToken } });
    }

    const studentSubmitMatch = pathname.match(/^\/api\/student\/exams\/([^/]+)\/submit$/);
    if (method === 'POST' && studentSubmitMatch) {
      const examId = decodeURIComponent(studentSubmitMatch[1]);
      const body = await readJsonBody(req);
      let paperSpec = null;
      if (body.paperToken) {
        const paperSession = verifyToken(body.paperToken);
        if (!paperSession || paperSession.role !== 'exam-paper' || paperSession.examId !== examId) {
          return sendJson(res, 401, { error: 'Exam session token expired or invalid. Please reload the exam.' });
        }
        paperSpec = paperSession.spec;
      }
      const result = store.submitStudentExam(examId, body, { paperSpec });
      const emailDelivery = await dispatchSubmissionEmail(result.id);
      result.emailDelivery = emailDelivery;
      result.pdfToken = signToken({
        role: 'student-result',
        submissionId: result.id,
        hideReview: Boolean(result.reviewHidden),
        exp: Date.now() + 24 * 60 * 60 * 1000
      });
      broadcastEvent('submission-created', {
        examId: result.examId,
        studentName: result.studentName,
        score: result.score,
        totalMarks: result.totalMarks,
        violationsCount: result.proctoring ? result.proctoring.violationsCount : 0,
        emailStatus: emailDelivery ? emailDelivery.status : 'disabled'
      });
      return sendJson(res, 201, { result });
    }

    const studentPdfMatch = pathname.match(/^\/api\/student\/submissions\/([^/]+)\/pdf$/);
    if (method === 'GET' && studentPdfMatch) {
      const id = decodeURIComponent(studentPdfMatch[1]);
      const token = url.searchParams.get('token') || '';
      const session = verifyToken(token);
      if (!session || session.role !== 'student-result' || session.submissionId !== id) {
        return sendJson(res, 401, { error: 'Valid student score report token is required.' });
      }
      const submission = store.getSubmission(id);
      if (!submission) {
        return sendJson(res, 404, { error: 'Submission not found.' });
      }
      const exam = store.data.exams.find((e) => e.id === submission.examId);
      const hideReview = Boolean(session.hideReview || (exam && exam.showResultsImmediately === false));
      return sendPdfResponse(res, submission, { hideReview });
    }

    // --- Teacher Auth ---
    if (method === 'POST' && pathname === '/api/teacher/login') {
      const body = await readJsonBody(req);
      if (!store.verifyTeacherPin(body.pin)) {
        return sendJson(res, 401, { error: 'Incorrect Teacher PIN. Please try again.' });
      }
      const token = signToken({
        role: 'teacher',
        iat: Date.now(),
        exp: Date.now() + 7 * 24 * 60 * 60 * 1000
      });
      return sendJson(res, 200, {
        token,
        info: store.getPublicInfo()
      });
    }

    if (method === 'GET' && pathname === '/api/teacher/verify') {
      requireTeacherAuth(req);
      return sendJson(res, 200, { valid: true });
    }

    // --- Protected Teacher Endpoints ---
    if (pathname.startsWith('/api/teacher/')) {
      requireTeacherAuth(req);

      if (method === 'GET' && pathname === '/api/teacher/bootstrap') {
        return sendJson(res, 200, {
          info: {
            ...store.getPublicInfo(),
            lanUrls: getLanUrls(PORT)
          },
          settings: store.getTeacherSettings(),
          subjects: store.listSubjects(),
          questions: store.listQuestions(),
          exams: store.listExamsTeacher(),
          submissions: store.listSubmissions()
        });
      }

      if (method === 'PUT' && pathname === '/api/teacher/settings') {
        const body = await readJsonBody(req);
        const updated = store.updateSettings(body);
        broadcastEvent('info-updated', store.getPublicInfo());
        return sendJson(res, 200, { settings: updated });
      }

      if (method === 'POST' && pathname === '/api/teacher/email/test') {
        const body = await readJsonBody(req);
        const saved = store.getRawEmailConfig();
        const host = String(body.smtpHost || saved.smtpHost || '').trim();
        const port = Number(body.smtpPort || saved.smtpPort) || 465;
        const secure = body.smtpSecure !== undefined ? Boolean(body.smtpSecure) : (saved.smtpSecure !== false);
        const user = String(body.smtpUser || saved.smtpUser || '').trim();
        const pass = String(body.smtpPass || saved.smtpPass || '').trim();
        const toRaw = String(body.toEmail || body.teacherEmails || saved.teacherEmails || user).trim();
        const recipients = parseEmailList(toRaw);

        if (!host || !user || !pass || recipients.length === 0) {
          return sendJson(res, 400, {
            error: 'Please fill SMTP Host, Sender Email, App Password, and Recipient Email first.'
          });
        }

        const inst = store.data.settings.instituteName;
        const inlineLogo = getInlineLogoAttachment();
        const logoTag = inlineLogo
          ? `<div style="margin-bottom:12px;"><img src="cid:${inlineLogo.cid}" alt="CodeAura Logo" width="120" style="display:block;width:120px;height:auto;border-radius:8px;border:1px solid #fde68a;" /></div>`
          : '';
        await sendSmtpMail({
          host,
          port,
          secure,
          user,
          pass,
          from: user,
          to: recipients,
          subject: `[${inst}] Test Email Connected Successfully`,
          text: `Hello ${store.data.settings.teacherName || 'Sir'},\n\nYour email notification setup for ${inst} is working! Student exam scores (with branded PDF Score Report attachments) will be delivered here automatically upon submission.`,
          html: `<div style="font-family:Segoe UI,Arial,sans-serif;padding:20px;background:#ffffff;border:1px solid #e2e8f0;border-radius:12px;max-width:560px;">${logoTag}<h2 style="margin:0 0 8px;color:#0f766e;">Email Connected — ${inst}</h2><p style="margin:0;color:#334155;">Your SMTP email settings are working properly. Student exam marks and branded PDF Score Reports will be emailed automatically when they submit.</p></div>`,
          inlineImages: inlineLogo ? [inlineLogo] : [],
          timeoutMs: 15000
        });
        return sendJson(res, 200, { ok: true, recipients });
      }

      if (method === 'POST' && pathname === '/api/teacher/ai/models') {
        const body = await readJsonBody(req);
        const saved = store.getRawAiConfig();
        const baseUrl = String(body.baseUrl || saved.baseUrl || '').trim();
        const apiKey = String(body.apiKey || saved.apiKey || '').trim();
        const models = await fetchAvailableModels({ baseUrl, apiKey });
        return sendJson(res, 200, { models });
      }

      if (method === 'POST' && pathname === '/api/teacher/ai/generate') {
        const body = await readJsonBody(req);
        const saved = store.getRawAiConfig();
        const baseUrl = String(body.baseUrl || saved.baseUrl || '').trim();
        const apiKey = String(body.apiKey || saved.apiKey || '').trim();
        const model = String(body.model || saved.model || 'deepseek-v4.1-flash').trim();

        const subjectId = String(body.subjectId || '').trim();
        const allSubjects = store.listSubjects();
        const count = Math.max(1, Math.min(50, Number(body.count) || 10));
        const topic = String(body.topic || '').trim();
        const difficulty = String(body.difficulty || 'Mixed').trim();

        let generated;
        if (subjectId === 'mixed' || subjectId === 'all') {
          const existingBySubject = {};
          for (const s of allSubjects) {
            existingBySubject[s.id] = store.listQuestions({ subjectId: s.id }).map((q) => q.question);
          }
          generated = await generateMixedSubjectMcqs({
            baseUrl,
            apiKey,
            model,
            subjects: allSubjects,
            topic,
            count,
            difficulty,
            existingBySubject
          });
        } else {
          const subject = allSubjects.find((s) => s.id === subjectId);
          if (!subject) {
            return sendJson(res, 400, { error: 'Please choose a valid subject.' });
          }
          const existingQuestions = store.listQuestions({ subjectId }).map((q) => q.question);
          generated = await generateMcqsWithAi({
            baseUrl,
            apiKey,
            model,
            subjectId,
            subjectName: subject.fullName || subject.name,
            topic,
            count,
            difficulty,
            existingQuestions
          });
        }

        const toSave = generated.map((q) => ({ ...q, isAiGenerated: true }));
        const added = store.bulkAddQuestions(toSave);
        return sendJson(res, 201, {
          addedCount: added.length,
          added,
          subjects: store.listSubjects()
        });
      }

      if (method === 'GET' && pathname === '/api/teacher/subjects') {
        return sendJson(res, 200, { subjects: store.listSubjects() });
      }

      if (method === 'POST' && pathname === '/api/teacher/subjects') {
        const body = await readJsonBody(req);
        const subject = store.addSubject(body);
        return sendJson(res, 201, { subject, subjects: store.listSubjects() });
      }

      if (method === 'GET' && pathname === '/api/teacher/questions') {
        const questions = store.listQuestions({
          subjectId: url.searchParams.get('subjectId'),
          difficulty: url.searchParams.get('difficulty'),
          search: url.searchParams.get('search')
        });
        return sendJson(res, 200, { questions });
      }

      if (method === 'POST' && pathname === '/api/teacher/questions') {
        const body = await readJsonBody(req);
        const question = store.addQuestion(body);
        return sendJson(res, 201, { question, subjects: store.listSubjects() });
      }

      if (method === 'POST' && pathname === '/api/teacher/questions/bulk') {
        const body = await readJsonBody(req);
        const added = store.bulkAddQuestions(body.questions);
        return sendJson(res, 201, { addedCount: added.length, added, subjects: store.listSubjects() });
      }

      const qMatch = pathname.match(/^\/api\/teacher\/questions\/([^/]+)$/);
      if (qMatch) {
        const id = decodeURIComponent(qMatch[1]);
        if (method === 'PUT') {
          const body = await readJsonBody(req);
          const question = store.updateQuestion(id, body);
          return sendJson(res, 200, { question });
        }
        if (method === 'DELETE') {
          const out = store.deleteQuestion(id);
          broadcastEvent('exams-updated', { reason: 'question-deleted' });
          return sendJson(res, 200, { ...out, subjects: store.listSubjects() });
        }
      }

      if (method === 'GET' && pathname === '/api/teacher/exams') {
        return sendJson(res, 200, { exams: store.listExamsTeacher() });
      }

      if (method === 'POST' && pathname === '/api/teacher/exams') {
        const body = await readJsonBody(req);
        const exam = store.saveExam(body);
        broadcastEvent('exams-updated', { examId: exam.id, isLive: exam.isLive });
        return sendJson(res, body.id ? 200 : 201, { exam });
      }

      const examLiveMatch = pathname.match(/^\/api\/teacher\/exams\/([^/]+)\/live$/);
      if (method === 'PATCH' && examLiveMatch) {
        const id = decodeURIComponent(examLiveMatch[1]);
        const body = await readJsonBody(req);
        const exam = store.toggleExamLive(id, body.isLive);
        broadcastEvent('exams-updated', { examId: exam.id, isLive: exam.isLive, isLocked: exam.isLocked });
        return sendJson(res, 200, { exam });
      }

      const examLockMatch = pathname.match(/^\/api\/teacher\/exams\/([^/]+)\/lock$/);
      if (method === 'PATCH' && examLockMatch) {
        const id = decodeURIComponent(examLockMatch[1]);
        const body = await readJsonBody(req);
        const exam = store.toggleExamLock(id, body.isLocked);
        broadcastEvent('exams-updated', { examId: exam.id, isLive: exam.isLive, isLocked: exam.isLocked });
        return sendJson(res, 200, { exam });
      }

      const examMatch = pathname.match(/^\/api\/teacher\/exams\/([^/]+)$/);
      if (method === 'DELETE' && examMatch) {
        const id = decodeURIComponent(examMatch[1]);
        const out = store.deleteExam(id);
        broadcastEvent('exams-updated', { examId: id, deleted: true });
        return sendJson(res, 200, out);
      }

      if (method === 'GET' && pathname === '/api/teacher/submissions/export.csv') {
        const examId = url.searchParams.get('examId') || 'all';
        const rows = store.listSubmissions({ examId });
        const header = [
          'Student Name',
          'Roll No',
          'Batch',
          'Student Email',
          'Exam Title',
          'Score',
          'Total Marks',
          'Percentage',
          'Status',
          'Correct',
          'Wrong',
          'Skipped',
          'Time Taken (sec)',
          'Proctor Violations',
          'Submission Mode',
          'Email Status',
          'Submitted At'
        ];
        const lines = [header.map(csvEscape).join(',')];
        for (const s of rows) {
          lines.push([
            s.studentName,
            s.rollNumber,
            s.batch || '',
            s.studentEmail || '',
            s.examTitle,
            s.score,
            s.totalMarks,
            `${s.percentage}%`,
            s.passed ? 'PASS' : 'FAIL',
            s.correctCount,
            s.wrongCount,
            s.skippedCount,
            s.timeTakenSeconds,
            s.proctoring ? s.proctoring.violationsCount : 0,
            s.proctoring ? s.proctoring.autoSubmittedReason : 'manual',
            s.emailDelivery ? s.emailDelivery.status : 'disabled',
            s.submittedAt
          ].map(csvEscape).join(','));
        }
        res.writeHead(200, {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': 'attachment; filename="codeaura-exam-results.csv"'
        });
        res.end(lines.join('\r\n'));
        return;
      }

      if (method === 'GET' && pathname === '/api/teacher/submissions') {
        const submissions = store.listSubmissions({
          examId: url.searchParams.get('examId'),
          search: url.searchParams.get('search')
        });
        return sendJson(res, 200, { submissions });
      }

      if (method === 'DELETE' && pathname === '/api/teacher/submissions') {
        const examId = url.searchParams.get('examId') || 'all';
        return sendJson(res, 200, store.clearSubmissions(examId));
      }

      const subEmailMatch = pathname.match(/^\/api\/teacher\/submissions\/([^/]+)\/email$/);
      if (method === 'POST' && subEmailMatch) {
        const id = decodeURIComponent(subEmailMatch[1]);
        const body = await readJsonBody(req);
        const delivery = await dispatchSubmissionEmail(id, {
          forceSend: true,
          customTo: body.toEmail || ''
        });
        if (delivery.status === 'failed') {
          return sendJson(res, 400, { error: delivery.error || 'Email delivery failed.', emailDelivery: delivery });
        }
        return sendJson(res, 200, { ok: true, emailDelivery: delivery });
      }

      const subPdfMatch = pathname.match(/^\/api\/teacher\/submissions\/([^/]+)\/pdf$/);
      if (method === 'GET' && subPdfMatch) {
        const id = decodeURIComponent(subPdfMatch[1]);
        const submission = store.getSubmission(id);
        if (!submission) {
          return sendJson(res, 404, { error: 'Submission not found.' });
        }
        return sendPdfResponse(res, submission, { hideReview: false });
      }

      const subMatch = pathname.match(/^\/api\/teacher\/submissions\/([^/]+)$/);
      if (subMatch) {
        const id = decodeURIComponent(subMatch[1]);
        if (method === 'GET') {
          const submission = store.getSubmission(id);
          if (!submission) {
            return sendJson(res, 404, { error: 'Submission not found.' });
          }
          return sendJson(res, 200, { submission });
        }
        if (method === 'DELETE') {
          return sendJson(res, 200, store.deleteSubmission(id));
        }
      }
    }

    sendJson(res, 404, { error: 'API endpoint not found.' });
  } catch (err) {
    sendError(res, err);
  }
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = url.pathname;

  if (pathname.startsWith('/api/')) {
    handleApi(req, res, url);
    return;
  }

  // Clean route aliases for separate portals
  if (pathname === '/' || pathname === '/index.html') {
    serveStaticFile(res, path.join(PUBLIC_DIR, 'index.html'));
    return;
  }
  if (pathname === '/teacher' || pathname === '/teacher/' || pathname === '/teacher.html') {
    serveStaticFile(res, path.join(PUBLIC_DIR, 'teacher.html'));
    return;
  }
  if (pathname === '/student' || pathname === '/student/' || pathname === '/student.html') {
    serveStaticFile(res, path.join(PUBLIC_DIR, 'student.html'));
    return;
  }

  const safePath = path.normalize(pathname).replace(/^(\.\.[/\\])+/, '');
  serveStaticFile(res, path.join(PUBLIC_DIR, safePath));
});

// Keep SSE connections alive cleanly
setInterval(() => {
  for (const res of sseClients) {
    try {
      res.write(': ping\n\n');
    } catch {
      sseClients.delete(res);
    }
  }
}, 25000);

server.listen(PORT, HOST, () => {
  const lanUrls = getLanUrls(PORT);
  console.log('');
  console.log('=======================================================');
  console.log('   CodeAura Classroom MCQ Exam Portal is LIVE!');
  console.log('=======================================================');
  console.log(`   Home / Switcher : http://localhost:${PORT}/`);
  console.log(`   Teacher Portal  : http://localhost:${PORT}/teacher`);
  console.log(`   Student Portal  : http://localhost:${PORT}/student`);
  if (lanUrls.length > 0) {
    console.log('-------------------------------------------------------');
    console.log('   Share with Students on same Wi-Fi / LAN:');
    for (const u of lanUrls) {
      console.log(`   -> ${u}/student`);
    }
  }
  console.log('-------------------------------------------------------');
  console.log('   Default Teacher PIN: 1234 (Change inside Settings)');
  console.log('=======================================================');
  console.log('');
});
