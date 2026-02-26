(function () {
  const tbody = document.getElementById('tbody');
  const tableWrap = document.getElementById('tableWrap');
  const emptyState = document.getElementById('emptyState');
  const foundCountEl = document.getElementById('foundCount');
  const toast = document.getElementById('toast');
  const modalOverlay = document.getElementById('modalOverlay');
  const modalBackdrop = document.getElementById('modalBackdrop');
  const modalClose = document.getElementById('modalClose');
  const modalTitle = document.getElementById('modalTitle');
  const modalAvatar = document.getElementById('modalAvatar');
  const modalAvatarInitial = document.getElementById('modalAvatarInitial');
  const modalUsername = document.getElementById('modalUsername');
  const modalBio = document.getElementById('modalBio');
  const modalCopy = document.getElementById('modalCopy');
  const modalAiBtn = document.getElementById('modalAiBtn');
  const modalAiSection = document.getElementById('modalAiSection');
  const modalAiLoading = document.getElementById('modalAiLoading');
  const modalAiError = document.getElementById('modalAiError');
  const modalAiContentWrap = document.getElementById('modalAiContentWrap');
  const modalAiContent = document.getElementById('modalAiContent');
  const modalAiCopy = document.getElementById('modalAiCopy');
  const modalCard = document.getElementById('modalCard');

  let currentModalUser = null;
  let lastAiRawText = '';

  function showToast() {
    toast.classList.add('visible');
    clearTimeout(toast._tid);
    toast._tid = setTimeout(() => toast.classList.remove('visible'), 2000);
  }

  function openModal(r) {
    currentModalUser = r;
    modalTitle.textContent = r.displayName || '—';
    const initial = (r.displayName && r.displayName.trim()) ? r.displayName.trim().charAt(0) : '?';
    modalAvatarInitial.textContent = initial;
    const prevImg = modalAvatar.querySelector('img');
    if (prevImg) prevImg.remove();
    if (r.avatarUrl) {
      const img = document.createElement('img');
      img.src = r.avatarUrl;
      img.alt = '';
      modalAvatar.appendChild(img);
      modalAvatarInitial.style.display = 'none';
    } else {
      modalAvatarInitial.style.display = '';
    }
    modalUsername.textContent = r.username ? (r.username.startsWith('@') ? r.username : '@' + r.username) : '—';
    modalUsername.dataset.rawUsername = r.username || '';
    modalBio.textContent = (r.profileSnippet && r.profileSnippet.trim()) ? r.profileSnippet.trim() : '—';
    modalAiSection.classList.remove('visible', 'loading', 'error');
    modalAiLoading.style.display = 'none';
    modalAiError.textContent = '';
    modalAiContent.innerHTML = '';
    lastAiRawText = '';
    modalCard.classList.remove('has-ai');
    modalOverlay.classList.add('visible');
    modalOverlay.setAttribute('aria-hidden', 'false');
    modalClose.focus();
  }

  function closeModal() {
    modalOverlay.classList.remove('visible');
    modalOverlay.setAttribute('aria-hidden', 'true');
  }

  modalBackdrop.addEventListener('click', closeModal);
  modalClose.addEventListener('click', closeModal);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modalOverlay.classList.contains('visible')) closeModal();
  });

  modalCopy.addEventListener('click', () => {
    const raw = modalUsername.dataset.rawUsername || '';
    if (raw) navigator.clipboard.writeText(raw).then(() => showToast());
  });

  function markdownToHtml(md) {
    if (!md || typeof md !== 'string') return '';
    let s = md
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    const lines = s.split(/\r?\n/);
    const out = [];
    let i = 0;
    function inline(s) {
      return s
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.+?)\*/g, '<em>$1</em>')
        .replace(/`([^`]+)`/g, '<code>$1</code>')
        .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
    }
    while (i < lines.length) {
      const line = lines[i];
      const h2 = line.match(/^##\s+(.+)$/);
      const h3 = line.match(/^###\s+(.+)$/);
      const ul = line.match(/^[-*]\s+(.+)$/);
      const ol = line.match(/^(\d+)\.\s+(.+)$/);
      if (h2) { out.push('<h2>' + inline(h2[1]) + '</h2>'); i++; continue; }
      if (h3) { out.push('<h3>' + inline(h3[1]) + '</h3>'); i++; continue; }
      if (ul) { out.push('<p class="md-li">• ' + inline(ul[1]) + '</p>'); i++; continue; }
      if (ol) { out.push('<p class="md-li">' + ol[1] + '. ' + inline(ol[2]) + '</p>'); i++; continue; }
      if (line.trim() === '') { out.push('<br>'); i++; continue; }
      out.push('<p>' + inline(line) + '</p>');
      i++;
    }
    return out.join('\n');
  }

  modalAiCopy.addEventListener('click', () => {
    if (lastAiRawText) navigator.clipboard.writeText(lastAiRawText).then(() => showToast());
  });

  modalAiBtn.addEventListener('click', () => {
    if (!currentModalUser) return;
    modalAiSection.classList.add('visible', 'loading');
    modalAiSection.classList.remove('error');
    modalAiLoading.style.display = 'block';
    modalAiError.textContent = '';
    modalAiContent.innerHTML = '';
    modalAiBtn.classList.add('loading');
    modalCard.classList.add('has-ai');

    chrome.runtime.sendMessage({
      type: 'OPENAI_ANALYZE',
      displayName: currentModalUser.displayName,
      username: currentModalUser.username,
      jobTitle: currentModalUser.jobTitle,
      profileSnippet: currentModalUser.profileSnippet,
    }, (response) => {
      modalAiBtn.classList.remove('loading');
      modalAiSection.classList.remove('loading');
      if (chrome.runtime.lastError) {
        modalAiSection.classList.add('error');
        modalAiError.textContent = chrome.runtime.lastError.message || 'Unknown error';
        return;
      }
      if (!response || !response.ok) {
        modalAiSection.classList.add('error');
        modalAiError.textContent = response?.error || 'Request failed';
        return;
      }
      lastAiRawText = response.content || '';
      modalAiContent.innerHTML = markdownToHtml(lastAiRawText);
    });
  });

  function render() {
    chrome.storage.local.get(['discordFinderResults'], (data) => {
      const results = data.discordFinderResults || [];

      foundCountEl.textContent = results.length;

      if (results.length === 0) {
        tableWrap.classList.add('hidden');
        emptyState.classList.add('visible');
        return;
      }

      tableWrap.classList.remove('hidden');
      emptyState.classList.remove('visible');

      tbody.innerHTML = results
        .map(
          (r, i) => `
        <tr data-username="${escapeAttr(r.username)}">
          <td>${i + 1}</td>
          <td class="col-server">${escapeHtml(r.serverName)}</td>
          <td class="col-channel">${escapeHtml(r.channelName)}</td>
          <td class="col-name">${escapeHtml(r.displayName)}</td>
          <td class="col-username">${escapeHtml(r.username)}</td>
          <td class="col-role">${escapeHtml(r.jobTitle)}</td>
          <td class="col-profile">${escapeHtml(r.profileSnippet || '—')}</td>
        </tr>
      `
        )
        .join('');

      tbody.querySelectorAll('tr').forEach((row, i) => {
        row.addEventListener('click', () => openModal(results[i]));
      });
    });
  }

  function escapeHtml(s) {
    if (s == null) return '—';
    const div = document.createElement('div');
    div.textContent = s;
    return div.innerHTML;
  }

  function escapeAttr(s) {
    if (s == null) return '';
    return encodeURIComponent(String(s));
  }

  render();
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.discordFinderResults) render();
  });
})();
