(function () {
  const {
    escapeHtml,
    apiFetch,
    formatDuration,
    showToast,
    renderDifficultyBadge
  } = window.CodeAura;

  const STUDENT_INFO_KEY = 'codeaura_student_profile';

  const state = {
    liveExams: [],
    publicInfo: null,
    activeExam: null,
    currentIdx: 0,
    answers: {},       // { [questionId]: optionIndex }
    markedReview: {},  // { [questionId]: true }
    remainingSeconds: 0,
    totalDurationSeconds: 0,
    qRemainingSeconds: 0,
    examStartedAt: 0,
    timerId: null,
    isSubmitting: false,
    proctoring: {
      events: [],
      lastTriggeredAt: 0,
      graceUntil: 0,
      cleanupFns: []
    },
    studentProfile: {
      name: '',
      rollNumber: '',
      email: '',
      batch: ''
    }
  };

  // DOM Elements
  const lobbyView = document.getElementById('student-lobby-view');
  const examView = document.getElementById('student-exam-view');
  const resultView = document.getElementById('student-result-view');
  const nameInput = document.getElementById('stu-name');
  const rollInput = document.getElementById('stu-roll');
  const emailInput = document.getElementById('stu-email');
  const emailLabel = document.getElementById('stu-email-label');
  const batchInput = document.getElementById('stu-batch');
  const modal = document.getElementById('student-modal');
  const modalContent = document.getElementById('student-modal-content');

  // ---------- Profile Persistence ----------
  function loadSavedProfile() {
    try {
      const saved = JSON.parse(sessionStorage.getItem(STUDENT_INFO_KEY) || '{}');
      if (saved.name) nameInput.value = saved.name;
      if (saved.rollNumber) rollInput.value = saved.rollNumber;
      if (saved.email) emailInput.value = saved.email;
      if (saved.batch) batchInput.value = saved.batch;
    } catch {}
  }

  function saveProfile() {
    state.studentProfile = {
      name: nameInput.value.trim(),
      rollNumber: rollInput.value.trim(),
      email: emailInput.value.trim(),
      batch: batchInput.value.trim()
    };
    try {
      sessionStorage.setItem(STUDENT_INFO_KEY, JSON.stringify(state.studentProfile));
    } catch {}
  }

  [nameInput, rollInput, emailInput, batchInput].forEach((inp) => {
    inp.addEventListener('input', saveProfile);
  });

  // ---------- View Switcher ----------
  function showView(view) {
    lobbyView.classList.toggle('hidden', view !== 'lobby');
    examView.classList.toggle('hidden', view !== 'exam');
    resultView.classList.toggle('hidden', view !== 'result');
    document.getElementById('student-home-link').classList.toggle('hidden', view === 'exam');
  }

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

  // ---------- Load Live Exams ----------
  async function loadLiveExams() {
    try {
      const data = await apiFetch('/api/student/exams');
      state.liveExams = data.exams || [];
      state.publicInfo = data.info || {};
      if (data.info?.instituteName) {
        document.getElementById('student-brand-name').textContent = data.info.instituteName;
      }
      if (data.info?.requireStudentEmail) {
        emailLabel.textContent = 'Email Address *';
        emailInput.required = true;
      } else if (data.info?.sendToStudentEmail) {
        emailLabel.textContent = 'Email Address (For score copy)';
        emailInput.required = false;
      } else {
        emailLabel.textContent = 'Email Address (Optional)';
        emailInput.required = false;
      }
      renderLiveExams();
    } catch (err) {
      showToast('Could not fetch live exams.', 'error');
    }
  }

  function renderLiveExams() {
    const listEl = document.getElementById('live-exams-list');
    if (state.liveExams.length === 0) {
      listEl.innerHTML = `
        <div class="empty-state">
          <div style="font-size:32px;margin-bottom:8px;">⏳</div>
          <strong>Waiting for Sir to publish an exam</strong>
          <p class="text-sm text-muted" style="margin:6px 0 0;">
            As soon as Sir selects MCQs and clicks "Go Live" in the Teacher Portal, the exam will appear here automatically.
          </p>
        </div>
      `;
      return;
    }

    listEl.innerHTML = state.liveExams.map((exam) => {
      const subjBadges = (exam.subjectBreakdown || []).map((sb) => `
        <span class="badge" style="color:${escapeHtml(sb.color)};background:${escapeHtml(sb.bgColor)};border-color:${escapeHtml(sb.color)}33;">
          ${escapeHtml(sb.name)}: ${sb.count}
        </span>
      `).join('');

      return `
        <div class="card card-compact" style="border:1.5px solid var(--primary-border);background:#fcfdff;">
          <div class="flex-between">
            <div style="flex:1;min-width:220px;">
              <div class="flex-row">
                <span class="badge badge-success"><span class="live-dot"></span> LIVE</span>
                <strong style="font-size:17px;">${escapeHtml(exam.title)}</strong>
              </div>
              ${exam.description ? `<p class="text-sm text-muted" style="margin:6px 0 0;">${escapeHtml(exam.description)}</p>` : ''}
              <div class="flex-row mt-2">
                <span class="badge badge-primary">${exam.questionCount} MCQs</span>
                <span class="badge badge-neutral">${exam.totalMarks} Total Marks</span>
                <span class="badge badge-neutral">⏱ ${exam.durationMinutes} mins</span>
                ${exam.speedModeSeconds > 0 ? `<span class="badge badge-warning">⚡ Speed: ${exam.speedModeSeconds}s/Q</span>` : ''}
                ${exam.proctorTabSwitch !== false ? `<span class="badge badge-primary">🛡️ Proctored</span>` : ''}
                ${exam.requireFullscreen ? `<span class="badge badge-neutral">⛶ Fullscreen</span>` : ''}
                ${exam.negativeMarking > 0 ? `<span class="badge badge-danger">-${exam.negativeMarking} Negative</span>` : ''}
                ${subjBadges}
              </div>
            </div>
            <div>
              <button type="button" class="btn btn-primary btn-lg start-exam-btn" data-id="${escapeHtml(exam.id)}">
                Start Exam →
              </button>
            </div>
          </div>
        </div>
      `;
    }).join('');

    listEl.querySelectorAll('.start-exam-btn').forEach((btn) => {
      btn.addEventListener('click', () => startExam(btn.dataset.id));
    });
  }

  document.getElementById('refresh-exams-btn').addEventListener('click', () => {
    loadLiveExams();
    showToast('Checked for live exams.', 'info');
  });

  // SSE Live Sync
  function connectSSE() {
    const sse = new EventSource('/api/events');
    const badge = document.getElementById('sse-live-badge');

    sse.addEventListener('exams-updated', () => {
      if (!state.activeExam) {
        loadLiveExams();
        showToast('Live exams updated by Sir!', 'info');
      }
    });

    sse.addEventListener('info-updated', () => {
      if (!state.activeExam) loadLiveExams();
    });

    sse.onerror = () => {
      badge.className = 'badge badge-warning';
      badge.textContent = 'Reconnecting...';
    };

    sse.addEventListener('connected', () => {
      badge.className = 'badge badge-success';
      badge.innerHTML = '<span class="live-dot"></span> Connected Live';
    });
  }

  // ---------- Start Exam ----------
  async function startExam(examId) {
    saveProfile();
    if (!state.studentProfile.name) {
      nameInput.focus();
      showToast('Please enter your Full Name first.', 'error');
      return;
    }
    if (!state.studentProfile.rollNumber) {
      rollInput.focus();
      showToast('Please enter your Roll Number / Student ID.', 'error');
      return;
    }
    const emailVal = state.studentProfile.email;
    const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailVal);
    if (state.publicInfo?.requireStudentEmail && !emailValid) {
      emailInput.focus();
      showToast('Please enter a valid Email Address before starting.', 'error');
      return;
    }
    if (emailVal && !emailValid) {
      emailInput.focus();
      showToast('Please enter a valid Email Address.', 'error');
      return;
    }

    try {
      const res = await apiFetch(
        `/api/student/exams/${encodeURIComponent(examId)}?roll=${encodeURIComponent(state.studentProfile.rollNumber)}`
      );
      const exam = res.exam;
      if (!exam || !exam.questions || exam.questions.length === 0) {
        showToast('This exam has no questions yet.', 'error');
        return;
      }

      state.activeExam = exam;
      state.currentIdx = 0;
      state.answers = {};
      state.markedReview = {};
      state.isSubmitting = false;
      state.totalDurationSeconds = exam.durationMinutes * 60;
      state.remainingSeconds = state.totalDurationSeconds;
      state.qRemainingSeconds = exam.speedModeSeconds > 0 ? exam.speedModeSeconds : 0;
      state.examStartedAt = Date.now();
      state.proctoring.events = [];
      state.proctoring.lastTriggeredAt = 0;
      state.proctoring.graceUntil = Date.now() + 1400;

      if (exam.requireFullscreen && document.documentElement.requestFullscreen) {
        document.documentElement.requestFullscreen().catch(() => {});
      }

      document.getElementById('active-exam-title').textContent = exam.title;
      document.getElementById('active-student-meta').textContent =
        `${state.studentProfile.name} • Roll: ${state.studentProfile.rollNumber}${state.studentProfile.batch ? ` • ${state.studentProfile.batch}` : ''} • ${exam.totalMarks} Total Marks`;

      showView('exam');
      setupProctoring(exam);
      renderQuestion();
      renderPalette();
      startTimer();
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  // ---------- Anti-Cheating & Proctoring ----------
  function updateProctorUi() {
    const exam = state.activeExam;
    if (!exam) return;
    const bar = document.getElementById('proctor-bar');
    const warnPill = document.getElementById('proctor-warning-pill');
    const copyPill = document.getElementById('proctor-copy-pill');
    const speedPill = document.getElementById('proctor-speed-pill');
    const fsBtn = document.getElementById('enter-fullscreen-btn');

    const showBar = exam.proctorTabSwitch !== false || exam.blockCopyPaste !== false || exam.requireFullscreen || exam.speedModeSeconds > 0;
    bar.classList.toggle('hidden', !showBar);

    const vCount = state.proctoring.events.length;
    const maxV = Number(exam.maxTabViolations) || 0;
    if (exam.proctorTabSwitch !== false) {
      warnPill.classList.remove('hidden');
      warnPill.textContent = maxV > 0
        ? `🛡️ Proctored • ${vCount} / ${maxV} Strikes`
        : `🛡️ Proctored • ${vCount} Warning${vCount === 1 ? '' : 's'}`;
      warnPill.className = vCount === 0
        ? 'badge badge-primary'
        : (maxV > 0 && vCount >= maxV - 1 ? 'badge badge-danger' : 'badge badge-warning');
    } else {
      warnPill.classList.add('hidden');
    }

    copyPill.classList.toggle('hidden', exam.blockCopyPaste === false);
    speedPill.classList.toggle('hidden', !(exam.speedModeSeconds > 0));
    speedPill.textContent = `⚡ Speed Mode: ${exam.speedModeSeconds}s / Question`;

    const needsFs = Boolean(exam.requireFullscreen && !document.fullscreenElement);
    fsBtn.classList.toggle('hidden', !needsFs);
  }

  function recordViolation(type) {
    const exam = state.activeExam;
    if (!exam || state.isSubmitting) return;
    const now = Date.now();
    if (now < state.proctoring.graceUntil) return;
    // Debounce burst blur+visibilitychange events within 1.5s
    if (now - state.proctoring.lastTriggeredAt < 1500) return;

    state.proctoring.lastTriggeredAt = now;
    state.proctoring.events.push({
      type,
      questionNumber: state.currentIdx + 1,
      at: new Date().toISOString()
    });

    updateProctorUi();
    const count = state.proctoring.events.length;
    const maxV = Number(exam.maxTabViolations) || 0;

    if (maxV > 0 && count >= maxV) {
      closeModal();
      showToast(`Strike ${count}/${maxV}: Tab/focus violation limit reached! Auto-submitting exam.`, 'error');
      submitExam('proctor-limit');
      return;
    }

    const label = type === 'fullscreen-exit'
      ? 'You exited Fullscreen mode'
      : 'Tab / Window switch detected';
    openModal(`
      <div class="flex-between mb-2">
        <h2 class="card-title" style="color:var(--danger);">⚠️ Proctoring Warning (${count}${maxV > 0 ? ` / ${maxV}` : ''})</h2>
        <button type="button" class="btn btn-ghost btn-sm" id="modal-close-btn">✕</button>
      </div>
      <p style="margin:0 0 14px;">
        <strong>${escapeHtml(label)}</strong> while the exam is active. This activity is recorded for Sir.
        ${maxV > 0 ? `<br><span style="color:var(--danger);font-weight:600;">Your exam will auto-submit automatically on strike ${maxV}.</span>` : ''}
      </p>
      <div class="flex-row" style="justify-content:flex-end;">
        <button type="button" class="btn btn-primary" id="modal-ack-proctor-btn">Return to Exam</button>
      </div>
    `);
    document.getElementById('modal-close-btn').addEventListener('click', closeModal);
    document.getElementById('modal-ack-proctor-btn').addEventListener('click', () => {
      closeModal();
      if (exam.requireFullscreen && !document.fullscreenElement && document.documentElement.requestFullscreen) {
        document.documentElement.requestFullscreen().catch(() => {});
      }
    });
  }

  function setupProctoring(exam) {
    teardownProctoring();

    if (exam.blockCopyPaste !== false) {
      examView.classList.add('proctor-no-select');
      const blockEv = (e) => {
        e.preventDefault();
        showToast('Copy-paste and right-click are disabled during this exam.', 'error');
      };
      const blockKeys = (e) => {
        const k = e.key.toUpperCase();
        const ctrl = e.ctrlKey || e.metaKey;
        if (
          k === 'F12' ||
          (ctrl && e.shiftKey && ['I', 'J', 'C', 'K'].includes(k)) ||
          (ctrl && ['C', 'X', 'U', 'P', 'S'].includes(k))
        ) {
          e.preventDefault();
          showToast('Keyboard shortcuts & copying are blocked during the exam.', 'error');
        }
      };
      ['contextmenu', 'copy', 'cut', 'paste'].forEach((evName) => {
        examView.addEventListener(evName, blockEv);
        state.proctoring.cleanupFns.push(() => examView.removeEventListener(evName, blockEv));
      });
      document.addEventListener('keydown', blockKeys, true);
      state.proctoring.cleanupFns.push(() => document.removeEventListener('keydown', blockKeys, true));
    }

    if (exam.proctorTabSwitch !== false) {
      const onVisibility = () => {
        if (document.hidden) recordViolation('tab-switch');
      };
      const onBlur = () => {
        recordViolation('window-blur');
      };
      document.addEventListener('visibilitychange', onVisibility);
      window.addEventListener('blur', onBlur);
      state.proctoring.cleanupFns.push(() => {
        document.removeEventListener('visibilitychange', onVisibility);
        window.removeEventListener('blur', onBlur);
      });
    }

    if (exam.requireFullscreen) {
      const onFsChange = () => {
        updateProctorUi();
        if (!document.fullscreenElement && state.activeExam && !state.isSubmitting) {
          if (exam.proctorTabSwitch !== false) {
            recordViolation('fullscreen-exit');
          } else {
            showToast('Please stay in Fullscreen mode during the exam.', 'error');
          }
        }
      };
      document.addEventListener('fullscreenchange', onFsChange);
      state.proctoring.cleanupFns.push(() => document.removeEventListener('fullscreenchange', onFsChange));
    }

    const fsBtn = document.getElementById('enter-fullscreen-btn');
    const onFsClick = () => {
      if (document.documentElement.requestFullscreen) {
        document.documentElement.requestFullscreen().catch(() => {});
      }
    };
    fsBtn.addEventListener('click', onFsClick);
    state.proctoring.cleanupFns.push(() => fsBtn.removeEventListener('click', onFsClick));

    updateProctorUi();
  }

  function teardownProctoring() {
    examView.classList.remove('proctor-no-select');
    for (const fn of state.proctoring.cleanupFns) {
      try { fn(); } catch {}
    }
    state.proctoring.cleanupFns = [];
    if (document.fullscreenElement && document.exitFullscreen) {
      document.exitFullscreen().catch(() => {});
    }
  }

  // ---------- Countdown Timer ----------
  function startTimer() {
    stopTimer();
    updateTimerDisplay();
    state.timerId = setInterval(() => {
      state.remainingSeconds -= 1;
      if (state.activeExam?.speedModeSeconds > 0) {
        state.qRemainingSeconds -= 1;
        if (state.qRemainingSeconds <= 0) {
          if (state.currentIdx < state.activeExam.questions.length - 1) {
            state.currentIdx += 1;
            state.qRemainingSeconds = state.activeExam.speedModeSeconds;
            showToast(`⏱ Time up for Q${state.currentIdx} — moving to Q${state.currentIdx + 1}!`, 'info');
            renderQuestion();
            renderPalette();
          } else {
            stopTimer();
            showToast('Speed Mode finished! Submitting your exam...', 'info');
            submitExam('speed-mode-timeout');
            return;
          }
        }
      }
      updateTimerDisplay();
      if (state.remainingSeconds <= 0) {
        stopTimer();
        showToast('Time is up! Auto-submitting your exam...', 'info');
        submitExam('timer-expired');
      }
    }, 1000);
  }

  function stopTimer() {
    if (state.timerId) {
      clearInterval(state.timerId);
      state.timerId = null;
    }
  }

  function updateTimerDisplay() {
    const el = document.getElementById('exam-timer');
    el.textContent = formatDuration(state.remainingSeconds);
    el.classList.toggle('danger', state.remainingSeconds <= 60);

    const speedPill = document.getElementById('speed-timer-pill');
    if (state.activeExam?.speedModeSeconds > 0) {
      speedPill.classList.remove('hidden');
      speedPill.textContent = `⚡ Q-Time: ${Math.max(0, state.qRemainingSeconds)}s`;
      speedPill.classList.toggle('danger', state.qRemainingSeconds <= 7);
    } else {
      speedPill.classList.add('hidden');
    }
  }

  // ---------- Render Active Question ----------
  function renderQuestion() {
    const exam = state.activeExam;
    if (!exam) return;
    const q = exam.questions[state.currentIdx];
    const total = exam.questions.length;

    document.getElementById('active-q-counter').textContent = `Question ${state.currentIdx + 1} of ${total}`;
    document.getElementById('active-q-badges').innerHTML = `
      <span class="badge" style="color:${escapeHtml(q.subjectColor)};background:${escapeHtml(q.subjectBgColor)};border-color:${escapeHtml(q.subjectColor)}33;">
        ${escapeHtml(q.subjectName)}
      </span>
      ${renderDifficultyBadge(q.difficulty)}
      <span class="badge badge-neutral">+${exam.marksPerQuestion} Mark${exam.marksPerQuestion === 1 ? '' : 's'}</span>
    `;

    document.getElementById('active-q-text').textContent = q.question;

    const codeEl = document.getElementById('active-q-code');
    if (q.code && q.code.trim()) {
      codeEl.textContent = q.code;
      codeEl.classList.remove('hidden');
    } else {
      codeEl.textContent = '';
      codeEl.classList.add('hidden');
    }

    const letters = ['A', 'B', 'C', 'D'];
    const selectedOpt = state.answers[q.id];
    const optListEl = document.getElementById('active-options-list');

    optListEl.innerHTML = q.options.map((opt, idx) => `
      <button type="button" class="option-btn ${selectedOpt === idx ? 'selected' : ''}" data-opt="${idx}">
        <span class="option-letter">${letters[idx]}</span>
        <span style="flex:1;line-height:1.45;">${escapeHtml(opt)}</span>
      </button>
    `).join('');

    optListEl.querySelectorAll('.option-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.answers[q.id] = Number(btn.dataset.opt);
        renderQuestion();
        renderPalette();
      });
    });

    const isMarked = Boolean(state.markedReview[q.id]);
    const markBtn = document.getElementById('mark-review-btn');
    markBtn.textContent = isMarked ? '★ Marked for Review' : '🔖 Mark for Review';
    markBtn.className = isMarked ? 'btn btn-warning' : 'btn btn-ghost';

    const isSpeedMode = exam.speedModeSeconds > 0;
    const prevBtn = document.getElementById('prev-q-btn');
    prevBtn.disabled = state.currentIdx === 0 || isSpeedMode;
    prevBtn.classList.toggle('hidden', isSpeedMode);
    const nextBtn = document.getElementById('next-q-btn');
    nextBtn.textContent = state.currentIdx === total - 1 ? 'Review & Submit ✓' : 'Save & Next →';
  }

  function renderPalette() {
    const exam = state.activeExam;
    if (!exam) return;
    const isSpeedMode = exam.speedModeSeconds > 0;

    let answered = 0;
    let marked = 0;
    let unanswered = 0;

    const paletteEl = document.getElementById('question-palette');
    paletteEl.innerHTML = exam.questions.map((q, idx) => {
      const hasAns = state.answers[q.id] !== undefined;
      const isMarked = Boolean(state.markedReview[q.id]);
      if (hasAns) answered += 1;
      else unanswered += 1;
      if (isMarked) marked += 1;

      const classes = ['palette-btn'];
      if (isMarked) classes.push('marked');
      else if (hasAns) classes.push('answered');
      if (idx === state.currentIdx) classes.push('current');

      return `<button type="button" class="${classes.join(' ')}" data-idx="${idx}" ${isSpeedMode ? 'disabled style="cursor:default;opacity:0.85;"' : ''}>${idx + 1}</button>`;
    }).join('');

    if (!isSpeedMode) {
      paletteEl.querySelectorAll('.palette-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
          state.currentIdx = Number(btn.dataset.idx);
          renderQuestion();
          renderPalette();
        });
      });
    }

    document.getElementById('count-answered').textContent = answered;
    document.getElementById('count-marked').textContent = marked;
    document.getElementById('count-unanswered').textContent = unanswered;
  }

  // Navigation buttons
  document.getElementById('prev-q-btn').addEventListener('click', () => {
    if (state.activeExam?.speedModeSeconds > 0) return;
    if (state.currentIdx > 0) {
      state.currentIdx -= 1;
      renderQuestion();
      renderPalette();
    }
  });

  document.getElementById('next-q-btn').addEventListener('click', () => {
    if (!state.activeExam) return;
    if (state.currentIdx < state.activeExam.questions.length - 1) {
      state.currentIdx += 1;
      if (state.activeExam.speedModeSeconds > 0) {
        state.qRemainingSeconds = state.activeExam.speedModeSeconds;
        updateTimerDisplay();
      }
      renderQuestion();
      renderPalette();
    } else {
      openSubmitModal();
    }
  });

  document.getElementById('mark-review-btn').addEventListener('click', () => {
    const q = state.activeExam?.questions[state.currentIdx];
    if (!q) return;
    if (state.markedReview[q.id]) {
      delete state.markedReview[q.id];
    } else {
      state.markedReview[q.id] = true;
    }
    renderQuestion();
    renderPalette();
  });

  document.getElementById('clear-answer-btn').addEventListener('click', () => {
    const q = state.activeExam?.questions[state.currentIdx];
    if (!q) return;
    delete state.answers[q.id];
    renderQuestion();
    renderPalette();
  });

  document.getElementById('open-submit-modal-btn').addEventListener('click', openSubmitModal);

  function openSubmitModal() {
    if (!state.activeExam) return;
    const total = state.activeExam.questions.length;
    const answered = Object.keys(state.answers).length;
    const unanswered = total - answered;
    const marked = Object.keys(state.markedReview).length;

    openModal(`
      <div class="flex-between mb-2">
        <h2 class="card-title">Submit Your Exam?</h2>
        <button type="button" class="btn btn-ghost btn-sm" id="modal-close-btn">✕</button>
      </div>
      <p class="text-muted text-sm" style="margin-top:0;">
        Once submitted, your MCQs will be automatically checked and your total marks will be calculated immediately.
      </p>
      <div class="stats-grid" style="grid-template-columns:repeat(3,1fr);margin:14px 0;">
        <div class="stat-card" style="padding:12px;">
          <div class="stat-label">Answered</div>
          <div class="stat-value" style="font-size:22px;color:var(--success);">${answered}</div>
        </div>
        <div class="stat-card" style="padding:12px;">
          <div class="stat-label">Unanswered</div>
          <div class="stat-value" style="font-size:22px;color:${unanswered > 0 ? 'var(--danger)' : 'var(--text)'};">${unanswered}</div>
        </div>
        <div class="stat-card" style="padding:12px;">
          <div class="stat-label">Marked</div>
          <div class="stat-value" style="font-size:22px;color:var(--warning);">${marked}</div>
        </div>
      </div>
      <div class="flex-row" style="justify-content:flex-end;">
        <button type="button" class="btn btn-secondary" id="modal-cancel-btn">Keep Reviewing</button>
        <button type="button" class="btn btn-success" id="confirm-submit-btn">✓ Final Submit &amp; Check Marks</button>
      </div>
    `);

    document.getElementById('modal-close-btn').addEventListener('click', closeModal);
    document.getElementById('modal-cancel-btn').addEventListener('click', closeModal);
    document.getElementById('confirm-submit-btn').addEventListener('click', () => {
      closeModal();
      submitExam('manual');
    });
  }

  // ---------- Submit & Auto-Grade ----------
  async function submitExam(reason = 'manual') {
    if (state.isSubmitting || !state.activeExam) return;
    state.isSubmitting = true;
    stopTimer();
    teardownProctoring();

    const elapsedSeconds = state.examStartedAt
      ? Math.max(1, Math.round((Date.now() - state.examStartedAt) / 1000))
      : Math.max(1, state.totalDurationSeconds - Math.max(0, state.remainingSeconds));
    const examId = state.activeExam.id;

    try {
      const res = await apiFetch(`/api/student/exams/${encodeURIComponent(examId)}/submit`, {
        method: 'POST',
        body: {
          studentName: state.studentProfile.name,
          rollNumber: state.studentProfile.rollNumber,
          studentEmail: state.studentProfile.email,
          batch: state.studentProfile.batch,
          answers: state.answers,
          timeTakenSeconds: elapsedSeconds,
          proctoring: {
            violationsCount: state.proctoring.events.length,
            autoSubmittedReason: reason,
            events: state.proctoring.events
          }
        }
      });

      state.activeExam = null;
      renderResultView(res.result);
      showView('result');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) {
      state.isSubmitting = false;
      showToast(err.message, 'error');
    }
  }

  function renderResultView(result) {
    const container = document.getElementById('result-container');
    const letters = ['A', 'B', 'C', 'D'];

    const subjHtml = (result.subjectBreakdown || []).map((sb) => {
      const pct = sb.maxMarks > 0 ? Math.max(0, Math.round((sb.marksObtained / sb.maxMarks) * 100)) : 0;
      return `
        <div class="card card-compact">
          <div class="flex-between">
            <strong style="color:${escapeHtml(sb.color)};">${escapeHtml(sb.subjectName)}</strong>
            <strong>${sb.marksObtained} / ${sb.maxMarks} Marks (${pct}%)</strong>
          </div>
          <div style="height:8px;background:var(--surface-muted);border-radius:999px;overflow:hidden;margin:8px 0 6px;">
            <div style="height:100%;width:${pct}%;background:${escapeHtml(sb.color)};border-radius:999px;"></div>
          </div>
          <div class="text-xs text-muted">
            ✓ Correct: ${sb.correct} • ✕ Wrong: ${sb.wrong} • – Skipped: ${sb.skipped}
          </div>
        </div>
      `;
    }).join('');

    let currentReviewFilter = 'all';

    function renderReviewCards(filter) {
      const items = (result.review || []).filter((r) => filter === 'all' || r.status === filter);
      if (items.length === 0) {
        return `<div class="empty-state">No questions in this filter.</div>`;
      }
      return items.map((item, idx) => `
        <div class="review-item ${escapeHtml(item.status)}">
          <div class="flex-between" style="margin-bottom:8px;">
            <div class="flex-row">
              <span class="badge badge-neutral">Question • ${escapeHtml(item.subjectName)}</span>
            </div>
            <span class="badge ${item.status === 'correct' ? 'badge-success' : item.status === 'wrong' ? 'badge-danger' : 'badge-neutral'}">
              ${item.status === 'correct' ? `✓ Correct (+${item.marksAwarded})` : item.status === 'wrong' ? `✕ Wrong (${item.marksAwarded})` : '– Not Attempted (0)'}
            </span>
          </div>
          <div style="font-weight:600;font-size:15px;margin-bottom:8px;">${escapeHtml(item.question)}</div>
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
                    ${isCorrect ? '✓ Correct Answer' : ''}${isChosen && !isCorrect ? '✕ Your Answer' : ''}${isChosen && isCorrect ? ' (Your Answer)' : ''}
                  </span>
                </div>
              `;
            }).join('')}
          </div>
          ${item.explanation ? `<div class="text-sm mt-2" style="background:var(--surface-muted);padding:9px 12px;border-radius:8px;color:var(--text-muted);">💡 <strong>Explanation:</strong> ${escapeHtml(item.explanation)}</div>` : ''}
        </div>
      `).join('');
    }

    container.innerHTML = `
      <div class="card" style="text-align:center;border-top:6px solid ${result.passed ? 'var(--success)' : 'var(--danger)'};">
        <span class="badge ${result.passed ? 'badge-success' : 'badge-danger'}" style="font-size:13px;padding:5px 14px;">
          ${result.passed ? '🎉 PASSED' : '📚 NEEDS PRACTICE'}
        </span>
        <h1 style="margin:12px 0 4px;font-size:26px;">${escapeHtml(result.examTitle)}</h1>
        <p class="text-muted text-sm" style="margin:0;">
          ${escapeHtml(result.studentName)} • Roll No: <strong>${escapeHtml(result.rollNumber)}</strong>
          ${result.batch ? ` • ${escapeHtml(result.batch)}` : ''}
        </p>

        <div style="margin:22px auto;display:inline-flex;flex-direction:column;align-items:center;background:var(--primary-soft);border:2px solid var(--primary-border);border-radius:18px;padding:18px 36px;">
          <div class="text-xs" style="font-weight:700;color:var(--primary);text-transform:uppercase;letter-spacing:0.06em;">Total Marks Obtained</div>
          <div style="font-size:44px;font-weight:900;color:var(--primary);line-height:1.1;margin-top:4px;">
            ${result.score} <span style="font-size:22px;color:var(--text-muted);font-weight:700;">/ ${result.totalMarks}</span>
          </div>
          <div style="font-weight:700;font-size:16px;margin-top:4px;">${result.percentage}% Score</div>
        </div>

        <div class="stats-grid" style="grid-template-columns:repeat(auto-fit,minmax(130px,1fr));text-align:left;">
          <div class="stat-card">
            <div class="stat-label">Correct</div>
            <div class="stat-value" style="color:var(--success);">${result.correctCount}</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">Wrong</div>
            <div class="stat-value" style="color:var(--danger);">${result.wrongCount}</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">Skipped</div>
            <div class="stat-value" style="color:var(--text-subtle);">${result.skippedCount}</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">Time Taken</div>
            <div class="stat-value font-mono" style="font-size:22px;">${formatDuration(result.timeTakenSeconds)}</div>
          </div>
        </div>

        <div class="flex-row mt-3" style="justify-content:center;">
          <button type="button" id="back-to-lobby-btn" class="btn btn-primary">← Back to Live Exams</button>
          <button type="button" id="print-result-btn" class="btn btn-secondary">🖨 Print / Save Score Card</button>
        </div>

        ${result.emailDelivery?.status === 'sent' ? `
          <div class="badge badge-success mt-2" style="padding:8px 14px;border-radius:10px;white-space:normal;">
            📧 Score report automatically emailed to: <strong>${escapeHtml((result.emailDelivery.recipients || []).join(', '))}</strong>
          </div>
        ` : result.emailDelivery?.status === 'failed' ? `
          <div class="badge badge-warning mt-2" style="padding:8px 14px;border-radius:10px;white-space:normal;">
            ⚠️ Marks saved, but auto-email could not be delivered (${escapeHtml(result.emailDelivery.error || 'SMTP error')}). Sir can resend from Teacher Portal.
          </div>
        ` : ''}

        ${result.proctoring ? `
          <div class="mt-2">
            <span class="badge ${result.proctoring.violationsCount > 0 ? 'badge-warning' : 'badge-success'}">
              ${result.proctoring.violationsCount > 0
                ? `⚠️ Proctoring Flags: ${result.proctoring.violationsCount}${result.proctoring.autoSubmittedReason === 'proctor-limit' ? ' (Auto-submitted at strike limit)' : ''}`
                : '🛡️ Proctoring Status: Clean (0 violations)'}
            </span>
          </div>
        ` : ''}
      </div>

      <div class="card stack-md">
        <h2 class="card-title">Subject-wise Marks Breakdown</h2>
        <div class="form-grid">${subjHtml}</div>
      </div>

      ${result.reviewHidden ? `
        <div class="card" style="text-align:center;">
          <p class="text-muted" style="margin:0;">Your marks have been recorded and sent to Sir. Detailed answer review is currently hidden by Sir.</p>
        </div>
      ` : `
        <div class="card stack-md">
          <div class="flex-between">
            <div>
              <h2 class="card-title">Auto-Checked Answer Sheet</h2>
              <p class="card-subtitle">Review every question, your selected option, and the correct explanation.</p>
            </div>
            <div class="flex-row" id="review-filter-btns">
              <button type="button" class="btn btn-sm btn-primary" data-filter="all">All (${result.totalQuestions})</button>
              <button type="button" class="btn btn-sm btn-secondary" data-filter="correct">✓ Correct (${result.correctCount})</button>
              <button type="button" class="btn btn-sm btn-secondary" data-filter="wrong">✕ Wrong (${result.wrongCount})</button>
              <button type="button" class="btn btn-sm btn-secondary" data-filter="skipped">– Skipped (${result.skippedCount})</button>
            </div>
          </div>
          <div id="review-cards-list" class="stack-md">${renderReviewCards('all')}</div>
        </div>
      `}
    `;

    document.getElementById('back-to-lobby-btn').addEventListener('click', () => {
      showView('lobby');
      loadLiveExams();
    });

    document.getElementById('print-result-btn').addEventListener('click', () => window.print());

    const filterBar = document.getElementById('review-filter-btns');
    if (filterBar) {
      filterBar.querySelectorAll('button').forEach((btn) => {
        btn.addEventListener('click', () => {
          currentReviewFilter = btn.dataset.filter;
          filterBar.querySelectorAll('button').forEach((b) => {
            b.className = b === btn ? 'btn btn-sm btn-primary' : 'btn btn-sm btn-secondary';
          });
          document.getElementById('review-cards-list').innerHTML = renderReviewCards(currentReviewFilter);
        });
      });
    }
  }

  // Keyboard shortcuts during exam
  document.addEventListener('keydown', (e) => {
    if (!state.activeExam || !modal.classList.contains('hidden')) return;
    if (e.key === 'ArrowRight') {
      document.getElementById('next-q-btn').click();
    } else if (e.key === 'ArrowLeft') {
      document.getElementById('prev-q-btn').click();
    } else if (['1', '2', '3', '4'].includes(e.key)) {
      const idx = Number(e.key) - 1;
      const q = state.activeExam.questions[state.currentIdx];
      if (q && q.options[idx] !== undefined) {
        state.answers[q.id] = idx;
        renderQuestion();
        renderPalette();
      }
    }
  });

  // Initialize
  loadSavedProfile();
  loadLiveExams();
  connectSSE();
})();
