(function () {
  const searchedEl = document.getElementById('searchedCount');
  const totalEl = document.getElementById('totalCount');
  const foundEl = document.getElementById('foundCount');
  const progressFill = document.getElementById('progressFill');
  const progressText = document.getElementById('progressText');
  const errorDetail = document.getElementById('errorDetail');
  const searchBtn = document.getElementById('searchBtn');
  const viewBtn = document.getElementById('viewBtn');

  function clearError() {
    errorDetail.textContent = '';
    errorDetail.style.display = 'none';
  }
  function showError(text) {
    errorDetail.textContent = text || '';
    errorDetail.style.display = text ? 'block' : 'none';
  }

  function renderStats() {
    chrome.storage.local.get(['discordFinderStats', 'discordFinderResults'], (data) => {
      const stats = data.discordFinderStats || { searched: 0, total: 0, found: 0, status: 'idle' };
      const results = data.discordFinderResults || [];

      searchedEl.textContent = stats.searched;
      totalEl.textContent = stats.total;
      foundEl.textContent = stats.found;

      const total = stats.total || 1;
      const pct = Math.round((stats.searched / total) * 100);
      progressFill.style.width = pct + '%';

      if (stats.status === 'running') {
        progressText.textContent = 'Searching...';
        searchBtn.disabled = true;
        viewBtn.disabled = true;
      } else if (stats.status === 'done') {
        progressText.textContent = 'Complete';
        searchBtn.disabled = false;
        viewBtn.disabled = false;
      } else if (stats.status === 'idle' && stats.searched > 0) {
        progressText.textContent = 'Ready to search again';
        searchBtn.disabled = false;
        viewBtn.disabled = results.length > 0 ? false : true;
      } else {
        progressText.textContent = 'Ready';
        searchBtn.disabled = false;
        viewBtn.disabled = results.length === 0;
        clearError();
      }
    });
  }

  function startSearch(tab) {
    clearError();
    progressText.textContent = 'Starting…';
    chrome.tabs.sendMessage(tab.id, { type: 'START_SEARCH' }).then(
      () => { progressText.textContent = 'Searching...'; },
      () => {
        progressText.textContent = 'Loading script…';
        chrome.runtime.sendMessage({ type: 'START_SEARCH', tabId: tab.id }, (response) => {
          if (chrome.runtime.lastError) {
            progressText.textContent = 'Reload the Discord tab and try again';
            showError(chrome.runtime.lastError.message);
            return;
          }
          if (response?.ok) {
            progressText.textContent = 'Searching...';
          } else {
            progressText.textContent = 'Reload the Discord tab and try again';
            showError(response?.error || 'Unknown error');
          }
        });
      }
    );
  }

  searchBtn.addEventListener('click', () => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs[0];
      if (!tab?.url || !tab.url.includes('discord.com')) {
        progressText.textContent = 'Open a Discord channel first';
        return;
      }
      startSearch(tab);
    });
  });

  viewBtn.addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('results/results.html') });
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && (changes.discordFinderStats || changes.discordFinderResults)) {
      renderStats();
    }
  });

  renderStats();
})();
