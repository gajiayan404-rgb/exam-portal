(function () {
  const { apiFetch, escapeHtml, showToast } = window.CodeAura;

  async function loadPublicInfo() {
    try {
      const info = await apiFetch('/api/public/info');
      document.getElementById('brand-name').textContent = info.instituteName || 'CodeAura Classroom';

      const pill = document.getElementById('live-status-pill');
      if (info.liveExamsCount > 0) {
        pill.className = 'badge badge-success';
        pill.innerHTML = `<span class="live-dot"></span> ${info.liveExamsCount} Live Exam${info.liveExamsCount > 1 ? 's' : ''} Active • ${info.totalQuestions} MCQs in Bank`;
      } else {
        pill.className = 'badge badge-warning';
        pill.textContent = `No Live Exam Currently • ${info.totalQuestions} MCQs Ready in Bank`;
      }

      const studentBadge = document.getElementById('student-live-badge');
      studentBadge.textContent = info.liveExamsCount > 0
        ? `${info.liveExamsCount} Live Exam${info.liveExamsCount > 1 ? 's' : ''}`
        : 'Waiting for Sir';
      studentBadge.className = info.liveExamsCount > 0 ? 'badge badge-success' : 'badge badge-neutral';

      const pillsContainer = document.getElementById('subject-pills');
      pillsContainer.innerHTML = (info.subjects || [])
        .map((s) => `<span class="badge" style="color:${escapeHtml(s.color)};background:${escapeHtml(s.bgColor)};border-color:${escapeHtml(s.color)}33">${escapeHtml(s.name)}</span>`)
        .join('');

      if (Array.isArray(info.lanUrls) && info.lanUrls.length > 0) {
        const lanCard = document.getElementById('lan-share-card');
        const listEl = document.getElementById('lan-links-list');
        lanCard.classList.remove('hidden');
        listEl.innerHTML = info.lanUrls.map((baseUrl) => {
          const studentUrl = `${baseUrl}/student`;
          return `
            <div class="flex-row" style="background:var(--surface-muted);padding:6px 10px;border-radius:8px;border:1px solid var(--border);">
              <code class="font-mono text-sm">${escapeHtml(studentUrl)}</code>
              <button type="button" class="btn btn-primary btn-sm copy-lan-btn" data-url="${escapeHtml(studentUrl)}">Copy</button>
            </div>
          `;
        }).join('');

        listEl.querySelectorAll('.copy-lan-btn').forEach((btn) => {
          btn.addEventListener('click', async () => {
            try {
              await navigator.clipboard.writeText(btn.dataset.url);
              showToast('Student portal link copied!', 'success');
            } catch {
              showToast(btn.dataset.url, 'info');
            }
          });
        });
      }
    } catch (err) {
      showToast('Could not connect to exam server.', 'error');
    }
  }

  loadPublicInfo();
})();
