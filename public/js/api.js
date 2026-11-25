(function () {
  const TOKEN_KEY = 'codeaura_teacher_token';

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function getTeacherToken() {
    try {
      return localStorage.getItem(TOKEN_KEY) || '';
    } catch {
      return '';
    }
  }

  function setTeacherToken(token) {
    try {
      if (token) {
        localStorage.setItem(TOKEN_KEY, token);
      } else {
        localStorage.removeItem(TOKEN_KEY);
      }
    } catch {}
  }

  async function apiFetch(url, options = {}) {
    const headers = { ...(options.headers || {}) };
    if (options.body && !(options.body instanceof FormData)) {
      headers['Content-Type'] = 'application/json';
    }
    if (options.auth) {
      const token = getTeacherToken();
      if (token) {
        headers.Authorization = `Bearer ${token}`;
      }
    }

    const res = await fetch(url, {
      ...options,
      headers,
      body: options.body && typeof options.body !== 'string' && !(options.body instanceof FormData)
        ? JSON.stringify(options.body)
        : options.body
    });

    const contentType = res.headers.get('content-type') || '';
    const data = contentType.includes('application/json') ? await res.json() : await res.text();

    if (!res.ok) {
      const message = (data && data.error) ? data.error : `Request failed (${res.status})`;
      const err = new Error(message);
      err.status = res.status;
      throw err;
    }
    return data;
  }

  function formatDuration(totalSeconds) {
    const s = Math.max(0, Math.floor(Number(totalSeconds) || 0));
    const hrs = Math.floor(s / 3600);
    const mins = Math.floor((s % 3600) / 60);
    const secs = s % 60;
    const pad = (n) => String(n).padStart(2, '0');
    if (hrs > 0) return `${pad(hrs)}:${pad(mins)}:${pad(secs)}`;
    return `${pad(mins)}:${pad(secs)}`;
  }

  function formatDateTime(iso) {
    if (!iso) return '-';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '-';
    return d.toLocaleString(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short'
    });
  }

  function ensureToastContainer() {
    let el = document.getElementById('toast-container');
    if (!el) {
      el = document.createElement('div');
      el.id = 'toast-container';
      el.className = 'toast-container';
      document.body.appendChild(el);
    }
    return el;
  }

  function showToast(message, type = 'info') {
    const container = ensureToastContainer();
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transition = 'opacity 0.2s ease';
      setTimeout(() => toast.remove(), 220);
    }, 3200);
  }

  function renderSubjectBadge(subject) {
    if (!subject) return '';
    const name = escapeHtml(subject.name || subject.subjectName || subject.subjectId || '');
    const color = escapeHtml(subject.color || '#4f46e5');
    const bg = escapeHtml(subject.bgColor || '#eef2ff');
    return `<span class="badge" style="color:${color};background:${bg};border-color:${color}33">${name}</span>`;
  }

  function renderDifficultyBadge(diff) {
    const d = String(diff || 'Medium');
    if (d === 'Easy') return `<span class="badge badge-success">Easy</span>`;
    if (d === 'Hard') return `<span class="badge badge-danger">Hard</span>`;
    return `<span class="badge badge-warning">Medium</span>`;
  }

  function formatInlineCodeHtml(value) {
    const escaped = escapeHtml(value);
    return escaped
      .replace(/(&lt;\/?[a-zA-Z!][a-zA-Z0-9-]*(?:(?:[^&\n]|&quot;|&#39;|&amp;| ){0,60}?)&gt;)/g, '<code class="inline-code-pill">$1</code>')
      .replace(/`([^`]+)`/g, '<code class="inline-code-pill">$1</code>');
  }

  window.CodeAura = {
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
  };
})();
