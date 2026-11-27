const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DEFAULT_SUBJECTS, SEED_QUESTIONS } = require('./seedQuestions');

const DATA_DIR = path.join(__dirname, '..', 'data');
const STORE_PATH = path.join(DATA_DIR, 'store.json');

function createInitialStore() {
  const now = new Date().toISOString();
  // Create a helpful default sample live exam so students & teacher can try it immediately,
  // while teacher can edit, unpublish, or create any new exams with selected MCQs.
  const defaultExamQuestionIds = [
    'html-01', 'html-03', 'html-11',
    'css-02', 'css-11', 'css-13',
    'js-01', 'js-03', 'js-11',
    'py-01', 'py-04', 'py-11'
  ];

  return {
    settings: {
      instituteName: 'CodeAura Classroom',
      teacherName: 'Sir',
      teacherPin: '1234',
      pinChanged: false,
      email: {
        enabled: false,
        provider: 'gmail',
        smtpHost: 'smtp.gmail.com',
        smtpPort: 465,
        smtpSecure: true,
        smtpUser: '',
        smtpPass: '',
        teacherEmails: '',
        sendToTeacher: true,
        sendToStudent: true,
        requireStudentEmail: false
      },
      ai: {
        enabled: false,
        baseUrl: 'https://api.cent-ai.dev/v1',
        apiKey: '',
        model: 'deepseek-v4.1-flash'
      }
    },
    subjects: DEFAULT_SUBJECTS.map((s) => ({ ...s })),
    questions: SEED_QUESTIONS.map((q) => ({
      ...q,
      isCustom: false,
      createdAt: now
    })),
    exams: [
      {
        id: 'exam-sample-01',
        title: 'Full-Stack Basics MCQ Test (HTML, CSS, JS, Python)',
        description: 'Sample exam pre-selected by Sir. You can modify selected MCQs or create a brand-new exam in the Teacher Portal.',
        durationMinutes: 15,
        marksPerQuestion: 1,
        negativeMarking: 0,
        passPercentage: 40,
        shuffleQuestions: false,
        showResultsImmediately: true,
        allowRetake: true,
        proctorTabSwitch: true,
        maxTabViolations: 1,
        requireFullscreen: true,
        blockCopyPaste: true,
        speedModeSeconds: 0,
        isLive: true,
        questionIds: defaultExamQuestionIds,
        createdAt: now,
        updatedAt: now
      }
    ],
    submissions: [],
    deletedSeedIds: []
  };
}

function getLocalDateKey(date = new Date()) {
  try {
    return date.toLocaleDateString('en-CA');
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

function createSeededRng(seedStr) {
  let counter = 0;
  let block = Buffer.alloc(0);
  let offset = 0;

  return function nextFloat() {
    if (offset + 4 > block.length) {
      block = crypto.createHash('sha256').update(`${seedStr}|${counter++}`).digest();
      offset = 0;
    }
    const val = block.readUInt32BE(offset);
    offset += 4;
    return val / 0x100000000;
  };
}

function seededShuffle(items, rng) {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

class ExamStore {
  constructor(storePath = STORE_PATH) {
    this.storePath = storePath;
    this.data = this._load();
  }

  _load() {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    if (!fs.existsSync(this.storePath)) {
      const initial = createInitialStore();
      this._writeSync(initial);
      return initial;
    }
    try {
      const raw = fs.readFileSync(this.storePath, 'utf8');
      const parsed = JSON.parse(raw);
      const deletedSeedIds = Array.isArray(parsed.deletedSeedIds) ? parsed.deletedSeedIds : [];
      const deletedSet = new Set(deletedSeedIds);
      const loadedQuestions = Array.isArray(parsed.questions) ? parsed.questions : [];
      const existingIds = new Set(loadedQuestions.map((q) => q.id));
      const now = new Date().toISOString();
      let seedAdded = false;
      for (const seedQ of SEED_QUESTIONS) {
        if (!existingIds.has(seedQ.id) && !deletedSet.has(seedQ.id)) {
          loadedQuestions.push({
            ...seedQ,
            isCustom: false,
            createdAt: now
          });
          seedAdded = true;
        }
      }

      const loaded = {
        settings: {
          instituteName: 'CodeAura Classroom',
          teacherName: 'Sir',
          teacherPin: '1234',
          pinChanged: false,
          ...(parsed.settings || {}),
          email: {
            enabled: false,
            provider: 'gmail',
            smtpHost: 'smtp.gmail.com',
            smtpPort: 465,
            smtpSecure: true,
            smtpUser: '',
            smtpPass: '',
            teacherEmails: '',
            sendToTeacher: true,
            sendToStudent: true,
            requireStudentEmail: false,
            ...((parsed.settings && parsed.settings.email) || {})
          },
          ai: {
            enabled: false,
            baseUrl: 'https://api.cent-ai.dev/v1',
            apiKey: '',
            model: 'deepseek-v4.1-flash',
            ...((parsed.settings && parsed.settings.ai) || {})
          }
        },
        subjects: Array.isArray(parsed.subjects) && parsed.subjects.length > 0
          ? parsed.subjects
          : DEFAULT_SUBJECTS.map((s) => ({ ...s })),
        questions: loadedQuestions,
        exams: Array.isArray(parsed.exams) ? parsed.exams : [],
        submissions: Array.isArray(parsed.submissions) ? parsed.submissions : [],
        deletedSeedIds
      };
      if (seedAdded) {
        this._writeSync(loaded);
      }
      return loaded;
    } catch (err) {
      const backupPath = `${this.storePath}.corrupt-${Date.now()}`;
      try {
        fs.copyFileSync(this.storePath, backupPath);
      } catch (_) {}
      const initial = createInitialStore();
      this._writeSync(initial);
      return initial;
    }
  }

  _writeSync(data) {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    const tmpPath = `${this.storePath}.tmp-${process.pid}-${Date.now()}`;
    fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(tmpPath, this.storePath);
  }

  save() {
    this._writeSync(this.data);
  }

  // ---------- PUBLIC / META ----------
  getPublicInfo() {
    const liveExams = this.data.exams.filter((e) => e.isLive && e.questionIds.length > 0);
    const email = this.data.settings.email || {};
    const emailConfigured = Boolean(email.enabled && email.smtpHost && email.smtpUser && email.smtpPass);
    return {
      instituteName: this.data.settings.instituteName,
      teacherName: this.data.settings.teacherName,
      isDefaultPin: !this.data.settings.pinChanged && this.data.settings.teacherPin === '1234',
      totalSubjects: this.data.subjects.length,
      totalQuestions: this.data.questions.length,
      liveExamsCount: liveExams.length,
      subjects: this.data.subjects,
      emailEnabled: emailConfigured,
      sendToStudentEmail: Boolean(emailConfigured && email.sendToStudent),
      requireStudentEmail: Boolean(emailConfigured && email.requireStudentEmail)
    };
  }

  getTeacherSettings() {
    const s = this.data.settings;
    const e = s.email || {};
    const a = s.ai || {};
    return {
      instituteName: s.instituteName,
      teacherName: s.teacherName,
      isDefaultPin: !s.pinChanged && s.teacherPin === '1234',
      email: {
        enabled: Boolean(e.enabled),
        provider: e.provider || 'gmail',
        smtpHost: e.smtpHost || 'smtp.gmail.com',
        smtpPort: Number(e.smtpPort) || 465,
        smtpSecure: e.smtpSecure !== false,
        smtpUser: e.smtpUser || '',
        hasSmtpPassword: Boolean(e.smtpPass),
        teacherEmails: e.teacherEmails || '',
        sendToTeacher: e.sendToTeacher !== false,
        sendToStudent: e.sendToStudent !== false,
        requireStudentEmail: Boolean(e.requireStudentEmail)
      },
      ai: {
        enabled: Boolean(a.enabled && a.baseUrl && a.apiKey),
        baseUrl: a.baseUrl || 'https://api.cent-ai.dev/v1',
        model: a.model || 'deepseek-v4.1-flash',
        hasApiKey: Boolean(a.apiKey)
      }
    };
  }

  getRawEmailConfig() {
    return { ...(this.data.settings.email || {}) };
  }

  getRawAiConfig() {
    return { ...(this.data.settings.ai || {}) };
  }

  // ---------- SETTINGS ----------
  verifyTeacherPin(pin) {
    return String(pin || '').trim() === String(this.data.settings.teacherPin);
  }

  updateSettings({ instituteName, teacherName, currentPin, newPin, email, ai }) {
    if (instituteName && String(instituteName).trim()) {
      this.data.settings.instituteName = String(instituteName).trim().slice(0, 80);
    }
    if (teacherName && String(teacherName).trim()) {
      this.data.settings.teacherName = String(teacherName).trim().slice(0, 50);
    }
    if (newPin !== undefined && String(newPin).trim() !== '') {
      if (String(currentPin || '').trim() !== String(this.data.settings.teacherPin)) {
        const err = new Error('Current PIN is incorrect.');
        err.statusCode = 400;
        throw err;
      }
      const trimmedNew = String(newPin).trim();
      if (trimmedNew.length < 4) {
        const err = new Error('New PIN must be at least 4 characters.');
        err.statusCode = 400;
        throw err;
      }
      this.data.settings.teacherPin = trimmedNew;
      this.data.settings.pinChanged = true;
    }
    if (email && typeof email === 'object') {
      const cur = this.data.settings.email || {};
      const next = {
        ...cur,
        enabled: email.enabled !== undefined ? Boolean(email.enabled) : Boolean(cur.enabled),
        provider: email.provider !== undefined ? String(email.provider).trim() : (cur.provider || 'gmail'),
        smtpHost: email.smtpHost !== undefined ? String(email.smtpHost).trim() : (cur.smtpHost || ''),
        smtpPort: email.smtpPort !== undefined ? Math.max(1, Math.min(65535, Number(email.smtpPort) || 465)) : (Number(cur.smtpPort) || 465),
        smtpSecure: email.smtpSecure !== undefined ? Boolean(email.smtpSecure) : (cur.smtpSecure !== false),
        smtpUser: email.smtpUser !== undefined ? String(email.smtpUser).trim() : (cur.smtpUser || ''),
        teacherEmails: email.teacherEmails !== undefined ? String(email.teacherEmails).trim() : (cur.teacherEmails || ''),
        sendToTeacher: email.sendToTeacher !== undefined ? Boolean(email.sendToTeacher) : (cur.sendToTeacher !== false),
        sendToStudent: email.sendToStudent !== undefined ? Boolean(email.sendToStudent) : (cur.sendToStudent !== false),
        requireStudentEmail: email.requireStudentEmail !== undefined ? Boolean(email.requireStudentEmail) : Boolean(cur.requireStudentEmail)
      };
      if (email.clearSmtpPass) {
        next.smtpPass = '';
      } else if (email.smtpPass !== undefined && String(email.smtpPass).trim() !== '') {
        next.smtpPass = String(email.smtpPass).trim();
      }
      this.data.settings.email = next;
    }
    if (ai && typeof ai === 'object') {
      const curAi = this.data.settings.ai || {};
      const nextAi = {
        ...curAi,
        enabled: ai.enabled !== undefined ? Boolean(ai.enabled) : Boolean(curAi.enabled),
        baseUrl: ai.baseUrl !== undefined ? String(ai.baseUrl).trim() : (curAi.baseUrl || 'https://api.cent-ai.dev/v1'),
        model: ai.model !== undefined ? String(ai.model).trim() : (curAi.model || 'deepseek-v4.1-flash')
      };
      if (ai.clearApiKey) {
        nextAi.apiKey = '';
      } else if (ai.apiKey !== undefined && String(ai.apiKey).trim() !== '') {
        nextAi.apiKey = String(ai.apiKey).trim();
      }
      this.data.settings.ai = nextAi;
    }
    this.save();
    return this.getTeacherSettings();
  }

  // ---------- SUBJECTS ----------
  listSubjects() {
    const counts = {};
    for (const q of this.data.questions) {
      counts[q.subjectId] = (counts[q.subjectId] || 0) + 1;
    }
    return this.data.subjects.map((s) => ({
      ...s,
      questionCount: counts[s.id] || 0
    }));
  }

  addSubject({ name, fullName, color, badge }) {
    const cleanName = String(name || '').trim();
    if (!cleanName) {
      const err = new Error('Subject name is required.');
      err.statusCode = 400;
      throw err;
    }
    const baseId = cleanName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || `subj-${Date.now()}`;

    if (this.data.subjects.some((s) => s.id === baseId || s.name.toLowerCase() === cleanName.toLowerCase())) {
      const err = new Error('A subject with this name already exists.');
      err.statusCode = 409;
      throw err;
    }

    const palette = [
      { color: '#7c3aed', bgColor: '#f5f3ff' },
      { color: '#db2777', bgColor: '#fdf2f8' },
      { color: '#0d9488', bgColor: '#f0fdfa' },
      { color: '#2563eb', bgColor: '#eff6ff' },
      { color: '#d97706', bgColor: '#fffbeb' }
    ];
    const picked = palette[this.data.subjects.length % palette.length];
    const subjectColor = /^#[0-9a-fA-F]{6}$/.test(String(color || '')) ? color : picked.color;

    const newSubject = {
      id: baseId,
      name: cleanName.slice(0, 40),
      fullName: String(fullName || cleanName).trim().slice(0, 80),
      color: subjectColor,
      bgColor: picked.bgColor,
      badge: String(badge || cleanName.slice(0, 6).toUpperCase()).trim()
    };
    this.data.subjects.push(newSubject);
    this.save();
    return { ...newSubject, questionCount: 0 };
  }

  // ---------- QUESTIONS ----------
  listQuestions({ subjectId, difficulty, search } = {}) {
    let list = this.data.questions;
    if (subjectId && subjectId !== 'all') {
      list = list.filter((q) => q.subjectId === subjectId);
    }
    if (difficulty && difficulty !== 'all') {
      list = list.filter((q) => q.difficulty.toLowerCase() === difficulty.toLowerCase());
    }
    if (search && String(search).trim()) {
      const term = String(search).trim().toLowerCase();
      list = list.filter((q) =>
        q.question.toLowerCase().includes(term) ||
        (q.code && q.code.toLowerCase().includes(term)) ||
        q.options.some((opt) => opt.toLowerCase().includes(term))
      );
    }
    return list;
  }

  addQuestion(payload) {
    const subjectId = String(payload.subjectId || '').trim();
    if (!this.data.subjects.some((s) => s.id === subjectId)) {
      const err = new Error('Please choose a valid subject.');
      err.statusCode = 400;
      throw err;
    }
    const question = String(payload.question || '').trim();
    if (!question) {
      const err = new Error('Question text is required.');
      err.statusCode = 400;
      throw err;
    }
    const options = Array.isArray(payload.options)
      ? payload.options.map((o) => String(o || '').trim())
      : [];
    if (options.length !== 4 || options.some((o) => !o)) {
      const err = new Error('Exactly 4 non-empty options are required.');
      err.statusCode = 400;
      throw err;
    }
    const correctIndex = Number(payload.correctIndex);
    if (!Number.isInteger(correctIndex) || correctIndex < 0 || correctIndex > 3) {
      const err = new Error('Correct option index must be between 0 and 3.');
      err.statusCode = 400;
      throw err;
    }
    const allowedDiff = ['Easy', 'Medium', 'Hard'];
    const difficulty = allowedDiff.includes(payload.difficulty) ? payload.difficulty : 'Medium';

    const item = {
      id: `q-${crypto.randomBytes(4).toString('hex')}`,
      subjectId,
      difficulty,
      question,
      code: String(payload.code || '').trim(),
      options,
      correctIndex,
      explanation: String(payload.explanation || '').trim(),
      isCustom: true,
      isAiGenerated: Boolean(payload.isAiGenerated),
      createdAt: new Date().toISOString()
    };
    this.data.questions.unshift(item);
    this.save();
    return item;
  }

  bulkAddQuestions(items) {
    if (!Array.isArray(items) || items.length === 0) {
      const err = new Error('Provide an array of questions to import.');
      err.statusCode = 400;
      throw err;
    }
    const added = [];
    for (const raw of items) {
      added.push(this.addQuestion(raw));
    }
    return added;
  }

  updateQuestion(id, payload) {
    const idx = this.data.questions.findIndex((q) => q.id === id);
    if (idx === -1) {
      const err = new Error('Question not found.');
      err.statusCode = 404;
      throw err;
    }
    const existing = this.data.questions[idx];
    const subjectId = payload.subjectId !== undefined ? String(payload.subjectId).trim() : existing.subjectId;
    if (!this.data.subjects.some((s) => s.id === subjectId)) {
      const err = new Error('Invalid subject.');
      err.statusCode = 400;
      throw err;
    }
    const question = payload.question !== undefined ? String(payload.question).trim() : existing.question;
    if (!question) {
      const err = new Error('Question text cannot be empty.');
      err.statusCode = 400;
      throw err;
    }
    const options = Array.isArray(payload.options)
      ? payload.options.map((o) => String(o || '').trim())
      : existing.options;
    if (options.length !== 4 || options.some((o) => !o)) {
      const err = new Error('All 4 options must be non-empty.');
      err.statusCode = 400;
      throw err;
    }
    const correctIndex = payload.correctIndex !== undefined ? Number(payload.correctIndex) : existing.correctIndex;
    if (!Number.isInteger(correctIndex) || correctIndex < 0 || correctIndex > 3) {
      const err = new Error('Correct option index must be 0..3.');
      err.statusCode = 400;
      throw err;
    }
    const allowedDiff = ['Easy', 'Medium', 'Hard'];
    const difficulty = payload.difficulty && allowedDiff.includes(payload.difficulty)
      ? payload.difficulty
      : existing.difficulty;

    const updated = {
      ...existing,
      subjectId,
      difficulty,
      question,
      code: payload.code !== undefined ? String(payload.code).trim() : existing.code,
      options,
      correctIndex,
      explanation: payload.explanation !== undefined ? String(payload.explanation).trim() : existing.explanation,
      updatedAt: new Date().toISOString()
    };
    this.data.questions[idx] = updated;
    this.save();
    return updated;
  }

  deleteQuestion(id) {
    const idx = this.data.questions.findIndex((q) => q.id === id);
    if (idx === -1) {
      const err = new Error('Question not found.');
      err.statusCode = 404;
      throw err;
    }
    const [removed] = this.data.questions.splice(idx, 1);
    if (removed && !removed.isCustom) {
      if (!Array.isArray(this.data.deletedSeedIds)) this.data.deletedSeedIds = [];
      if (!this.data.deletedSeedIds.includes(id)) this.data.deletedSeedIds.push(id);
    }
    for (const exam of this.data.exams) {
      exam.questionIds = exam.questionIds.filter((qId) => qId !== id);
    }
    this.save();
    return { deleted: true, id };
  }

  // ---------- EXAMS ----------
  _enrichExamSummary(exam) {
    const qMap = new Map(this.data.questions.map((q) => [q.id, q]));
    const subjMap = new Map(this.data.subjects.map((s) => [s.id, s]));
    const validQuestions = exam.questionIds.map((id) => qMap.get(id)).filter(Boolean);

    const subjectBreakdown = {};
    for (const q of validQuestions) {
      const subj = subjMap.get(q.subjectId);
      const key = q.subjectId;
      if (!subjectBreakdown[key]) {
        subjectBreakdown[key] = {
          subjectId: key,
          name: subj ? subj.name : key,
          color: subj ? subj.color : '#4f46e5',
          bgColor: subj ? subj.bgColor : '#eef2ff',
          count: 0
        };
      }
      subjectBreakdown[key].count += 1;
    }

    const submissionsCount = this.data.submissions.filter((s) => s.examId === exam.id).length;
    const rawPerStu = Number(exam.questionsPerStudent) || 0;
    const serveCount = rawPerStu > 0 && rawPerStu < validQuestions.length ? rawPerStu : validQuestions.length;

    return {
      ...exam,
      questionIds: validQuestions.map((q) => q.id),
      poolCount: validQuestions.length,
      questionCount: serveCount,
      questionsPerStudent: rawPerStu,
      shuffleQuestions: exam.shuffleQuestions !== false,
      shuffleOptions: exam.shuffleOptions !== undefined ? Boolean(exam.shuffleOptions) : (exam.shuffleQuestions !== false),
      rotateDailyPool: exam.rotateDailyPool !== false,
      totalMarks: Number((serveCount * (Number(exam.marksPerQuestion) || 1)).toFixed(2)),
      subjectBreakdown: Object.values(subjectBreakdown),
      submissionsCount
    };
  }

  listExamsTeacher() {
    return this.data.exams
      .map((exam) => this._enrichExamSummary(exam))
      .sort((a, b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt));
  }

  saveExam(payload) {
    const title = String(payload.title || '').trim();
    if (!title) {
      const err = new Error('Exam title is required.');
      err.statusCode = 400;
      throw err;
    }

    const qIdSet = new Set(this.data.questions.map((q) => q.id));
    const questionIds = Array.isArray(payload.questionIds)
      ? [...new Set(payload.questionIds.filter((id) => qIdSet.has(id)))]
      : [];

    if (questionIds.length === 0) {
      const err = new Error('Please select at least 1 MCQ for the exam.');
      err.statusCode = 400;
      throw err;
    }

    const durationMinutes = Math.max(1, Math.min(300, Number(payload.durationMinutes) || 15));
    const marksPerQuestion = Math.max(0.5, Math.min(100, Number(payload.marksPerQuestion) || 1));
    const negativeMarking = Math.max(0, Math.min(marksPerQuestion, Number(payload.negativeMarking) || 0));
    const passPercentage = Math.max(1, Math.min(100, Number(payload.passPercentage) || 40));
    const proctorTabSwitch = payload.proctorTabSwitch !== undefined ? Boolean(payload.proctorTabSwitch) : true;
    const rawMaxViolations = Number(payload.maxTabViolations);
    const maxTabViolations = Number.isFinite(rawMaxViolations) ? Math.max(0, Math.min(20, Math.round(rawMaxViolations))) : 1;
    const requireFullscreen = payload.requireFullscreen !== undefined ? Boolean(payload.requireFullscreen) : true;
    const blockCopyPaste = payload.blockCopyPaste !== undefined ? Boolean(payload.blockCopyPaste) : true;
    const rawSpeed = Number(payload.speedModeSeconds);
    const speedModeSeconds = Number.isFinite(rawSpeed) && rawSpeed > 0 ? Math.max(5, Math.min(300, Math.round(rawSpeed))) : 0;
    const shuffleQuestions = payload.shuffleQuestions !== undefined ? Boolean(payload.shuffleQuestions) : true;
    const shuffleOptions = payload.shuffleOptions !== undefined ? Boolean(payload.shuffleOptions) : shuffleQuestions;
    const rotateDailyPool = payload.rotateDailyPool !== undefined ? Boolean(payload.rotateDailyPool) : true;
    const rawPerStu = Number(payload.questionsPerStudent);
    const questionsPerStudent = Number.isFinite(rawPerStu) && rawPerStu > 0
      ? Math.max(1, Math.min(200, Math.round(rawPerStu)))
      : 0;
    const now = new Date().toISOString();

    if (payload.id) {
      const idx = this.data.exams.findIndex((e) => e.id === payload.id);
      if (idx === -1) {
        const err = new Error('Exam not found.');
        err.statusCode = 404;
        throw err;
      }
      const updated = {
        ...this.data.exams[idx],
        title: title.slice(0, 120),
        description: String(payload.description || '').trim().slice(0, 500),
        durationMinutes,
        marksPerQuestion,
        negativeMarking,
        passPercentage,
        shuffleQuestions,
        shuffleOptions,
        rotateDailyPool,
        questionsPerStudent,
        showResultsImmediately: payload.showResultsImmediately !== false,
        allowRetake: payload.allowRetake !== false,
        proctorTabSwitch,
        maxTabViolations,
        requireFullscreen,
        blockCopyPaste,
        speedModeSeconds,
        isLive: payload.isLive !== undefined ? Boolean(payload.isLive) : this.data.exams[idx].isLive,
        questionIds,
        updatedAt: now
      };
      this.data.exams[idx] = updated;
      this.save();
      return this._enrichExamSummary(updated);
    }

    const created = {
      id: `exam-${crypto.randomBytes(4).toString('hex')}`,
      title: title.slice(0, 120),
      description: String(payload.description || '').trim().slice(0, 500),
      durationMinutes,
      marksPerQuestion,
      negativeMarking,
      passPercentage,
      shuffleQuestions,
      shuffleOptions,
      rotateDailyPool,
      questionsPerStudent,
      showResultsImmediately: payload.showResultsImmediately !== false,
      allowRetake: payload.allowRetake !== false,
      proctorTabSwitch,
      maxTabViolations,
      requireFullscreen,
      blockCopyPaste,
      speedModeSeconds,
      isLive: payload.isLive !== undefined ? Boolean(payload.isLive) : true,
      questionIds,
      createdAt: now,
      updatedAt: now
    };
    this.data.exams.unshift(created);
    this.save();
    return this._enrichExamSummary(created);
  }

  toggleExamLive(id, isLive) {
    const exam = this.data.exams.find((e) => e.id === id);
    if (!exam) {
      const err = new Error('Exam not found.');
      err.statusCode = 404;
      throw err;
    }
    exam.isLive = Boolean(isLive);
    exam.updatedAt = new Date().toISOString();
    this.save();
    return this._enrichExamSummary(exam);
  }

  deleteExam(id) {
    const idx = this.data.exams.findIndex((e) => e.id === id);
    if (idx === -1) {
      const err = new Error('Exam not found.');
      err.statusCode = 404;
      throw err;
    }
    this.data.exams.splice(idx, 1);
    this.save();
    return { deleted: true, id };
  }

  // ---------- STUDENT PORTAL ----------
  listLiveExamsForStudent() {
    return this.data.exams
      .filter((e) => e.isLive && e.questionIds.length > 0)
      .map((exam) => {
        const enriched = this._enrichExamSummary(exam);
        return {
          id: enriched.id,
          title: enriched.title,
          description: enriched.description,
          durationMinutes: enriched.durationMinutes,
          marksPerQuestion: enriched.marksPerQuestion,
          negativeMarking: enriched.negativeMarking,
          passPercentage: enriched.passPercentage,
          allowRetake: enriched.allowRetake,
          proctorTabSwitch: enriched.proctorTabSwitch !== false,
          maxTabViolations: enriched.maxTabViolations ?? 1,
          requireFullscreen: enriched.requireFullscreen !== false,
          blockCopyPaste: enriched.blockCopyPaste !== false,
          speedModeSeconds: Number(enriched.speedModeSeconds) || 0,
          questionCount: enriched.questionCount,
          totalMarks: enriched.totalMarks,
          subjectBreakdown: enriched.subjectBreakdown,
          updatedAt: enriched.updatedAt
        };
      });
  }

  _selectQuestionsForStudent(exam, rollNumber, todayKey) {
    const qMap = new Map(this.data.questions.map((q) => [q.id, q]));
    const selectedQs = exam.questionIds.map((id) => qMap.get(id)).filter(Boolean);
    const rawPerStu = Number(exam.questionsPerStudent) || 0;
    const serveCount = rawPerStu > 0 && rawPerStu < selectedQs.length ? rawPerStu : selectedQs.length;
    const rollSeed = String(rollNumber || '').trim().toLowerCase() || crypto.randomBytes(4).toString('hex');
    const studentRng = createSeededRng(`${exam.id}|${todayKey}|${rollSeed}`);

    // Compute proportional target count per subject based on selectedQs
    const subjCounts = new Map();
    for (const q of selectedQs) {
      subjCounts.set(q.subjectId, (subjCounts.get(q.subjectId) || 0) + 1);
    }

    const allocs = [];
    let allocated = 0;
    const subjEntries = [...subjCounts.entries()];
    subjEntries.forEach(([sid, origCount], idx) => {
      let take = idx === subjEntries.length - 1
        ? serveCount - allocated
        : Math.max(1, Math.round((origCount / selectedQs.length) * serveCount));
      take = Math.max(0, Math.min(serveCount - allocated, take));
      allocated += take;
      allocs.push([sid, take]);
    });

    const dayMs = Date.parse(`${todayKey}T00:00:00Z`);
    const dayIndex = Number.isFinite(dayMs) ? Math.floor(dayMs / 86400000) : 0;
    const useExplicitSubset = rawPerStu > 0 && rawPerStu < selectedQs.length;
    const useDailyBankRotation = !useExplicitSubset && exam.rotateDailyPool !== false;

    const chosen = [];
    const chosenIds = new Set();

    for (const [sid, take] of allocs) {
      if (take <= 0) continue;
      const explicitPool = selectedQs.filter((q) => q.subjectId === sid);
      let pool = explicitPool;

      if (useDailyBankRotation) {
        const bankForSubj = this.data.questions.filter((q) => q.subjectId === sid);
        if (bankForSubj.length > take) {
          pool = bankForSubj;
        }
      }

      if (pool.length <= take) {
        for (const q of pool) {
          if (!chosenIds.has(q.id)) {
            chosenIds.add(q.id);
            chosen.push(q);
          }
        }
        continue;
      }

      // Build daily rotated window so different days serve different cohorts,
      // while always keeping today's freshly generated AI MCQs prioritized in today's cohort.
      const baseOrdered = seededShuffle(pool, createSeededRng(`${exam.id}|base|${sid}`));
      const n = baseOrdered.length;
      const startOffset = ((Math.abs(dayIndex) * take) % n + n) % n;
      const rotated = [...baseOrdered.slice(startOffset), ...baseOrdered.slice(0, startOffset)];
      const cohortSize = Math.min(n, Math.max(take * 2, Math.ceil(n * 0.6)));
      const cohortSlice = rotated.slice(0, cohortSize);

      const todaysAi = rotated.filter((q) => q.isAiGenerated && String(q.createdAt || '').startsWith(todayKey));
      const cohortMap = new Map();
      for (const q of [...todaysAi, ...cohortSlice]) {
        if (!cohortMap.has(q.id) && cohortMap.size < cohortSize) {
          cohortMap.set(q.id, q);
        }
      }

      const studentOrder = seededShuffle([...cohortMap.values()], createSeededRng(`${exam.id}|${todayKey}|${sid}|${rollSeed}`));
      let pickedHere = 0;
      for (const q of studentOrder) {
        if (pickedHere >= take) break;
        if (!chosenIds.has(q.id)) {
          chosenIds.add(q.id);
          chosen.push(q);
          pickedHere += 1;
        }
      }
    }

    const shouldShuffleQuestions = exam.shuffleQuestions !== false;
    const shouldShuffleOptions = exam.shuffleOptions !== undefined
      ? Boolean(exam.shuffleOptions)
      : shouldShuffleQuestions;

    const finalQs = shouldShuffleQuestions ? seededShuffle(chosen, studentRng) : chosen;
    return finalQs.map((q) => ({
      q,
      perm: shouldShuffleOptions ? seededShuffle([0, 1, 2, 3], studentRng) : [0, 1, 2, 3]
    }));
  }

  getExamForStudent(examId, rollNumber, { dateKey } = {}) {
    const exam = this.data.exams.find((e) => e.id === examId && e.isLive);
    if (!exam) {
      const err = new Error('This exam is no longer live or does not exist.');
      err.statusCode = 404;
      throw err;
    }

    if (!exam.allowRetake && rollNumber) {
      const cleanRoll = String(rollNumber).trim().toLowerCase();
      const alreadySubmitted = this.data.submissions.find(
        (s) => s.examId === exam.id && s.rollNumber.toLowerCase() === cleanRoll
      );
      if (alreadySubmitted) {
        const err = new Error('You have already submitted this exam (retakes are disabled by Sir).');
        err.statusCode = 409;
        throw err;
      }
    }

    const todayKey = dateKey || getLocalDateKey();
    const subjMap = new Map(this.data.subjects.map((s) => [s.id, s]));
    const servedList = this._selectQuestionsForStudent(exam, rollNumber, todayKey);

    const questions = servedList.map(({ q, perm }) => {
      const subj = subjMap.get(q.subjectId);
      // Strip correctIndex and explanation so students cannot cheat via DevTools!
      return {
        id: q.id,
        subjectId: q.subjectId,
        subjectName: subj ? subj.name : q.subjectId,
        subjectColor: subj ? subj.color : '#4f46e5',
        subjectBgColor: subj ? subj.bgColor : '#eef2ff',
        difficulty: q.difficulty,
        question: q.question,
        code: q.code || '',
        options: perm.map((origIdx) => q.options[origIdx])
      };
    });

    const _paperSpec = servedList.map(({ q, perm }) => [q.id, perm]);

    return {
      id: exam.id,
      title: exam.title,
      description: exam.description,
      durationMinutes: exam.durationMinutes,
      marksPerQuestion: exam.marksPerQuestion,
      negativeMarking: exam.negativeMarking,
      passPercentage: exam.passPercentage,
      proctorTabSwitch: exam.proctorTabSwitch !== false,
      maxTabViolations: exam.maxTabViolations ?? 1,
      requireFullscreen: exam.requireFullscreen !== false,
      blockCopyPaste: exam.blockCopyPaste !== false,
      speedModeSeconds: Number(exam.speedModeSeconds) || 0,
      totalMarks: Number((questions.length * (Number(exam.marksPerQuestion) || 1)).toFixed(2)),
      questionCount: questions.length,
      questions,
      _paperSpec
    };
  }

  submitStudentExam(examId, payload, { paperSpec = null } = {}) {
    const exam = this.data.exams.find((e) => e.id === examId);
    if (!exam) {
      const err = new Error('Exam not found.');
      err.statusCode = 404;
      throw err;
    }

    const studentName = String(payload.studentName || '').trim();
    const rollNumber = String(payload.rollNumber || '').trim();
    const batch = String(payload.batch || '').trim();
    const studentEmail = String(payload.studentEmail || '').trim();

    if (!studentName || !rollNumber) {
      const err = new Error('Student Name and Roll Number are required.');
      err.statusCode = 400;
      throw err;
    }

    const emailCfg = this.data.settings.email || {};
    const emailEnabled = Boolean(emailCfg.enabled && emailCfg.smtpHost && emailCfg.smtpUser && emailCfg.smtpPass);
    if (emailEnabled && emailCfg.requireStudentEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(studentEmail)) {
      const err = new Error('A valid Student Email address is required.');
      err.statusCode = 400;
      throw err;
    }
    if (studentEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(studentEmail)) {
      const err = new Error('Please enter a valid Student Email address.');
      err.statusCode = 400;
      throw err;
    }

    if (!exam.allowRetake) {
      const existing = this.data.submissions.find(
        (s) => s.examId === exam.id && s.rollNumber.toLowerCase() === rollNumber.toLowerCase()
      );
      if (existing) {
        const err = new Error('A submission for this Roll Number already exists.');
        err.statusCode = 409;
        throw err;
      }
    }

    const answers = payload.answers && typeof payload.answers === 'object' ? payload.answers : {};
    const timeTakenSeconds = Math.max(0, Math.round(Number(payload.timeTakenSeconds) || 0));

    const qMap = new Map(this.data.questions.map((q) => [q.id, q]));
    const subjMap = new Map(this.data.subjects.map((s) => [s.id, s]));

    let servedEntries;
    if (Array.isArray(paperSpec) && paperSpec.length > 0) {
      servedEntries = paperSpec
        .map((entry) => {
          const qId = Array.isArray(entry) ? entry[0] : entry;
          const rawPerm = Array.isArray(entry) && Array.isArray(entry[1]) ? entry[1] : [0, 1, 2, 3];
          const q = qMap.get(qId);
          if (!q) return null;
          const validPerm = rawPerm.length === 4 && [0, 1, 2, 3].every((n) => rawPerm.includes(n))
            ? rawPerm
            : [0, 1, 2, 3];
          return { q, perm: validPerm };
        })
        .filter(Boolean);
    } else {
      servedEntries = exam.questionIds
        .map((id) => qMap.get(id))
        .filter(Boolean)
        .map((q) => ({ q, perm: [0, 1, 2, 3] }));
    }

    const marksPerQ = Number(exam.marksPerQuestion) || 1;
    const negMark = Number(exam.negativeMarking) || 0;

    let correctCount = 0;
    let wrongCount = 0;
    let skippedCount = 0;
    let rawScore = 0;

    const subjectStats = {};
    const review = [];

    for (const { q, perm } of servedEntries) {
      const subj = subjMap.get(q.subjectId);
      const subjName = subj ? subj.name : q.subjectId;
      if (!subjectStats[q.subjectId]) {
        subjectStats[q.subjectId] = {
          subjectId: q.subjectId,
          subjectName: subjName,
          color: subj ? subj.color : '#4f46e5',
          totalQuestions: 0,
          correct: 0,
          wrong: 0,
          skipped: 0,
          marksObtained: 0,
          maxMarks: 0
        };
      }
      const stat = subjectStats[q.subjectId];
      stat.totalQuestions += 1;
      stat.maxMarks = Number((stat.maxMarks + marksPerQ).toFixed(2));

      const presentedOptions = perm.map((origIdx) => q.options[origIdx]);
      const presentedCorrectIndex = perm.indexOf(q.correctIndex);

      const rawChoice = answers[q.id];
      const selectedIndex =
        rawChoice === null || rawChoice === undefined || rawChoice === ''
          ? null
          : Number(rawChoice);

      let status = 'skipped';
      let marksAwarded = 0;

      if (selectedIndex === null || !Number.isInteger(selectedIndex) || selectedIndex < 0 || selectedIndex > 3) {
        skippedCount += 1;
        stat.skipped += 1;
        status = 'skipped';
      } else if (selectedIndex === presentedCorrectIndex) {
        correctCount += 1;
        stat.correct += 1;
        rawScore += marksPerQ;
        marksAwarded = marksPerQ;
        stat.marksObtained = Number((stat.marksObtained + marksPerQ).toFixed(2));
        status = 'correct';
      } else {
        wrongCount += 1;
        stat.wrong += 1;
        rawScore -= negMark;
        marksAwarded = -negMark;
        stat.marksObtained = Number((stat.marksObtained - negMark).toFixed(2));
        status = 'wrong';
      }

      review.push({
        questionId: q.id,
        subjectId: q.subjectId,
        subjectName: subjName,
        question: q.question,
        code: q.code || '',
        options: presentedOptions,
        selectedIndex,
        correctIndex: presentedCorrectIndex,
        explanation: q.explanation || '',
        status,
        marksAwarded
      });
    }

    const totalMarks = Number((servedEntries.length * marksPerQ).toFixed(2));
    const score = Number(Math.max(0, rawScore).toFixed(2));
    const percentage = totalMarks > 0 ? Number(((score / totalMarks) * 100).toFixed(1)) : 0;
    const passed = percentage >= (Number(exam.passPercentage) || 40);

    const rawProctor = payload.proctoring && typeof payload.proctoring === 'object' ? payload.proctoring : {};
    const events = Array.isArray(rawProctor.events)
      ? rawProctor.events.slice(0, 50).map((ev) => ({
          type: String(ev.type || 'tab-switch').slice(0, 32),
          questionNumber: Number(ev.questionNumber) || 1,
          at: String(ev.at || new Date().toISOString())
        }))
      : [];
    const violationsCount = Math.max(0, Number(rawProctor.violationsCount) || events.length);
    const allowedReasons = ['manual', 'timer-expired', 'proctor-limit', 'speed-mode-timeout'];
    const autoSubmittedReason = allowedReasons.includes(rawProctor.autoSubmittedReason)
      ? rawProctor.autoSubmittedReason
      : 'manual';

    const submission = {
      id: `sub-${crypto.randomBytes(5).toString('hex')}`,
      examId: exam.id,
      examTitle: exam.title,
      studentName: studentName.slice(0, 80),
      rollNumber: rollNumber.slice(0, 40),
      batch: batch.slice(0, 40),
      studentEmail: studentEmail.slice(0, 120),
      totalQuestions: servedEntries.length,
      correctCount,
      wrongCount,
      skippedCount,
      score,
      totalMarks,
      percentage,
      passed,
      passPercentage: Number(exam.passPercentage) || 40,
      timeTakenSeconds,
      subjectBreakdown: Object.values(subjectStats),
      proctoring: {
        violationsCount,
        maxViolations: exam.maxTabViolations ?? 3,
        autoSubmittedReason,
        events
      },
      review,
      emailDelivery: {
        status: 'disabled',
        recipients: [],
        error: '',
        sentAt: null
      },
      submittedAt: new Date().toISOString()
    };

    this.data.submissions.unshift(submission);
    this.save();

    // Respect exam's showResultsImmediately toggle for student response
    if (!exam.showResultsImmediately) {
      return {
        id: submission.id,
        examId: submission.examId,
        examTitle: submission.examTitle,
        studentName: submission.studentName,
        rollNumber: submission.rollNumber,
        batch: submission.batch,
        studentEmail: submission.studentEmail,
        totalQuestions: submission.totalQuestions,
        correctCount: submission.correctCount,
        wrongCount: submission.wrongCount,
        skippedCount: submission.skippedCount,
        score: submission.score,
        totalMarks: submission.totalMarks,
        percentage: submission.percentage,
        passed: submission.passed,
        timeTakenSeconds: submission.timeTakenSeconds,
        subjectBreakdown: submission.subjectBreakdown,
        proctoring: submission.proctoring,
        emailDelivery: submission.emailDelivery,
        submittedAt: submission.submittedAt,
        reviewHidden: true,
        review: []
      };
    }

    return submission;
  }

  setSubmissionEmailStatus(submissionId, delivery) {
    const sub = this.data.submissions.find((s) => s.id === submissionId);
    if (!sub) return null;
    sub.emailDelivery = {
      status: delivery.status || 'disabled',
      recipients: Array.isArray(delivery.recipients) ? delivery.recipients : [],
      error: delivery.error || '',
      sentAt: delivery.sentAt || null
    };
    this.save();
    return sub.emailDelivery;
  }

  // ---------- TEACHER RESULTS ----------
  listSubmissions({ examId, search } = {}) {
    let list = this.data.submissions;
    if (examId && examId !== 'all') {
      list = list.filter((s) => s.examId === examId);
    }
    if (search && String(search).trim()) {
      const term = String(search).trim().toLowerCase();
      list = list.filter((s) =>
        s.studentName.toLowerCase().includes(term) ||
        s.rollNumber.toLowerCase().includes(term) ||
        (s.batch && s.batch.toLowerCase().includes(term))
      );
    }
    return list;
  }

  getSubmission(id) {
    return this.data.submissions.find((s) => s.id === id) || null;
  }

  deleteSubmission(id) {
    const idx = this.data.submissions.findIndex((s) => s.id === id);
    if (idx === -1) {
      const err = new Error('Submission not found.');
      err.statusCode = 404;
      throw err;
    }
    this.data.submissions.splice(idx, 1);
    this.save();
    return { deleted: true, id };
  }

  clearSubmissions(examId) {
    if (examId && examId !== 'all') {
      this.data.submissions = this.data.submissions.filter((s) => s.examId !== examId);
    } else {
      this.data.submissions = [];
    }
    this.save();
    return { cleared: true };
  }
}

module.exports = {
  ExamStore,
  STORE_PATH
};
