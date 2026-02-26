(function () {
  const tbody = document.getElementById('tbody');
  const tableWrap = document.getElementById('tableWrap');
  const emptyState = document.getElementById('emptyState');
  const foundCountEl = document.getElementById('foundCount');
  const toast = document.getElementById('toast');

  function showToast() {
    toast.classList.add('visible');
    clearTimeout(toast._tid);
    toast._tid = setTimeout(() => toast.classList.remove('visible'), 2000);
  }

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

      tbody.querySelectorAll('tr').forEach((row) => {
        row.addEventListener('click', () => {
          const username = row.getAttribute('data-username') || '';
          const text = decodeURIComponent(username);
          navigator.clipboard.writeText(text).then(() => showToast());
        });
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
