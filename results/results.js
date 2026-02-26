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

  function showToast() {
    toast.classList.add('visible');
    clearTimeout(toast._tid);
    toast._tid = setTimeout(() => toast.classList.remove('visible'), 2000);
  }

  function openModal(r) {
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
