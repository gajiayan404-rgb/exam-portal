(function () {
  const {
    escapeHtml,
    formatInlineCodeHtml,
    getTeacherToken,
    setTeacherToken,
    apiFetch,
    formatDuration,
    formatDateTime,
    showToast,
    renderSubjectBadge,
    renderDifficultyBadge
  } = window.CodeAura;

  const state = {
    info: null,
    settings: null,
    subjects: [],
    questions: [],
    exams: [],
    submissions: [],
    activeTab: 'overview',
    selectedQuestionIds: new Set(),
    editingExamId: null,
    modalCleanup: null
  };

  // DOM References
  const loginView = document.getElementById('teacher-login-view');
  const appView = document.getElementById('teacher-app-view');
  const loginForm = document.getElementById('teacher-login-form');
  const pinInput = document.getElementById('teacher-pin-input');
  const defaultPinHint = document.getElementById('default-pin-hint');
  const loginErrorMsg = document.getElementById('login-error-msg');
  const logoutBtn = document.getElementById('teacher-logout-btn');
  const copyUrlBtn = document.getElementById('copy-student-url-btn');
  const modal = document.getElementById('teacher-modal');
  const modalContent = document.getElementById('teacher-modal-content');

  // ---------- Modal Helpers ----------
  function openModal(html) {
    modalContent.innerHTML = html;
    modal.classList.remove('hidden');
  }

  function closeModal() {
    modal.classList.add('hidden');
    modalContent.innerHTML = '';
  }

  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeModal();
  });

  // ---------- Auth & Initialization ----------
  async function checkPublicBanner() {
    try {
      const info = await apiFetch('/api/public/info');
      state.info = info;
      document.getElementById('teacher-brand-name').textContent = info.instituteName || 'CodeAura Classroom';
      if (info.isDefaultPin) {
        defaultPinHint.classList.remove('hidden');
      } else {
        defaultPinHint.classList.add('hidden');
      }
    } catch {}
  }

  async function initSession() {
    await checkPublicBanner();
    const token = getTeacherToken();
    if (!token) {
      showLogin();
      return;
    }
    try {
      await apiFetch('/api/teacher/verify', { auth: true });
      await enterWorkspace();
    } catch {
      setTeacherToken('');
      showLogin();
    }
  }

  function showLogin() {
    loginView.classList.remove('hidden');
    appView.classList.add('hidden');
    logoutBtn.classList.add('hidden');
    copyUrlBtn.classList.add('hidden');
    document.getElementById('header-live-status-pill').classList.add('hidden');
    document.getElementById('draft-autosave-pill').classList.add('hidden');
    pinInput.value = '';
    pinInput.focus();
  }

  async function enterWorkspace() {
    loginView.classList.add('hidden');
    appView.classList.remove('hidden');
    logoutBtn.classList.remove('hidden');
    copyUrlBtn.classList.remove('hidden');
    document.getElementById('header-live-status-pill').classList.remove('hidden');
    await loadBootstrap();
    restoreBuilderDraft();
    connectLiveEvents();
  }

  async function loadBootstrap() {
    const data = await apiFetch('/api/teacher/bootstrap', { auth: true });
    state.info = data.info;
    state.settings = data.settings || null;
    state.subjects = data.subjects || [];
    state.questions = data.questions || [];
    state.exams = data.exams || [];
    state.submissions = data.submissions || [];

    document.getElementById('teacher-brand-name').textContent = state.info.instituteName || 'CodeAura Classroom';
    populateDropdowns();
    renderAll();
  }

  let eventSource = null;
  function connectLiveEvents() {
    if (eventSource) {
      eventSource.close();
    }
    eventSource = new EventSource('/api/events');
    eventSource.addEventListener('submission-created', async (ev) => {
      try {
        const payload = JSON.parse(ev.data);
        const flagNote = payload.violationsCount > 0 ? ` (⚠️ ${payload.violationsCount} proctor flag${payload.violationsCount === 1 ? '' : 's'})` : '';
        showToast(
          `New submission: ${payload.studentName} scored ${payload.score}/${payload.totalMarks}${flagNote}`,
          payload.violationsCount > 0 ? 'info' : 'success'
        );
        const res = await apiFetch('/api/teacher/submissions', { auth: true });
        state.submissions = res.submissions || [];
        renderOverview();
        renderResults();
      } catch {}
    });
  }

  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    loginErrorMsg.classList.add('hidden');
    try {
      const data = await apiFetch('/api/teacher/login', {
        method: 'POST',
        body: { pin: pinInput.value }
      });
      setTeacherToken(data.token);
      await enterWorkspace();
      showToast('Welcome back, Sir!', 'success');
    } catch (err) {
      loginErrorMsg.textContent = err.message;
      loginErrorMsg.classList.remove('hidden');
    }
  });

  logoutBtn.addEventListener('click', () => {
    setTeacherToken('');
    if (eventSource) {
      eventSource.close();
      eventSource = null;
    }
    showLogin();
  });

  copyUrlBtn.addEventListener('click', async () => {
    const studentUrl = `${window.location.origin}/student`;
    try {
      await navigator.clipboard.writeText(studentUrl);
      showToast(`Copied: ${studentUrl}`, 'success');
    } catch {
      showToast(studentUrl, 'info');
    }
  });

  // ---------- Tabs ----------
  function switchTab(tabName) {
    state.activeTab = tabName;
    document.querySelectorAll('.tab-btn').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.tab === tabName);
    });
    document.querySelectorAll('.tab-panel').forEach((panel) => {
      panel.classList.toggle('hidden', panel.id !== `tab-${tabName}`);
    });
  }

  document.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  document.getElementById('go-create-exam-btn').addEventListener('click', () => {
    resetBuilderForm();
    switchTab('builder');
  });

  // ---------- Dropdown Population ----------
  function populateDropdowns() {
    const subjOptions = `<option value="all">All Subjects (${state.questions.length})</option>` +
      state.subjects.map((s) => `<option value="${escapeHtml(s.id)}">${escapeHtml(s.name)} (${s.questionCount ?? 0})</option>`).join('');

    const builderSubj = document.getElementById('builder-subj-filter');
    const prevBuilder = builderSubj.value || 'all';
    builderSubj.innerHTML = subjOptions;
    builderSubj.value = prevBuilder;

    const bankSubj = document.getElementById('bank-subj-filter');
    const prevBank = bankSubj.value || 'all';
    bankSubj.innerHTML = subjOptions;
    bankSubj.value = prevBank;

    const resultsExam = document.getElementById('results-exam-filter');
    const prevResExam = resultsExam.value || 'all';
    resultsExam.innerHTML = `<option value="all">All Exams (${state.submissions.length})</option>` +
      state.exams.map((ex) => `<option value="${escapeHtml(ex.id)}">${escapeHtml(ex.title)} (${ex.submissionsCount})</option>`).join('');
    resultsExam.value = prevResExam;

    document.getElementById('set-institute').value = state.info?.instituteName || '';
    document.getElementById('set-teacher').value = state.info?.teacherName || 'Sir';
    populateEmailSettings();
    populateAiSettings();

    const directAiSubj = document.getElementById('direct-ai-subj');
    if (directAiSubj) {
      const prevDirect = directAiSubj.value || 'mixed';
      directAiSubj.innerHTML = `<option value="mixed">Mixed (All Subjects)</option>` +
        state.subjects.map((s) => `<option value="${escapeHtml(s.id)}">${escapeHtml(s.name)}</option>`).join('');
      directAiSubj.value = prevDirect;
    }
  }

  function populateAiSettings() {
    const ai = state.settings?.ai || {};
    document.getElementById('set-ai-base-url').value = ai.baseUrl || 'https://api.cent-ai.dev/v1';
    document.getElementById('set-ai-model').value = ai.model || 'deepseek-v4.1-flash';
    document.getElementById('set-ai-api-key').value = '';
    document.getElementById('set-ai-api-key').placeholder = ai.hasApiKey
      ? 'Saved (leave blank to keep existing)'
      : 'Paste API key...';
    document.getElementById('ai-key-status').textContent = ai.hasApiKey ? '✓ Saved' : '';
    const badge = document.getElementById('ai-status-badge');
    const directBadge = document.getElementById('direct-ai-model-badge');
    if (ai.hasApiKey && ai.baseUrl) {
      badge.className = 'badge badge-success';
      badge.textContent = 'Connected';
      if (directBadge) {
        directBadge.className = 'badge badge-success';
        directBadge.textContent = `✨ Live AI: ${ai.model || 'deepseek-v4.1-flash'}`;
      }
    } else {
      badge.className = 'badge badge-neutral';
      badge.textContent = 'Needs API Key';
      if (directBadge) {
        directBadge.className = 'badge badge-warning';
        directBadge.textContent = 'Configure API Key in Settings';
      }
    }
  }

  function populateEmailSettings() {
    const em = state.settings?.email || {};
    document.getElementById('set-email-enabled').checked = Boolean(em.enabled);
    document.getElementById('set-email-provider').value = em.provider || 'gmail';
    document.getElementById('set-smtp-host').value = em.smtpHost || 'smtp.gmail.com';
    document.getElementById('set-smtp-port').value = em.smtpPort || 465;
    document.getElementById('set-smtp-secure').value = em.smtpSecure === false ? 'starttls' : 'ssl';
    document.getElementById('set-smtp-user').value = em.smtpUser || '';
    document.getElementById('set-smtp-pass').value = '';
    document.getElementById('set-smtp-pass').placeholder = em.hasSmtpPassword
      ? 'Saved (leave blank to keep existing)'
      : '16-char Gmail App Password';
    document.getElementById('smtp-pass-status').textContent = em.hasSmtpPassword ? '✓ Saved' : '';
    document.getElementById('set-teacher-emails').value = em.teacherEmails || '';
    document.getElementById('set-send-teacher').checked = em.sendToTeacher !== false;
    document.getElementById('set-send-student').checked = em.sendToStudent !== false;
    document.getElementById('set-require-student-email').checked = Boolean(em.requireStudentEmail);

    const badge = document.getElementById('email-status-badge');
    if (em.enabled && em.smtpHost && em.smtpUser && em.hasSmtpPassword) {
      badge.className = 'badge badge-success';
      badge.textContent = 'Active';
    } else if (em.enabled) {
      badge.className = 'badge badge-warning';
      badge.textContent = 'Needs Credentials';
    } else {
      badge.className = 'badge badge-neutral';
      badge.textContent = 'Disabled';
    }
  }

  function renderAll() {
    renderOverview();
    renderBuilderQuestions();
    renderSelectedSummary();
    renderBank();
    renderResults();
  }

  function getSubjectMap() {
    return new Map(state.subjects.map((s) => [s.id, s]));
  }

  // ---------- TAB 1: OVERVIEW ----------
  function renderOverview() {
    const liveCount = state.exams.filter((e) => e.isLive).length;
    const headerPill = document.getElementById('header-live-status-pill');
    if (liveCount > 0) {
      headerPill.className = 'badge badge-success';
      headerPill.innerHTML = `<span class="live-dot"></span> ${liveCount} Exam${liveCount === 1 ? '' : 's'} Live`;
    } else {
      headerPill.className = 'badge badge-warning';
      headerPill.textContent = 'Draft Mode • 0 Live';
    }
    const totalSubs = state.submissions.length;
    const avgPct = totalSubs > 0
      ? (state.submissions.reduce((acc, s) => acc + (Number(s.percentage) || 0), 0) / totalSubs).toFixed(1)
      : '0.0';

    document.getElementById('overview-stats').innerHTML = `
      <div class="stat-card">
        <div class="stat-label">Live Student Exams</div>
        <div class="stat-value" style="color:var(--success);">${liveCount}</div>
        <div class="stat-hint">Out of ${state.exams.length} total exam${state.exams.length === 1 ? '' : 's'}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">MCQ Question Bank</div>
        <div class="stat-value" style="color:var(--primary);">${state.questions.length}</div>
        <div class="stat-hint">Across ${state.subjects.length} programming subjects</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Student Submissions</div>
        <div class="stat-value">${totalSubs}</div>
        <div class="stat-hint">Auto-checked &amp; saved</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Class Average</div>
        <div class="stat-value" style="color:var(--warning);">${avgPct}%</div>
        <div class="stat-hint">Across all submissions</div>
      </div>
    `;

    // Share links
    const shareContainer = document.getElementById('teacher-share-links');
    const urls = new Set([`${window.location.origin}/student`]);
    if (Array.isArray(state.info?.lanUrls)) {
      for (const u of state.info.lanUrls) urls.add(`${u}/student`);
    }
    shareContainer.innerHTML = [...urls].map((u) => `
      <div class="flex-row" style="background:#fff;padding:6px 10px;border-radius:8px;border:1px solid var(--primary-border);">
        <code class="font-mono text-sm">${escapeHtml(u)}</code>
        <button type="button" class="btn btn-primary btn-sm share-copy-btn" data-url="${escapeHtml(u)}">Copy</button>
      </div>
    `).join('');

    shareContainer.querySelectorAll('.share-copy-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(btn.dataset.url);
          showToast('Copied Student Portal URL!', 'success');
        } catch {
          showToast(btn.dataset.url, 'info');
        }
      });
    });

    // Exams list
    const listEl = document.getElementById('exams-list-container');
    if (state.exams.length === 0) {
      listEl.innerHTML = `
        <div class="empty-state">
          <p style="margin:0 0 10px;font-weight:600;">No exams created yet.</p>
          <button type="button" class="btn btn-primary" id="empty-create-exam-btn">Create &amp; Select MCQs Now</button>
        </div>
      `;
      document.getElementById('empty-create-exam-btn').addEventListener('click', () => {
        resetBuilderForm();
        switchTab('builder');
      });
      return;
    }

    listEl.innerHTML = state.exams.map((exam) => {
      const subjBadges = (exam.subjectBreakdown || []).map((sb) => `
        <span class="badge" style="color:${escapeHtml(sb.color)};background:${escapeHtml(sb.bgColor)};border-color:${escapeHtml(sb.color)}33;">
          ${escapeHtml(sb.name)}: ${sb.count}
        </span>
      `).join('');

      return `
        <div class="card card-compact" style="border-color:${exam.isLive ? 'var(--success-border)' : 'var(--border)'};background:${exam.isLive ? '#fcfffd' : '#fff'};">
          <div class="flex-between">
            <div style="flex:1;min-width:240px;">
              <div class="flex-row">
                ${exam.isLive
                  ? `<span class="badge badge-success"><span class="live-dot"></span> LIVE ON STUDENT PORTAL</span>`
                  : `<span class="badge badge-neutral">DRAFT (HIDDEN)</span>`
                }
                <strong style="font-size:16.5px;">${escapeHtml(exam.title)}</strong>
              </div>
              ${exam.description ? `<p class="text-muted text-sm" style="margin:6px 0 0;">${escapeHtml(exam.description)}</p>` : ''}
              <div class="flex-row mt-1">
                <span class="badge badge-primary">${exam.questionCount} MCQs</span>
                <span class="badge badge-neutral">${exam.totalMarks} Total Marks</span>
                <span class="badge badge-neutral">⏱ ${exam.durationMinutes} mins</span>
                ${exam.speedModeSeconds > 0 ? `<span class="badge badge-warning">⚡ ${exam.speedModeSeconds}s/Q</span>` : ''}
                ${exam.proctorTabSwitch !== false ? `<span class="badge badge-primary">🛡️ ${exam.maxTabViolations === 1 ? 'Auto-Submit on Tab/App Switch' : exam.maxTabViolations > 1 ? `Proctored (${exam.maxTabViolations} strikes)` : 'Proctored (Warn)'}</span>` : ''}
                <span class="badge badge-neutral">📝 ${exam.submissionsCount} Submissions</span>
                ${subjBadges}
              </div>
            </div>
            <div class="flex-row">
              <button type="button" class="btn btn-sm ${exam.isLive ? 'btn-warning' : 'btn-success'} toggle-live-btn" data-id="${escapeHtml(exam.id)}" data-live="${exam.isLive ? '1' : '0'}">
                ${exam.isLive ? '⏸ Pause / Hide' : '▶ Go Live'}
              </button>
              <button type="button" class="btn btn-secondary btn-sm edit-exam-btn" data-id="${escapeHtml(exam.id)}">
                ✏️ Edit MCQs
              </button>
              <button type="button" class="btn btn-soft-primary btn-sm view-exam-results-btn" data-id="${escapeHtml(exam.id)}">
                📊 Marks
              </button>
              <button type="button" class="btn btn-soft-danger btn-sm delete-exam-btn" data-id="${escapeHtml(exam.id)}">
                🗑
              </button>
            </div>
          </div>
        </div>
      `;
    }).join('');

    listEl.querySelectorAll('.toggle-live-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const currentlyLive = btn.dataset.live === '1';
        try {
          await apiFetch(`/api/teacher/exams/${encodeURIComponent(btn.dataset.id)}/live`, {
            method: 'PATCH',
            auth: true,
            body: { isLive: !currentlyLive }
          });
          showToast(!currentlyLive ? 'Exam is now LIVE on Student Portal!' : 'Exam paused (hidden from students).', 'success');
          await loadBootstrap();
        } catch (err) {
          showToast(err.message, 'error');
        }
      });
    });

    listEl.querySelectorAll('.edit-exam-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const exam = state.exams.find((e) => e.id === btn.dataset.id);
        if (exam) loadExamIntoBuilder(exam);
      });
    });

    listEl.querySelectorAll('.view-exam-results-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.getElementById('results-exam-filter').value = btn.dataset.id;
        renderResults();
        switchTab('results');
      });
    });

    listEl.querySelectorAll('.delete-exam-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (!confirm('Delete this exam? (Student results already submitted remain saved in Results unless cleared.)')) return;
        try {
          await apiFetch(`/api/teacher/exams/${encodeURIComponent(btn.dataset.id)}`, {
            method: 'DELETE',
            auth: true
          });
          showToast('Exam deleted.', 'info');
          if (state.editingExamId === btn.dataset.id) {
            resetBuilderForm();
          }
          await loadBootstrap();
        } catch (err) {
          showToast(err.message, 'error');
        }
      });
    });
  }

  // ---------- TAB 2: EXAM BUILDER & MCQ SELECTOR ----------
  const DRAFT_KEY = 'codeaura_teacher_exam_draft';
  let lastDraftSavedAt = null;

  function updateDraftPillText() {
    const pill = document.getElementById('draft-autosave-pill');
    if (!lastDraftSavedAt) {
      pill.classList.add('hidden');
      return;
    }
    const secs = Math.max(0, Math.floor((Date.now() - lastDraftSavedAt) / 1000));
    const ago = secs < 5 ? 'just now' : secs < 60 ? `${secs}s ago` : `${Math.floor(secs / 60)}m ago`;
    pill.classList.remove('hidden');
    pill.className = 'badge badge-primary';
    pill.textContent = `💾 Saved locally ${ago}`;
  }

  setInterval(updateDraftPillText, 5000);

  function saveBuilderDraft() {
    const title = document.getElementById('exam-title-input').value.trim();
    const desc = document.getElementById('exam-desc-input').value.trim();
    const ids = [...state.selectedQuestionIds];
    if (!title && !desc && ids.length === 0 && !state.editingExamId) {
      clearBuilderDraft();
      return;
    }
    const payload = {
      editingExamId: state.editingExamId || '',
      title: document.getElementById('exam-title-input').value,
      description: document.getElementById('exam-desc-input').value,
      durationMinutes: document.getElementById('exam-duration-input').value,
      marksPerQuestion: document.getElementById('exam-marks-input').value,
      negativeMarking: document.getElementById('exam-neg-input').value,
      passPercentage: document.getElementById('exam-pass-input').value,
      speedModeSeconds: document.getElementById('exam-speed-input').value,
      maxTabViolations: document.getElementById('exam-max-violations-input').value,
      isLive: document.getElementById('exam-live-check').checked,
      shuffleQuestions: document.getElementById('exam-shuffle-check').checked,
      showResultsImmediately: document.getElementById('exam-show-results-check').checked,
      allowRetake: document.getElementById('exam-retake-check').checked,
      proctorTabSwitch: document.getElementById('exam-proctor-tab-check').checked,
      blockCopyPaste: document.getElementById('exam-block-copy-check').checked,
      requireFullscreen: document.getElementById('exam-fullscreen-check').checked,
      questionIds: ids,
      savedAt: Date.now()
    };
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify(payload));
      lastDraftSavedAt = payload.savedAt;
      updateDraftPillText();
    } catch {}
  }

  function clearBuilderDraft() {
    try { localStorage.removeItem(DRAFT_KEY); } catch {}
    lastDraftSavedAt = null;
    updateDraftPillText();
  }

  function restoreBuilderDraft() {
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (!raw) return;
      const d = JSON.parse(raw);
      if (!d || (!d.title && (!d.questionIds || d.questionIds.length === 0))) return;
      const validIds = new Set(state.questions.map((q) => q.id));
      state.editingExamId = d.editingExamId || null;
      state.selectedQuestionIds = new Set((d.questionIds || []).filter((id) => validIds.has(id)));
      document.getElementById('exam-edit-id').value = d.editingExamId || '';
      document.getElementById('builder-mode-title').textContent = d.editingExamId
        ? `Editing Exam (Draft Restored): ${d.title || 'Untitled'}`
        : 'Create New Exam — Select MCQs for Students (Draft Restored)';
      document.getElementById('exam-title-input').value = d.title || '';
      document.getElementById('exam-desc-input').value = d.description || '';
      if (d.durationMinutes !== undefined) document.getElementById('exam-duration-input').value = d.durationMinutes;
      if (d.marksPerQuestion !== undefined) document.getElementById('exam-marks-input').value = d.marksPerQuestion;
      if (d.negativeMarking !== undefined) document.getElementById('exam-neg-input').value = d.negativeMarking;
      if (d.passPercentage !== undefined) document.getElementById('exam-pass-input').value = d.passPercentage;
      if (d.speedModeSeconds !== undefined) document.getElementById('exam-speed-input').value = d.speedModeSeconds;
      if (d.maxTabViolations !== undefined) document.getElementById('exam-max-violations-input').value = d.maxTabViolations;
      if (d.isLive !== undefined) document.getElementById('exam-live-check').checked = Boolean(d.isLive);
      if (d.shuffleQuestions !== undefined) document.getElementById('exam-shuffle-check').checked = Boolean(d.shuffleQuestions);
      if (d.showResultsImmediately !== undefined) document.getElementById('exam-show-results-check').checked = Boolean(d.showResultsImmediately);
      if (d.allowRetake !== undefined) document.getElementById('exam-retake-check').checked = Boolean(d.allowRetake);
      if (d.proctorTabSwitch !== undefined) document.getElementById('exam-proctor-tab-check').checked = Boolean(d.proctorTabSwitch);
      if (d.blockCopyPaste !== undefined) document.getElementById('exam-block-copy-check').checked = Boolean(d.blockCopyPaste);
      if (d.requireFullscreen !== undefined) document.getElementById('exam-fullscreen-check').checked = Boolean(d.requireFullscreen);
      lastDraftSavedAt = d.savedAt || Date.now();
      updateDraftPillText();
      renderBuilderQuestions();
      renderSelectedSummary();
    } catch {}
  }

  function updatePublishGuardrails() {
    const title = document.getElementById('exam-title-input').value.trim();
    const count = state.selectedQuestionIds.size;
    const marksPerQ = Number(document.getElementById('exam-marks-input').value) || 1;
    const totalMarks = (count * marksPerQ).toFixed(marksPerQ % 1 === 0 ? 0 : 1);

    const hintEl = document.getElementById('builder-validation-hint');
    const submitBtn = document.getElementById('save-exam-btn');
    const previewBtn = document.getElementById('preview-paper-btn');
    previewBtn.disabled = count === 0;

    const missing = [];
    if (!title) missing.push('Exam Title');
    if (count === 0) missing.push('at least 1 MCQ');

    if (missing.length > 0) {
      submitBtn.disabled = true;
      hintEl.style.background = 'var(--warning-soft)';
      hintEl.style.color = 'var(--warning)';
      hintEl.style.borderColor = 'var(--warning-border)';
      hintEl.textContent = `Required before publishing: add ${missing.join(' and ')}.`;
    } else {
      submitBtn.disabled = false;
      hintEl.style.background = 'var(--success-soft)';
      hintEl.style.color = 'var(--success)';
      hintEl.style.borderColor = 'var(--success-border)';
      hintEl.textContent = `✓ Ready to publish ${count} MCQ${count === 1 ? '' : 's'} (${totalMarks} Total Marks).`;
    }
  }

  function syncAutoPickLimits() {
    const filtered = getFilteredBuilderQuestions();
    const available = filtered.filter((q) => !state.selectedQuestionIds.has(q.id)).length;
    const countInput = document.getElementById('auto-pick-count');
    const pickBtn = document.getElementById('auto-pick-btn');
    const hint = document.getElementById('auto-pick-max-hint');

    countInput.max = String(Math.max(50, available));

    const rangeSlider = document.getElementById('range-slider');
    const maxSlider = Math.min(50, filtered.length);
    rangeSlider.max = String(maxSlider);
    const selectedInFilter = filtered.filter((q) => state.selectedQuestionIds.has(q.id)).length;
    const clampedSlider = Math.min(maxSlider, selectedInFilter);
    rangeSlider.value = String(clampedSlider);
    document.getElementById('range-slider-val').textContent = `${selectedInFilter} / ${Math.min(50, filtered.length)}`;

    if (filtered.length === 0) {
      hint.className = 'badge badge-neutral';
      hint.textContent = '0 matching';
      pickBtn.disabled = true;
    } else if (available === 0) {
      hint.className = 'badge badge-success';
      hint.textContent = `All ${filtered.length} selected`;
      pickBtn.disabled = true;
    } else {
      hint.className = 'badge badge-primary';
      hint.textContent = `Max ${available} available`;
      pickBtn.disabled = false;
    }
  }

  function getFilteredBuilderQuestions() {
    const subj = document.getElementById('builder-subj-filter').value;
    const diff = document.getElementById('builder-diff-filter').value;
    const search = document.getElementById('builder-search-filter').value.trim().toLowerCase();
    const selectedOnly = document.getElementById('builder-selected-only-check').checked;

    return state.questions.filter((q) => {
      if (selectedOnly && !state.selectedQuestionIds.has(q.id)) return false;
      if (subj !== 'all' && q.subjectId !== subj) return false;
      if (diff !== 'all' && q.difficulty !== diff) return false;
      if (search) {
        const match = q.question.toLowerCase().includes(search) ||
          (q.code && q.code.toLowerCase().includes(search)) ||
          q.options.some((o) => o.toLowerCase().includes(search));
        if (!match) return false;
      }
      return true;
    });
  }

  function renderBuilderQuestions() {
    const filtered = getFilteredBuilderQuestions();
    const subjMap = getSubjectMap();
    document.getElementById('builder-filter-count').textContent = `${filtered.length} shown`;
    syncAutoPickLimits();

    const listEl = document.getElementById('builder-mcq-list');
    if (filtered.length === 0) {
      const selectedOnly = document.getElementById('builder-selected-only-check').checked;
      listEl.innerHTML = `<div class="empty-state">${selectedOnly ? 'No selected MCQs match this filter. Uncheck "Selected Only" to view the full bank.' : 'No MCQs match this filter. Try clearing the search or adding a new MCQ.'}</div>`;
      return;
    }

    const letters = ['A', 'B', 'C', 'D'];
    listEl.innerHTML = filtered.map((q, idx) => {
      const isSelected = state.selectedQuestionIds.has(q.id);
      const subj = subjMap.get(q.subjectId);
      return `
        <label class="mcq-pick-item ${isSelected ? 'selected' : ''}" data-qid="${escapeHtml(q.id)}">
          <input type="checkbox" ${isSelected ? 'checked' : ''} data-qid="${escapeHtml(q.id)}" />
          <div style="flex:1;min-width:0;">
            <div class="flex-row" style="margin-bottom:6px;">
              <span class="badge badge-neutral">#${idx + 1}</span>
              ${renderSubjectBadge(subj || { name: q.subjectId })}
              ${renderDifficultyBadge(q.difficulty)}
              ${q.isAiGenerated ? '<span class="badge badge-primary">✨ AI</span>' : q.isCustom ? '<span class="badge badge-primary">Custom</span>' : ''}
            </div>
            <div style="font-weight:600;font-size:14.5px;">${formatInlineCodeHtml(q.question)}</div>
            ${q.code ? `<pre class="code-block" style="margin:8px 0;">${escapeHtml(q.code)}</pre>` : ''}
            <div class="mcq-options-mini">
              ${q.options.map((opt, idx) => `
                <div class="mcq-opt-chip ${idx === q.correctIndex ? 'correct' : ''}">
                  <strong>${letters[idx]}.</strong> ${formatInlineCodeHtml(opt)}
                </div>
              `).join('')}
            </div>
          </div>
        </label>
      `;
    }).join('');

    listEl.querySelectorAll('input[type="checkbox"]').forEach((cb) => {
      cb.addEventListener('change', () => {
        const qid = cb.dataset.qid;
        if (cb.checked) {
          state.selectedQuestionIds.add(qid);
        } else {
          state.selectedQuestionIds.delete(qid);
        }
        cb.closest('.mcq-pick-item').classList.toggle('selected', cb.checked);
        renderSelectedSummary();
        syncAutoPickLimits();
        saveBuilderDraft();
        if (document.getElementById('builder-selected-only-check').checked) {
          renderBuilderQuestions();
        }
      });
    });
  }

  function renderSelectedSummary() {
    const qMap = new Map(state.questions.map((q) => [q.id, q]));
    const subjMap = getSubjectMap();
    const selectedQuestions = [...state.selectedQuestionIds].map((id) => qMap.get(id)).filter(Boolean);

    const marksPerQ = Number(document.getElementById('exam-marks-input').value) || 1;
    const totalMarks = (selectedQuestions.length * marksPerQ).toFixed(marksPerQ % 1 === 0 ? 0 : 1);

    document.getElementById('selected-total-badge').textContent =
      `${selectedQuestions.length} MCQ${selectedQuestions.length === 1 ? '' : 's'} • ${totalMarks} Marks`;

    const counts = {};
    for (const q of selectedQuestions) {
      counts[q.subjectId] = (counts[q.subjectId] || 0) + 1;
    }

    document.getElementById('selected-subject-breakdown').innerHTML = Object.entries(counts)
      .map(([sid, count]) => {
        const s = subjMap.get(sid);
        return `<span class="badge" style="color:${escapeHtml(s?.color || '#4f46e5')};background:#fff;border-color:var(--border);">${escapeHtml(s?.name || sid)}: ${count}</span>`;
      }).join('');

    const miniEl = document.getElementById('selected-mini-list');
    if (selectedQuestions.length === 0) {
      miniEl.innerHTML = `<div class="text-xs text-muted">No MCQs selected yet. Tick checkboxes on the left or click "Pick Random MCQs".</div>`;
      updatePublishGuardrails();
      return;
    }

    miniEl.innerHTML = selectedQuestions.map((q, idx) => {
      const s = subjMap.get(q.subjectId);
      return `
        <div class="flex-between" style="background:#fff;padding:6px 9px;border-radius:8px;border:1px solid var(--border);font-size:12.5px;">
          <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:85%;">
            <strong>${idx + 1}. [${escapeHtml(s?.name || q.subjectId)}]</strong> ${escapeHtml(q.question)}
          </span>
          <button type="button" class="btn btn-ghost btn-sm remove-selected-btn" data-qid="${escapeHtml(q.id)}" style="padding:2px 6px;color:var(--danger);">✕</button>
        </div>
      `;
    }).join('');

    miniEl.querySelectorAll('.remove-selected-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.selectedQuestionIds.delete(btn.dataset.qid);
        renderBuilderQuestions();
        renderSelectedSummary();
        saveBuilderDraft();
      });
    });

    updatePublishGuardrails();
  }

  function resetBuilderForm() {
    state.editingExamId = null;
    state.selectedQuestionIds = new Set();
    document.getElementById('exam-edit-id').value = '';
    document.getElementById('builder-mode-title').textContent = 'Create New Exam — Select MCQs for Students';
    document.getElementById('exam-title-input').value = '';
    document.getElementById('exam-desc-input').value = '';
    document.getElementById('exam-duration-input').value = '15';
    document.getElementById('exam-marks-input').value = '1';
    document.getElementById('exam-neg-input').value = '0';
    document.getElementById('exam-pass-input').value = '40';
    document.getElementById('exam-speed-input').value = '0';
    document.getElementById('exam-max-violations-input').value = '1';
    document.getElementById('exam-live-check').checked = true;
    document.getElementById('exam-shuffle-check').checked = false;
    document.getElementById('exam-show-results-check').checked = true;
    document.getElementById('exam-retake-check').checked = true;
    document.getElementById('exam-proctor-tab-check').checked = true;
    document.getElementById('exam-block-copy-check').checked = true;
    document.getElementById('exam-fullscreen-check').checked = true;
    document.getElementById('builder-selected-only-check').checked = false;
    clearBuilderDraft();
    renderBuilderQuestions();
    renderSelectedSummary();
  }

  function loadExamIntoBuilder(exam) {
    state.editingExamId = exam.id;
    state.selectedQuestionIds = new Set(exam.questionIds || []);
    document.getElementById('exam-edit-id').value = exam.id;
    document.getElementById('builder-mode-title').textContent = `Editing Exam: ${exam.title}`;
    document.getElementById('exam-title-input').value = exam.title;
    document.getElementById('exam-desc-input').value = exam.description || '';
    document.getElementById('exam-duration-input').value = exam.durationMinutes;
    document.getElementById('exam-marks-input').value = exam.marksPerQuestion;
    document.getElementById('exam-neg-input').value = exam.negativeMarking || 0;
    document.getElementById('exam-pass-input').value = exam.passPercentage || 40;
    document.getElementById('exam-speed-input').value = exam.speedModeSeconds || 0;
    document.getElementById('exam-max-violations-input').value = exam.maxTabViolations ?? 1;
    document.getElementById('exam-live-check').checked = Boolean(exam.isLive);
    document.getElementById('exam-shuffle-check').checked = Boolean(exam.shuffleQuestions);
    document.getElementById('exam-show-results-check').checked = exam.showResultsImmediately !== false;
    document.getElementById('exam-retake-check').checked = exam.allowRetake !== false;
    document.getElementById('exam-proctor-tab-check').checked = exam.proctorTabSwitch !== false;
    document.getElementById('exam-block-copy-check').checked = exam.blockCopyPaste !== false;
    document.getElementById('exam-fullscreen-check').checked = exam.requireFullscreen !== false;
    document.getElementById('builder-selected-only-check').checked = false;
    renderBuilderQuestions();
    renderSelectedSummary();
    switchTab('builder');
  }

  document.getElementById('builder-subj-filter').addEventListener('change', renderBuilderQuestions);
  document.getElementById('builder-diff-filter').addEventListener('change', renderBuilderQuestions);
  document.getElementById('builder-search-filter').addEventListener('input', renderBuilderQuestions);
  document.getElementById('builder-selected-only-check').addEventListener('change', renderBuilderQuestions);
  document.getElementById('exam-marks-input').addEventListener('input', () => {
    renderSelectedSummary();
    saveBuilderDraft();
  });
  document.getElementById('exam-title-input').addEventListener('input', () => {
    updatePublishGuardrails();
    saveBuilderDraft();
  });
  [
    'exam-desc-input', 'exam-duration-input', 'exam-neg-input', 'exam-pass-input',
    'exam-speed-input', 'exam-max-violations-input', 'exam-live-check', 'exam-shuffle-check',
    'exam-show-results-check', 'exam-retake-check', 'exam-proctor-tab-check',
    'exam-block-copy-check', 'exam-fullscreen-check'
  ].forEach((id) => {
    const el = document.getElementById(id);
    el.addEventListener(el.type === 'checkbox' ? 'change' : 'input', saveBuilderDraft);
  });

  document.getElementById('builder-reset-btn').addEventListener('click', () => {
    resetBuilderForm();
    showToast('Ready for a new exam.', 'info');
  });

  document.getElementById('preview-paper-btn').addEventListener('click', () => {
    const qMap = new Map(state.questions.map((q) => [q.id, q]));
    const subjMap = getSubjectMap();
    const selectedQuestions = [...state.selectedQuestionIds].map((id) => qMap.get(id)).filter(Boolean);
    if (selectedQuestions.length === 0) return;

    const letters = ['A', 'B', 'C', 'D'];
    const title = document.getElementById('exam-title-input').value.trim() || 'Untitled Draft Exam';
    const marksPerQ = Number(document.getElementById('exam-marks-input').value) || 1;
    const totalMarks = (selectedQuestions.length * marksPerQ).toFixed(marksPerQ % 1 === 0 ? 0 : 1);

    openModal(`
      <div class="flex-between mb-2">
        <div>
          <h2 class="card-title">Preview Paper: ${escapeHtml(title)}</h2>
          <p class="card-subtitle">${selectedQuestions.length} MCQs • ${totalMarks} Total Marks • ⏱ ${escapeHtml(document.getElementById('exam-duration-input').value || '15')} mins</p>
        </div>
        <button type="button" class="btn btn-ghost btn-sm" id="modal-close-btn">✕</button>
      </div>
      <div class="stack-md">
        ${selectedQuestions.map((q, idx) => {
          const s = subjMap.get(q.subjectId);
          return `
            <div class="card card-compact">
              <div class="flex-between" style="margin-bottom:6px;">
                <div class="flex-row">
                  <span class="badge badge-neutral">Q${idx + 1}</span>
                  ${renderSubjectBadge(s || { name: q.subjectId })}
                  ${renderDifficultyBadge(q.difficulty)}
                </div>
                <button type="button" class="btn btn-soft-danger btn-sm preview-remove-btn" data-qid="${escapeHtml(q.id)}">Remove</button>
              </div>
              <div style="font-weight:600;margin-bottom:6px;">${formatInlineCodeHtml(q.question)}</div>
              ${q.code ? `<pre class="code-block">${escapeHtml(q.code)}</pre>` : ''}
              <div class="mcq-options-mini">
                ${q.options.map((opt, optIdx) => `
                  <div class="mcq-opt-chip ${optIdx === q.correctIndex ? 'correct' : ''}">
                    <strong>${letters[optIdx]}.</strong> ${formatInlineCodeHtml(opt)}
                  </div>
                `).join('')}
              </div>
            </div>
          `;
        }).join('')}
      </div>
    `);
    document.getElementById('modal-close-btn').addEventListener('click', closeModal);
    modalContent.querySelectorAll('.preview-remove-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.selectedQuestionIds.delete(btn.dataset.qid);
        renderBuilderQuestions();
        renderSelectedSummary();
        saveBuilderDraft();
        if (state.selectedQuestionIds.size === 0) {
          closeModal();
        } else {
          document.getElementById('preview-paper-btn').click();
        }
      });
    });
  });

  document.getElementById('auto-pick-count').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const btn = document.getElementById('auto-pick-btn');
      if (!btn.disabled) btn.click();
    }
  });

  document.getElementById('auto-pick-btn').addEventListener('click', () => {
    const requested = Math.max(0, Number(document.getElementById('auto-pick-count').value) || 0);
    if (requested === 0) {
      selectMcqRange(0, 0);
      return;
    }
    const filtered = getFilteredBuilderQuestions().filter((q) => !state.selectedQuestionIds.has(q.id));
    if (filtered.length === 0) {
      showToast('All matching questions are already selected!', 'info');
      return;
    }
    const pool = [...filtered];
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    const picked = pool.slice(0, Math.min(requested, pool.length));
    picked.forEach((q) => state.selectedQuestionIds.add(q.id));
    renderBuilderQuestions();
    renderSelectedSummary();
    saveBuilderDraft();
    const note = picked.length < requested
      ? ` (all ${picked.length} available in current filter)`
      : '';
    showToast(`Auto-selected ${picked.length} random MCQ${picked.length === 1 ? '' : 's'}${note}!`, 'success');
  });

  function selectMcqRange(fromNum, toNum, silent = false) {
    // Temporarily uncheck Selected Only so the full current subject/difficulty list is sliced
    const selOnlyEl = document.getElementById('builder-selected-only-check');
    if (selOnlyEl.checked) selOnlyEl.checked = false;

    const filtered = getFilteredBuilderQuestions();
    if (filtered.length === 0) {
      showToast('No questions match the current filter.', 'info');
      return 0;
    }

    const from = Math.max(0, Number(fromNum) || 0);
    const to = Math.max(0, Number(toNum) || 0);

    // Clear only items belonging to the currently filtered view (preserving other subjects)
    for (const q of filtered) {
      state.selectedQuestionIds.delete(q.id);
    }

    let chosen = [];
    if (to > 0 && to >= from) {
      const startIdx = Math.max(1, from) - 1;
      const endIdx = Math.min(filtered.length, to);
      if (startIdx < endIdx) {
        chosen = filtered.slice(startIdx, endIdx);
        for (const q of chosen) {
          state.selectedQuestionIds.add(q.id);
        }
      }
    }

    renderBuilderQuestions();
    renderSelectedSummary();
    saveBuilderDraft();

    if (!silent) {
      if (chosen.length === 0) {
        showToast('Cleared MCQs in current filter (0 selected).', 'info');
      } else {
        const displayStart = Math.max(1, from);
        const displayEnd = displayStart + chosen.length - 1;
        showToast(`Selected ${chosen.length} MCQs (#${displayStart} to #${displayEnd})!`, 'success');
      }
    }
    return chosen.length;
  }

  document.getElementById('apply-range-btn').addEventListener('click', () => {
    const fromVal = Number(document.getElementById('range-from-input').value) || 0;
    const toVal = Number(document.getElementById('range-to-input').value) || 0;
    selectMcqRange(fromVal, toVal);
  });

  ['range-from-input', 'range-to-input'].forEach((id) => {
    document.getElementById(id).addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        document.getElementById('apply-range-btn').click();
      }
    });
  });

  document.getElementById('range-slider').addEventListener('input', (e) => {
    const val = Math.max(0, Number(e.target.value) || 0);
    document.getElementById('range-from-input').value = val === 0 ? '0' : '1';
    document.getElementById('range-to-input').value = String(val);
    selectMcqRange(val === 0 ? 0 : 1, val, true);
  });

  document.querySelectorAll('.range-preset-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const val = Number(btn.dataset.val) || 0;
      document.getElementById('range-from-input').value = val === 0 ? '0' : '1';
      document.getElementById('range-to-input').value = String(val);
      selectMcqRange(val === 0 ? 0 : 1, val);
    });
  });

  document.getElementById('select-all-filtered-btn').addEventListener('click', () => {
    const filtered = getFilteredBuilderQuestions();
    filtered.forEach((q) => state.selectedQuestionIds.add(q.id));
    renderBuilderQuestions();
    renderSelectedSummary();
    saveBuilderDraft();
    showToast(`Selected ${filtered.length} matching MCQs.`, 'success');
  });

  document.getElementById('clear-selected-btn').addEventListener('click', () => {
    state.selectedQuestionIds.clear();
    document.getElementById('builder-selected-only-check').checked = false;
    renderBuilderQuestions();
    renderSelectedSummary();
    saveBuilderDraft();
  });

  document.getElementById('builder-quick-add-mcq-btn').addEventListener('click', () => {
    openQuestionModal(null, true);
  });

  function openAiGeneratorModal(autoSelectInBuilder = false) {
    const ai = state.settings?.ai || {};
    if (!ai.hasApiKey) {
      showToast('Please save your AI API Key in Settings first.', 'error');
      switchTab('settings');
      return;
    }

    const currentFilterSubj = document.getElementById('builder-subj-filter')?.value;
    const defaultSubj = currentFilterSubj && currentFilterSubj !== 'all' ? currentFilterSubj : 'mixed';
    const subjOpts = `<option value="mixed" ${defaultSubj === 'mixed' ? 'selected' : ''}>Mixed (All Subjects)</option>` +
      state.subjects.map((s) =>
        `<option value="${escapeHtml(s.id)}" ${s.id === defaultSubj ? 'selected' : ''}>${escapeHtml(s.name)}</option>`
      ).join('');

    openModal(`
      <div class="flex-between mb-2">
        <h2 class="card-title">✨ AI Generate MCQs</h2>
        <button type="button" class="btn btn-ghost btn-sm" id="modal-close-btn">✕</button>
      </div>
      <p class="text-sm text-muted" style="margin-top:0;">
        Automatically generate verified programming MCQs using <strong>${escapeHtml(ai.model || 'deepseek-v4.1-flash')}</strong> and add them directly to your bank.
      </p>
      <form id="ai-gen-modal-form" class="stack-md">
        <div class="form-grid" style="grid-template-columns:1fr 1fr;">
          <div class="form-group">
            <label for="ai-gen-subj">Subject</label>
            <select id="ai-gen-subj" class="select">${subjOpts}</select>
          </div>
          <div class="form-group">
            <label for="ai-gen-diff">Difficulty</label>
            <select id="ai-gen-diff" class="select">
              <option value="Mixed" selected>Mixed (Easy / Med / Hard)</option>
              <option value="Easy">Easy</option>
              <option value="Medium">Medium</option>
              <option value="Hard">Hard</option>
            </select>
          </div>
          <div class="form-group">
            <label for="ai-gen-count">Number of MCQs (1–50)</label>
            <input id="ai-gen-count" type="number" min="1" max="50" value="10" class="input" required />
          </div>
          <div class="form-group">
            <label for="ai-gen-model">Model</label>
            <input id="ai-gen-model" type="text" list="ai-model-options" class="input" value="${escapeHtml(ai.model || 'deepseek-v4.1-flash')}" />
          </div>
        </div>
        <div class="form-group">
          <label for="ai-gen-topic">Specific Topic (Optional)</label>
          <input id="ai-gen-topic" type="text" class="input" placeholder="e.g. Flexbox & Grid, Async/Await, Python OOP, SQL Joins..." />
        </div>
        <label class="checkbox-row" style="background:var(--surface-muted);padding:10px 12px;border-radius:10px;">
          <input type="checkbox" id="ai-gen-autoselect" ${autoSelectInBuilder ? 'checked' : ''} />
          <span>Automatically select generated MCQs into the current Exam Builder</span>
        </label>
        <div id="ai-gen-status" class="text-sm hidden" style="color:var(--primary);font-weight:600;"></div>
        <div class="flex-row" style="justify-content:flex-end;">
          <button type="button" class="btn btn-secondary" id="modal-cancel-btn">Cancel</button>
          <button type="submit" class="btn btn-primary" id="ai-gen-submit-btn">✨ Generate MCQs</button>
        </div>
      </form>
    `);

    document.getElementById('modal-close-btn').addEventListener('click', closeModal);
    document.getElementById('modal-cancel-btn').addEventListener('click', closeModal);

    document.getElementById('ai-gen-modal-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const submitBtn = document.getElementById('ai-gen-submit-btn');
      const statusEl = document.getElementById('ai-gen-status');
      const countVal = Math.max(1, Math.min(50, Number(document.getElementById('ai-gen-count').value) || 10));

      submitBtn.disabled = true;
      submitBtn.textContent = `Generating ${countVal} MCQs...`;
      statusEl.classList.remove('hidden');
      statusEl.textContent = '⏳ Calling AI model and validating 4-option MCQs...';

      try {
        const res = await apiFetch('/api/teacher/ai/generate', {
          method: 'POST',
          auth: true,
          body: {
            subjectId: document.getElementById('ai-gen-subj').value,
            difficulty: document.getElementById('ai-gen-diff').value,
            count: countVal,
            model: document.getElementById('ai-gen-model').value.trim(),
            topic: document.getElementById('ai-gen-topic').value.trim()
          }
        });

        const autoSelect = document.getElementById('ai-gen-autoselect').checked;
        if (autoSelect && Array.isArray(res.added)) {
          for (const q of res.added) {
            state.selectedQuestionIds.add(q.id);
          }
          saveBuilderDraft();
        }
        closeModal();
        await loadBootstrap();
        showToast(
          autoSelect
            ? `✨ Generated ${res.addedCount} AI MCQs and selected them into your exam!`
            : `✨ Generated & saved ${res.addedCount} AI MCQs to Question Bank!`,
          'success'
        );
      } catch (err) {
        statusEl.style.color = 'var(--danger)';
        statusEl.textContent = `✕ ${err.message}`;
        submitBtn.disabled = false;
        submitBtn.textContent = '✨ Generate MCQs';
      }
    });
  }

  document.getElementById('builder-ai-gen-btn').addEventListener('click', () => openAiGeneratorModal(true));
  document.getElementById('open-ai-gen-btn').addEventListener('click', () => openAiGeneratorModal(false));

  document.getElementById('direct-ai-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const ai = state.settings?.ai || {};
    if (!ai.hasApiKey) {
      showToast('Please save your AI API Key in Settings first.', 'error');
      switchTab('settings');
      return;
    }

    const subjId = document.getElementById('direct-ai-subj').value;
    const diff = document.getElementById('direct-ai-diff').value;
    const countVal = Math.max(1, Math.min(50, Number(document.getElementById('direct-ai-count').value) || 10));
    const topic = document.getElementById('direct-ai-topic').value.trim();
    const replaceMode = document.getElementById('direct-ai-replace-check').checked;

    const btn = document.getElementById('direct-ai-generate-btn');
    const statusEl = document.getElementById('direct-ai-status');
    btn.disabled = true;
    btn.textContent = `⏳ Generating ${countVal}...`;
    statusEl.classList.remove('hidden');
    statusEl.style.color = 'var(--primary)';
    statusEl.textContent = `Calling ${ai.model || 'AI'} for ${countVal} fresh MCQ${countVal === 1 ? '' : 's'}...`;

    try {
      const res = await apiFetch('/api/teacher/ai/generate', {
        method: 'POST',
        auth: true,
        body: {
          subjectId: subjId,
          difficulty: diff,
          count: countVal,
          topic
        }
      });

      if (replaceMode) {
        state.selectedQuestionIds.clear();
      }
      for (const q of (res.added || [])) {
        state.selectedQuestionIds.add(q.id);
      }

      const titleInput = document.getElementById('exam-title-input');
      if (!titleInput.value.trim()) {
        const subjLabel = subjId === 'mixed'
          ? 'Mixed Programming'
          : (state.subjects.find((s) => s.id === subjId)?.name || subjId);
        const topicSuffix = topic ? ` (${topic})` : '';
        titleInput.value = `AI ${subjLabel}${topicSuffix} Exam`;
      }

      document.getElementById('builder-subj-filter').value = 'all';
      document.getElementById('builder-diff-filter').value = 'all';
      document.getElementById('builder-search-filter').value = '';
      if (replaceMode) {
        document.getElementById('builder-selected-only-check').checked = true;
      }

      await loadBootstrap();
      saveBuilderDraft();
      statusEl.style.color = 'var(--success)';
      statusEl.textContent = `✓ ${res.addedCount} fresh AI MCQs ready! Click "Save & Push to Student Portal".`;
      showToast(`✨ Generated ${res.addedCount} fresh AI MCQs directly into your exam!`, 'success');
    } catch (err) {
      statusEl.style.color = 'var(--danger)';
      statusEl.textContent = `✕ ${err.message}`;
      showToast(err.message, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = '✨ Generate AI Questions';
    }
  });

  document.getElementById('exam-builder-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const questionIds = [...state.selectedQuestionIds];
    if (questionIds.length === 0) {
      showToast('Please select at least 1 MCQ first!', 'error');
      return;
    }

    const payload = {
      id: document.getElementById('exam-edit-id').value || undefined,
      title: document.getElementById('exam-title-input').value.trim(),
      description: document.getElementById('exam-desc-input').value.trim(),
      durationMinutes: Number(document.getElementById('exam-duration-input').value) || 15,
      marksPerQuestion: Number(document.getElementById('exam-marks-input').value) || 1,
      negativeMarking: Number(document.getElementById('exam-neg-input').value) || 0,
      passPercentage: Number(document.getElementById('exam-pass-input').value) || 40,
      speedModeSeconds: Math.max(0, Number(document.getElementById('exam-speed-input').value) || 0),
      maxTabViolations: Math.max(0, Number(document.getElementById('exam-max-violations-input').value) || 0),
      isLive: document.getElementById('exam-live-check').checked,
      shuffleQuestions: document.getElementById('exam-shuffle-check').checked,
      showResultsImmediately: document.getElementById('exam-show-results-check').checked,
      allowRetake: document.getElementById('exam-retake-check').checked,
      proctorTabSwitch: document.getElementById('exam-proctor-tab-check').checked,
      blockCopyPaste: document.getElementById('exam-block-copy-check').checked,
      requireFullscreen: document.getElementById('exam-fullscreen-check').checked,
      questionIds
    };

    try {
      const res = await apiFetch('/api/teacher/exams', {
        method: 'POST',
        auth: true,
        body: payload
      });
      showToast(
        res.exam.isLive
          ? 'Exam saved & pushed LIVE to Student Portal!'
          : 'Exam saved as Draft!',
        'success'
      );
      resetBuilderForm();
      await loadBootstrap();
      switchTab('overview');
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  // ---------- TAB 3: QUESTION BANK & SUBJECTS ----------
  function renderBank() {
    const subjGrid = document.getElementById('subjects-overview-grid');
    subjGrid.innerHTML = state.subjects.map((s) => `
      <div class="badge" style="padding:8px 14px;font-size:13px;color:${escapeHtml(s.color)};background:${escapeHtml(s.bgColor)};border-color:${escapeHtml(s.color)}44;">
        <strong>${escapeHtml(s.name)}</strong>
        <span style="opacity:0.85;">(${s.questionCount ?? 0} MCQs)</span>
      </div>
    `).join('');

    const subjFilter = document.getElementById('bank-subj-filter').value;
    const diffFilter = document.getElementById('bank-diff-filter').value;
    const search = document.getElementById('bank-search-filter').value.trim().toLowerCase();

    const filtered = state.questions.filter((q) => {
      if (subjFilter !== 'all' && q.subjectId !== subjFilter) return false;
      if (diffFilter !== 'all' && q.difficulty !== diffFilter) return false;
      if (search) {
        const match = q.question.toLowerCase().includes(search) ||
          (q.code && q.code.toLowerCase().includes(search)) ||
          q.options.some((o) => o.toLowerCase().includes(search));
        if (!match) return false;
      }
      return true;
    });

    const subjMap = getSubjectMap();
    const letters = ['A', 'B', 'C', 'D'];
    const listEl = document.getElementById('bank-list-container');

    if (filtered.length === 0) {
      listEl.innerHTML = `<div class="empty-state">No MCQs found for the selected filters.</div>`;
      return;
    }

    listEl.innerHTML = filtered.map((q) => {
      const s = subjMap.get(q.subjectId);
      return `
        <div class="card card-compact">
          <div class="flex-between" style="margin-bottom:8px;">
            <div class="flex-row">
              ${renderSubjectBadge(s || { name: q.subjectId })}
              ${renderDifficultyBadge(q.difficulty)}
              ${q.isCustom ? '<span class="badge badge-primary">Custom MCQ</span>' : '<span class="badge badge-neutral">Built-in</span>'}
            </div>
            <div class="flex-row">
              <button type="button" class="btn btn-secondary btn-sm bank-edit-btn" data-qid="${escapeHtml(q.id)}">Edit</button>
              <button type="button" class="btn btn-soft-danger btn-sm bank-del-btn" data-qid="${escapeHtml(q.id)}">Delete</button>
            </div>
          </div>
          <div style="font-weight:600;font-size:15px;">${formatInlineCodeHtml(q.question)}</div>
          ${q.code ? `<pre class="code-block">${escapeHtml(q.code)}</pre>` : ''}
          <div class="mcq-options-mini">
            ${q.options.map((opt, idx) => `
              <div class="mcq-opt-chip ${idx === q.correctIndex ? 'correct' : ''}">
                <strong>${letters[idx]}.</strong> ${formatInlineCodeHtml(opt)}
              </div>
            `).join('')}
          </div>
          ${q.explanation ? `<div class="text-xs text-muted mt-1">💡 ${escapeHtml(q.explanation)}</div>` : ''}
        </div>
      `;
    }).join('');

    listEl.querySelectorAll('.bank-edit-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const q = state.questions.find((item) => item.id === btn.dataset.qid);
        if (q) openQuestionModal(q, false);
      });
    });

    listEl.querySelectorAll('.bank-del-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (!confirm('Delete this MCQ from the question bank?')) return;
        try {
          await apiFetch(`/api/teacher/questions/${encodeURIComponent(btn.dataset.qid)}`, {
            method: 'DELETE',
            auth: true
          });
          state.selectedQuestionIds.delete(btn.dataset.qid);
          showToast('MCQ deleted.', 'info');
          await loadBootstrap();
        } catch (err) {
          showToast(err.message, 'error');
        }
      });
    });
  }

  document.getElementById('bank-subj-filter').addEventListener('change', renderBank);
  document.getElementById('bank-diff-filter').addEventListener('change', renderBank);
  document.getElementById('bank-search-filter').addEventListener('input', renderBank);

  // Add / Edit MCQ Modal
  function openQuestionModal(existing = null, autoSelectInBuilder = false) {
    const subjOpts = state.subjects.map((s) =>
      `<option value="${escapeHtml(s.id)}" ${existing?.subjectId === s.id ? 'selected' : ''}>${escapeHtml(s.name)}</option>`
    ).join('');

    openModal(`
      <div class="flex-between mb-2">
        <h2 class="card-title">${existing ? 'Edit MCQ' : 'Add New MCQ'}</h2>
        <button type="button" class="btn btn-ghost btn-sm" id="modal-close-btn">✕</button>
      </div>
      <form id="mcq-modal-form" class="stack-md">
        <div class="form-grid">
          <div class="form-group">
            <label for="m-subj">Subject</label>
            <select id="m-subj" class="select">${subjOpts}</select>
          </div>
          <div class="form-group">
            <label for="m-diff">Difficulty</label>
            <select id="m-diff" class="select">
              <option value="Easy" ${existing?.difficulty === 'Easy' ? 'selected' : ''}>Easy</option>
              <option value="Medium" ${!existing || existing.difficulty === 'Medium' ? 'selected' : ''}>Medium</option>
              <option value="Hard" ${existing?.difficulty === 'Hard' ? 'selected' : ''}>Hard</option>
            </select>
          </div>
        </div>
        <div class="form-group">
          <label for="m-question">Question *</label>
          <textarea id="m-question" class="textarea" required placeholder="Type your question...">${escapeHtml(existing?.question || '')}</textarea>
        </div>
        <div class="form-group">
          <label for="m-code">Code Snippet (Optional)</label>
          <textarea id="m-code" class="textarea code-textarea" placeholder="Optional HTML/CSS/JS/Python code...">${escapeHtml(existing?.code || '')}</textarea>
        </div>
        <div class="form-grid" style="grid-template-columns:1fr 1fr;">
          <div class="form-group">
            <label for="m-opt0">Option A *</label>
            <input id="m-opt0" type="text" class="input" required value="${escapeHtml(existing?.options?.[0] || '')}" />
          </div>
          <div class="form-group">
            <label for="m-opt1">Option B *</label>
            <input id="m-opt1" type="text" class="input" required value="${escapeHtml(existing?.options?.[1] || '')}" />
          </div>
          <div class="form-group">
            <label for="m-opt2">Option C *</label>
            <input id="m-opt2" type="text" class="input" required value="${escapeHtml(existing?.options?.[2] || '')}" />
          </div>
          <div class="form-group">
            <label for="m-opt3">Option D *</label>
            <input id="m-opt3" type="text" class="input" required value="${escapeHtml(existing?.options?.[3] || '')}" />
          </div>
        </div>
        <div class="form-grid">
          <div class="form-group">
            <label for="m-correct">Correct Answer</label>
            <select id="m-correct" class="select">
              <option value="0" ${existing?.correctIndex === 0 ? 'selected' : ''}>Option A</option>
              <option value="1" ${existing?.correctIndex === 1 ? 'selected' : ''}>Option B</option>
              <option value="2" ${existing?.correctIndex === 2 ? 'selected' : ''}>Option C</option>
              <option value="3" ${existing?.correctIndex === 3 ? 'selected' : ''}>Option D</option>
            </select>
          </div>
          <div class="form-group">
            <label for="m-expl">Explanation (shown after exam)</label>
            <input id="m-expl" type="text" class="input" value="${escapeHtml(existing?.explanation || '')}" placeholder="Why is this option correct?" />
          </div>
        </div>
        <div class="flex-row" style="justify-content:flex-end;">
          <button type="button" class="btn btn-secondary" id="modal-cancel-btn">Cancel</button>
          <button type="submit" class="btn btn-primary">${existing ? 'Update MCQ' : 'Save MCQ'}</button>
        </div>
      </form>
    `);

    document.getElementById('modal-close-btn').addEventListener('click', closeModal);
    document.getElementById('modal-cancel-btn').addEventListener('click', closeModal);

    document.getElementById('mcq-modal-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const payload = {
        subjectId: document.getElementById('m-subj').value,
        difficulty: document.getElementById('m-diff').value,
        question: document.getElementById('m-question').value.trim(),
        code: document.getElementById('m-code').value.trim(),
        options: [
          document.getElementById('m-opt0').value.trim(),
          document.getElementById('m-opt1').value.trim(),
          document.getElementById('m-opt2').value.trim(),
          document.getElementById('m-opt3').value.trim()
        ],
        correctIndex: Number(document.getElementById('m-correct').value),
        explanation: document.getElementById('m-expl').value.trim()
      };

      try {
        if (existing) {
          await apiFetch(`/api/teacher/questions/${encodeURIComponent(existing.id)}`, {
            method: 'PUT',
            auth: true,
            body: payload
          });
          showToast('MCQ updated!', 'success');
        } else {
          const res = await apiFetch('/api/teacher/questions', {
            method: 'POST',
            auth: true,
            body: payload
          });
          if (autoSelectInBuilder && res.question?.id) {
            state.selectedQuestionIds.add(res.question.id);
          }
          showToast(autoSelectInBuilder ? 'Custom MCQ added & selected!' : 'Custom MCQ added to bank!', 'success');
        }
        closeModal();
        await loadBootstrap();
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
  }

  document.getElementById('open-add-mcq-btn').addEventListener('click', () => openQuestionModal(null, false));

  // Add Subject Modal
  document.getElementById('open-add-subject-btn').addEventListener('click', () => {
    openModal(`
      <div class="flex-between mb-2">
        <h2 class="card-title">Add New Programming Subject</h2>
        <button type="button" class="btn btn-ghost btn-sm" id="modal-close-btn">✕</button>
      </div>
      <form id="subj-modal-form" class="stack-md">
        <div class="form-group">
          <label for="s-name">Subject Name *</label>
          <input id="s-name" type="text" class="input" required placeholder="e.g. C++, SQL, Java, React" />
        </div>
        <div class="form-group">
          <label for="s-full">Full Description (optional)</label>
          <input id="s-full" type="text" class="input" placeholder="e.g. SQL & Relational Databases" />
        </div>
        <div class="form-group">
          <label for="s-color">Badge Color</label>
          <input id="s-color" type="color" class="input" value="#7c3aed" style="height:44px;padding:4px;" />
        </div>
        <div class="flex-row" style="justify-content:flex-end;">
          <button type="button" class="btn btn-secondary" id="modal-cancel-btn">Cancel</button>
          <button type="submit" class="btn btn-primary">Add Subject</button>
        </div>
      </form>
    `);
    document.getElementById('modal-close-btn').addEventListener('click', closeModal);
    document.getElementById('modal-cancel-btn').addEventListener('click', closeModal);
    document.getElementById('subj-modal-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await apiFetch('/api/teacher/subjects', {
          method: 'POST',
          auth: true,
          body: {
            name: document.getElementById('s-name').value.trim(),
            fullName: document.getElementById('s-full').value.trim(),
            color: document.getElementById('s-color').value
          }
        });
        showToast('New subject added!', 'success');
        closeModal();
        await loadBootstrap();
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
  });

  // Bulk Import Modal (supports simple Q/A/B/C/D/ANS format OR JSON array)
  function parseSimpleBulkText(rawText, defaultSubj, defaultDiff) {
    const trimmed = rawText.trim();
    if (trimmed.startsWith('[')) {
      const parsed = JSON.parse(trimmed);
      return parsed.map((item) => ({
        subjectId: item.subjectId || defaultSubj,
        difficulty: item.difficulty || defaultDiff,
        question: item.question,
        code: item.code || '',
        options: item.options,
        correctIndex: Number(item.correctIndex),
        explanation: item.explanation || ''
      }));
    }

    const blocks = trimmed.split(/\n\s*\n+/);
    const results = [];
    for (const block of blocks) {
      const lines = block.split('\n').map((l) => l.trim()).filter(Boolean);
      let question = '';
      const opts = ['', '', '', ''];
      let correctIndex = -1;
      let explanation = '';

      for (const line of lines) {
        if (/^Q[:.)\s]/i.test(line)) {
          question = line.replace(/^Q[:.)\s]+/i, '').trim();
        } else if (/^A[:.)\s]/i.test(line)) {
          opts[0] = line.replace(/^A[:.)\s]+/i, '').trim();
        } else if (/^B[:.)\s]/i.test(line)) {
          opts[1] = line.replace(/^B[:.)\s]+/i, '').trim();
        } else if (/^C[:.)\s]/i.test(line)) {
          opts[2] = line.replace(/^C[:.)\s]+/i, '').trim();
        } else if (/^D[:.)\s]/i.test(line)) {
          opts[3] = line.replace(/^D[:.)\s]+/i, '').trim();
        } else if (/^ANS(WER)?[:.)\s]/i.test(line)) {
          const val = line.replace(/^ANS(WER)?[:.)\s]+/i, '').trim().toUpperCase();
          correctIndex = ['A', 'B', 'C', 'D'].indexOf(val[0]);
        } else if (/^EXP(LANATION)?[:.)\s]/i.test(line)) {
          explanation = line.replace(/^EXP(LANATION)?[:.)\s]+/i, '').trim();
        }
      }

      if (question && opts.every(Boolean) && correctIndex >= 0) {
        results.push({
          subjectId: defaultSubj,
          difficulty: defaultDiff,
          question,
          code: '',
          options: opts,
          correctIndex,
          explanation
        });
      }
    }
    return results;
  }

  document.getElementById('open-bulk-import-btn').addEventListener('click', () => {
    const subjOpts = state.subjects.map((s) =>
      `<option value="${escapeHtml(s.id)}">${escapeHtml(s.name)}</option>`
    ).join('');

    openModal(`
      <div class="flex-between mb-2">
        <h2 class="card-title">Bulk Import MCQs</h2>
        <button type="button" class="btn btn-ghost btn-sm" id="modal-close-btn">✕</button>
      </div>
      <p class="text-sm text-muted" style="margin-top:0;">
        Paste multiple MCQs separated by a blank line using <code>Q: / A: / B: / C: / D: / ANS:</code> format (or a JSON array).
      </p>
      <form id="bulk-modal-form" class="stack-md">
        <div class="form-grid">
          <div class="form-group">
            <label for="b-subj">Default Subject</label>
            <select id="b-subj" class="select">${subjOpts}</select>
          </div>
          <div class="form-group">
            <label for="b-diff">Default Difficulty</label>
            <select id="b-diff" class="select">
              <option value="Easy">Easy</option>
              <option value="Medium" selected>Medium</option>
              <option value="Hard">Hard</option>
            </select>
          </div>
        </div>
        <div class="form-group">
          <label for="b-text">MCQs Input</label>
          <textarea id="b-text" class="textarea code-textarea" style="min-height:200px;" placeholder="Q: Which tag creates a hyperlink in HTML?
A: <link>
B: <a>
C: <href>
D: <url>
ANS: B
EXP: The <a> anchor tag creates hyperlinks."></textarea>
        </div>
        <div class="flex-row" style="justify-content:flex-end;">
          <button type="button" class="btn btn-secondary" id="modal-cancel-btn">Cancel</button>
          <button type="submit" class="btn btn-primary">Import MCQs</button>
        </div>
      </form>
    `);
    document.getElementById('modal-close-btn').addEventListener('click', closeModal);
    document.getElementById('modal-cancel-btn').addEventListener('click', closeModal);
    document.getElementById('bulk-modal-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        const parsed = parseSimpleBulkText(
          document.getElementById('b-text').value,
          document.getElementById('b-subj').value,
          document.getElementById('b-diff').value
        );
        if (parsed.length === 0) {
          showToast('No valid MCQs parsed. Check Q:/A:/B:/C:/D:/ANS: format.', 'error');
          return;
        }
        const res = await apiFetch('/api/teacher/questions/bulk', {
          method: 'POST',
          auth: true,
          body: { questions: parsed }
        });
        showToast(`Imported ${res.addedCount} MCQs successfully!`, 'success');
        closeModal();
        await loadBootstrap();
      } catch (err) {
        showToast(err.message || 'Failed to parse bulk MCQs.', 'error');
      }
    });
  });

  // ---------- TAB 4: RESULTS ----------
  function getFilteredSubmissions() {
    const examId = document.getElementById('results-exam-filter').value;
    const search = document.getElementById('results-search-input').value.trim().toLowerCase();

    return state.submissions.filter((s) => {
      if (examId !== 'all' && s.examId !== examId) return false;
      if (search) {
        const match = s.studentName.toLowerCase().includes(search) ||
          s.rollNumber.toLowerCase().includes(search) ||
          (s.batch && s.batch.toLowerCase().includes(search));
        if (!match) return false;
      }
      return true;
    });
  }

  function renderResults() {
    const rows = getFilteredSubmissions();
    const tbody = document.getElementById('results-table-body');
    if (rows.length === 0) {
      tbody.innerHTML = `<tr><td colspan="13" style="text-align:center;padding:28px;color:var(--text-muted);">No student submissions yet.</td></tr>`;
      return;
    }

    function renderProctorBadge(proctoring) {
      const v = Number(proctoring?.violationsCount) || 0;
      const autoLimit = proctoring?.autoSubmittedReason === 'proctor-limit';
      if (v === 0) {
        return `<span class="badge badge-success">✓ Clean</span>`;
      }
      if (autoLimit) {
        return `<span class="badge badge-danger" title="Auto-submitted on violation limit">🚨 ${v} Flags</span>`;
      }
      return `<span class="badge badge-warning">⚠️ ${v} Flag${v === 1 ? '' : 's'}</span>`;
    }

    function renderEmailBadge(delivery) {
      const st = delivery?.status || 'disabled';
      if (st === 'sent') {
        return `<span class="badge badge-success" title="Sent to: ${escapeHtml((delivery.recipients || []).join(', '))}">✓ Sent</span>`;
      }
      if (st === 'failed') {
        return `<span class="badge badge-danger" title="${escapeHtml(delivery.error || 'Email failed')}">✕ Failed</span>`;
      }
      return `<span class="badge badge-neutral">– Off</span>`;
    }

    tbody.innerHTML = rows.map((s, idx) => `
      <tr>
        <td><strong>${idx + 1}</strong></td>
        <td>
          <strong>${escapeHtml(s.studentName)}</strong>
          ${s.batch ? `<div class="text-xs text-muted">${escapeHtml(s.batch)}</div>` : ''}
          ${s.studentEmail ? `<div class="text-xs text-muted">${escapeHtml(s.studentEmail)}</div>` : ''}
        </td>
        <td><span class="font-mono">${escapeHtml(s.rollNumber)}</span></td>
        <td>${escapeHtml(s.examTitle)}</td>
        <td><strong>${s.score} / ${s.totalMarks}</strong></td>
        <td><strong>${s.percentage}%</strong></td>
        <td>${s.passed ? '<span class="badge badge-success">PASS</span>' : '<span class="badge badge-danger">FAIL</span>'}</td>
        <td>
          <span style="color:var(--success);font-weight:600;">✓${s.correctCount}</span> /
          <span style="color:var(--danger);font-weight:600;">✕${s.wrongCount}</span> /
          <span class="text-muted">–${s.skippedCount}</span>
        </td>
        <td>${renderProctorBadge(s.proctoring)}</td>
        <td>${renderEmailBadge(s.emailDelivery)}</td>
        <td class="font-mono text-xs">${formatDuration(s.timeTakenSeconds)}</td>
        <td class="text-xs text-muted">${escapeHtml(formatDateTime(s.submittedAt))}</td>
        <td>
          <div class="flex-row">
            <button type="button" class="btn btn-secondary btn-sm view-sub-btn" data-id="${escapeHtml(s.id)}">View Paper</button>
            <button type="button" class="btn btn-soft-primary btn-sm send-sub-email-btn" data-id="${escapeHtml(s.id)}" title="Send/Resend Result Email">📧</button>
            <button type="button" class="btn btn-soft-danger btn-sm del-sub-btn" data-id="${escapeHtml(s.id)}">✕</button>
          </div>
        </td>
      </tr>
    `).join('');

    tbody.querySelectorAll('.view-sub-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const sub = state.submissions.find((item) => item.id === btn.dataset.id);
        if (sub) openSubmissionModal(sub);
      });
    });

    tbody.querySelectorAll('.send-sub-email-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        try {
          const res = await apiFetch(`/api/teacher/submissions/${encodeURIComponent(btn.dataset.id)}/email`, {
            method: 'POST',
            auth: true,
            body: {}
          });
          showToast(`Email sent to ${(res.emailDelivery.recipients || []).join(', ')}`, 'success');
          await loadBootstrap();
        } catch (err) {
          showToast(err.message, 'error');
          await loadBootstrap();
        } finally {
          btn.disabled = false;
        }
      });
    });

    tbody.querySelectorAll('.del-sub-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (!confirm('Delete this student submission?')) return;
        try {
          await apiFetch(`/api/teacher/submissions/${encodeURIComponent(btn.dataset.id)}`, {
            method: 'DELETE',
            auth: true
          });
          showToast('Submission deleted.', 'info');
          await loadBootstrap();
        } catch (err) {
          showToast(err.message, 'error');
        }
      });
    });
  }

  function openSubmissionModal(sub) {
    const letters = ['A', 'B', 'C', 'D'];
    const subjCards = (sub.subjectBreakdown || []).map((sb) => `
      <div class="badge" style="padding:7px 12px;background:var(--surface-muted);border-color:var(--border);">
        <strong>${escapeHtml(sb.subjectName)}:</strong> ${sb.marksObtained}/${sb.maxMarks} (${sb.correct}/${sb.totalQuestions} correct)
      </div>
    `).join('');

    const reviewHtml = (sub.review || []).map((item, idx) => `
      <div class="review-item ${escapeHtml(item.status)}">
        <div class="flex-between" style="margin-bottom:6px;">
          <span class="badge badge-neutral">Q${idx + 1} • ${escapeHtml(item.subjectName)}</span>
          <span class="badge ${item.status === 'correct' ? 'badge-success' : item.status === 'wrong' ? 'badge-danger' : 'badge-neutral'}">
            ${item.status === 'correct' ? `+${item.marksAwarded} Mark` : item.status === 'wrong' ? `${item.marksAwarded} Mark` : 'Skipped'}
          </span>
        </div>
        <div style="font-weight:600;margin-bottom:8px;">${escapeHtml(item.question)}</div>
        ${item.code ? `<pre class="code-block">${escapeHtml(item.code)}</pre>` : ''}
        <div class="stack-sm">
          ${item.options.map((opt, optIdx) => {
            const isCorrect = optIdx === item.correctIndex;
            const isChosen = optIdx === item.selectedIndex;
            const cls = isCorrect ? 'is-correct' : (isChosen && !isCorrect ? 'is-wrong' : '');
            return `
              <div class="review-opt ${cls}">
                <span><strong>${letters[optIdx]}.</strong> ${escapeHtml(opt)}</span>
                <span class="text-xs">
                  ${isCorrect ? '✓ Correct Answer' : ''}${isChosen && !isCorrect ? '✕ Student Choice' : ''}${isChosen && isCorrect ? ' (Chosen)' : ''}
                </span>
              </div>
            `;
          }).join('')}
        </div>
      </div>
    `).join('');

    const emailInfo = sub.emailDelivery || {};
    const emailLine = emailInfo.status === 'sent'
      ? `<div class="badge badge-success mb-2">📧 Emailed to: ${escapeHtml((emailInfo.recipients || []).join(', '))}</div>`
      : emailInfo.status === 'failed'
        ? `<div class="badge badge-danger mb-2">✕ Email failed: ${escapeHtml(emailInfo.error || 'Error')}</div>`
        : '';

    const proctor = sub.proctoring || {};
    const vCount = Number(proctor.violationsCount) || 0;
    const proctorEvents = Array.isArray(proctor.events) ? proctor.events : [];
    const proctorBox = vCount > 0 ? `
      <div class="card card-compact mb-2" style="background:var(--danger-soft);border-color:var(--danger-border);">
        <strong style="color:var(--danger);">🚨 Proctoring Alert: ${vCount} Violation(s)${proctor.autoSubmittedReason === 'proctor-limit' ? ' — Auto-submitted on limit' : ''}</strong>
        ${proctorEvents.length > 0 ? `
          <ul style="margin:6px 0 0;padding-left:18px;font-size:12.5px;color:#7f1d1d;">
            ${proctorEvents.map((ev) => `<li>${escapeHtml(ev.type)} on Q${ev.questionNumber || '?'} at ${escapeHtml(formatDateTime(ev.at))}</li>`).join('')}
          </ul>
        ` : ''}
      </div>
    ` : `
      <div class="badge badge-success mb-2">🛡️ Proctoring: Clean (0 violations)</div>
    `;

    openModal(`
      <div class="flex-between mb-2">
        <div>
          <h2 class="card-title">${escapeHtml(sub.studentName)} (${escapeHtml(sub.rollNumber)})</h2>
          <p class="card-subtitle">${escapeHtml(sub.examTitle)} • Score: <strong>${sub.score}/${sub.totalMarks} (${sub.percentage}%)</strong>${sub.studentEmail ? ` • ${escapeHtml(sub.studentEmail)}` : ''}</p>
        </div>
        <div class="flex-row">
          <button type="button" class="btn btn-soft-primary btn-sm" id="modal-resend-email-btn">📧 Send Email</button>
          <button type="button" class="btn btn-ghost btn-sm" id="modal-close-btn">✕</button>
        </div>
      </div>
      ${proctorBox}
      ${emailLine}
      <div class="flex-row mb-2">${subjCards}</div>
      <div class="stack-md">${reviewHtml}</div>
    `);
    document.getElementById('modal-close-btn').addEventListener('click', closeModal);
    document.getElementById('modal-resend-email-btn').addEventListener('click', async () => {
      const btn = document.getElementById('modal-resend-email-btn');
      btn.disabled = true;
      btn.textContent = 'Sending...';
      try {
        const res = await apiFetch(`/api/teacher/submissions/${encodeURIComponent(sub.id)}/email`, {
          method: 'POST',
          auth: true,
          body: {}
        });
        showToast(`Email sent to ${(res.emailDelivery.recipients || []).join(', ')}`, 'success');
        await loadBootstrap();
        closeModal();
      } catch (err) {
        showToast(err.message, 'error');
        btn.disabled = false;
        btn.textContent = '📧 Send Email';
      }
    });
  }

  document.getElementById('results-exam-filter').addEventListener('change', renderResults);
  document.getElementById('results-search-input').addEventListener('input', renderResults);

  document.getElementById('refresh-results-btn').addEventListener('click', async () => {
    try {
      const res = await apiFetch('/api/teacher/submissions', { auth: true });
      state.submissions = res.submissions || [];
      renderOverview();
      renderResults();
      showToast('Results refreshed.', 'info');
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  document.getElementById('export-csv-btn').addEventListener('click', async () => {
    const examId = document.getElementById('results-exam-filter').value || 'all';
    try {
      const res = await fetch(`/api/teacher/submissions/export.csv?examId=${encodeURIComponent(examId)}`, {
        headers: { Authorization: `Bearer ${getTeacherToken()}` }
      });
      if (!res.ok) throw new Error('Failed to export CSV');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'codeaura-exam-results.csv';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  document.getElementById('clear-results-btn').addEventListener('click', async () => {
    const examId = document.getElementById('results-exam-filter').value || 'all';
    const msg = examId === 'all'
      ? 'Delete ALL student submissions across every exam?'
      : 'Delete all student submissions for the selected exam?';
    if (!confirm(msg)) return;
    try {
      await apiFetch(`/api/teacher/submissions?examId=${encodeURIComponent(examId)}`, {
        method: 'DELETE',
        auth: true
      });
      showToast('Submissions cleared.', 'info');
      await loadBootstrap();
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  // ---------- TAB 5: SETTINGS ----------
  document.getElementById('settings-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const res = await apiFetch('/api/teacher/settings', {
        method: 'PUT',
        auth: true,
        body: {
          instituteName: document.getElementById('set-institute').value.trim(),
          teacherName: document.getElementById('set-teacher').value.trim(),
          currentPin: document.getElementById('set-current-pin').value,
          newPin: document.getElementById('set-new-pin').value
        }
      });
      document.getElementById('set-current-pin').value = '';
      document.getElementById('set-new-pin').value = '';
      state.settings = res.settings;
      state.info = { ...state.info, ...res.settings };
      document.getElementById('teacher-brand-name').textContent = state.info.instituteName;
      if (!state.info.isDefaultPin) {
        defaultPinHint.classList.add('hidden');
      }
      showToast('General settings saved!', 'success');
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  const SMTP_PRESETS = {
    gmail: { host: 'smtp.gmail.com', port: 465, secure: 'ssl' },
    outlook: { host: 'smtp-mail.outlook.com', port: 587, secure: 'starttls' },
    yahoo: { host: 'smtp.mail.yahoo.com', port: 465, secure: 'ssl' }
  };

  document.getElementById('set-email-provider').addEventListener('change', (e) => {
    const preset = SMTP_PRESETS[e.target.value];
    if (preset) {
      document.getElementById('set-smtp-host').value = preset.host;
      document.getElementById('set-smtp-port').value = preset.port;
      document.getElementById('set-smtp-secure').value = preset.secure;
    }
  });

  document.getElementById('set-smtp-secure').addEventListener('change', (e) => {
    document.getElementById('set-smtp-port').value = e.target.value === 'ssl' ? 465 : 587;
  });

  function collectEmailPayload() {
    return {
      enabled: document.getElementById('set-email-enabled').checked,
      provider: document.getElementById('set-email-provider').value,
      smtpHost: document.getElementById('set-smtp-host').value.trim(),
      smtpPort: Number(document.getElementById('set-smtp-port').value) || 465,
      smtpSecure: document.getElementById('set-smtp-secure').value === 'ssl',
      smtpUser: document.getElementById('set-smtp-user').value.trim(),
      smtpPass: document.getElementById('set-smtp-pass').value.trim(),
      teacherEmails: document.getElementById('set-teacher-emails').value.trim(),
      sendToTeacher: document.getElementById('set-send-teacher').checked,
      sendToStudent: document.getElementById('set-send-student').checked,
      requireStudentEmail: document.getElementById('set-require-student-email').checked
    };
  }

  document.getElementById('email-settings-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const res = await apiFetch('/api/teacher/settings', {
        method: 'PUT',
        auth: true,
        body: { email: collectEmailPayload() }
      });
      state.settings = res.settings;
      populateEmailSettings();
      showToast('Email settings saved!', 'success');
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  document.getElementById('test-email-btn').addEventListener('click', async () => {
    const btn = document.getElementById('test-email-btn');
    btn.disabled = true;
    btn.textContent = 'Sending...';
    try {
      const payload = collectEmailPayload();
      const res = await apiFetch('/api/teacher/email/test', {
        method: 'POST',
        auth: true,
        body: payload
      });
      showToast(`Test email sent to ${(res.recipients || []).join(', ')}!`, 'success');
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = '✉️ Send Test Email';
    }
  });

  function collectAiPayload() {
    return {
      enabled: true,
      baseUrl: document.getElementById('set-ai-base-url').value.trim(),
      apiKey: document.getElementById('set-ai-api-key').value.trim(),
      model: document.getElementById('set-ai-model').value.trim()
    };
  }

  document.getElementById('ai-settings-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const res = await apiFetch('/api/teacher/settings', {
        method: 'PUT',
        auth: true,
        body: { ai: collectAiPayload() }
      });
      state.settings = res.settings;
      populateAiSettings();
      showToast('AI settings saved!', 'success');
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  async function loadModelsFromProvider(showSuccessToast = true) {
    const payload = collectAiPayload();
    const res = await apiFetch('/api/teacher/ai/models', {
      method: 'POST',
      auth: true,
      body: { baseUrl: payload.baseUrl, apiKey: payload.apiKey }
    });
    const datalist = document.getElementById('ai-model-options');
    datalist.innerHTML = (res.models || [])
      .map((m) => `<option value="${escapeHtml(m.id)}">${m.free ? 'Free' : ''}</option>`)
      .join('');
    if (showSuccessToast) {
      showToast(`Loaded ${(res.models || []).length} models from AI endpoint!`, 'success');
    }
    return res.models || [];
  }

  document.getElementById('fetch-ai-models-btn').addEventListener('click', async () => {
    const btn = document.getElementById('fetch-ai-models-btn');
    btn.disabled = true;
    btn.textContent = '...';
    try {
      await loadModelsFromProvider(true);
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = '↻ Load';
    }
  });

  document.getElementById('test-ai-btn').addEventListener('click', async () => {
    const btn = document.getElementById('test-ai-btn');
    btn.disabled = true;
    btn.textContent = 'Testing...';
    try {
      const models = await loadModelsFromProvider(false);
      showToast(`AI API connected! ${models.length} models available.`, 'success');
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = '🧪 Verify AI Connection';
    }
  });

  initSession();
})();
