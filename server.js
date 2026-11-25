const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { URL } = require('node:url');
const { ExamStore } = require('./src/store');

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_DIR = path.join(__dirname, 'data');
const SECRET_PATH = path.join(DATA_DIR, '.session-secret');

const store = new ExamStore();
const sseClients = new Set();

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
      const exam = store.getExamForStudent(examId, roll);
      return sendJson(res, 200, { exam });
    }

    const studentSubmitMatch = pathname.match(/^\/api\/student\/exams\/([^/]+)\/submit$/);
    if (method === 'POST' && studentSubmitMatch) {
      const examId = decodeURIComponent(studentSubmitMatch[1]);
      const body = await readJsonBody(req);
      const result = store.submitStudentExam(examId, body);
      broadcastEvent('submission-created', {
        examId: result.examId,
        studentName: result.studentName,
        score: result.score,
        totalMarks: result.totalMarks
      });
      return sendJson(res, 201, { result });
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
          subjects: store.listSubjects(),
          questions: store.listQuestions(),
          exams: store.listExamsTeacher(),
          submissions: store.listSubmissions()
        });
      }

      if (method === 'PUT' && pathname === '/api/teacher/settings') {
        const body = await readJsonBody(req);
        const updated = store.updateSettings(body);
        broadcastEvent('info-updated', updated);
        return sendJson(res, 200, { settings: updated });
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
        broadcastEvent('exams-updated', { examId: exam.id, isLive: exam.isLive });
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
          'Exam Title',
          'Score',
          'Total Marks',
          'Percentage',
          'Status',
          'Correct',
          'Wrong',
          'Skipped',
          'Time Taken (sec)',
          'Submitted At'
        ];
        const lines = [header.map(csvEscape).join(',')];
        for (const s of rows) {
          lines.push([
            s.studentName,
            s.rollNumber,
            s.batch || '',
            s.examTitle,
            s.score,
            s.totalMarks,
            `${s.percentage}%`,
            s.passed ? 'PASS' : 'FAIL',
            s.correctCount,
            s.wrongCount,
            s.skippedCount,
            s.timeTakenSeconds,
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
