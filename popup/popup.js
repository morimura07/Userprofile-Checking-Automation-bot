(function () {
  // ─── DOM refs ────────────────────────────────────────────────────────────
  const searchedEl   = document.getElementById('searchedCount');
  const totalEl      = document.getElementById('totalCount');
  const foundEl      = document.getElementById('foundCount');
  const progressFill = document.getElementById('progressFill');
  const progressText = document.getElementById('progressText');
  const errorDetail  = document.getElementById('errorDetail');
  const searchBtn    = document.getElementById('searchBtn');
  const viewBtn      = document.getElementById('viewBtn');
  const clearBtn     = document.getElementById('clearBtn');
  const kwInput      = document.getElementById('kwInput');
  const kwAddBtn     = document.getElementById('kwAddBtn');
  const kwTags       = document.getElementById('kwTags');
  const kwCounter    = document.getElementById('kwCounter');

  // ─── Keyword defaults ────────────────────────────────────────────────────
  const DEFAULT_KEYWORDS = [
    'CEO', 'Founder', 'CO-Founder', 'Project Manager', 'CTO', 'Looking for Developer',
  ];
  const MAX_KW = 10;
  let keywords = [];

  // ─── Keyword persistence ─────────────────────────────────────────────────
  function saveKeywords() {
    chrome.storage.local.set({ discordFinderKeywords: keywords });
  }

  function loadKeywords() {
    chrome.storage.local.get(['discordFinderKeywords'], (data) => {
      keywords = (data.discordFinderKeywords && data.discordFinderKeywords.length > 0)
        ? data.discordFinderKeywords
        : [...DEFAULT_KEYWORDS];
      renderKeywords();
    });
  }

  // ─── Keyword UI ──────────────────────────────────────────────────────────
  function escHtml(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  function renderKeywords() {
    const count = keywords.length;
    kwCounter.textContent = `${count} / ${MAX_KW}`;
    kwCounter.classList.toggle('at-max', count >= MAX_KW);
    kwInput.disabled   = count >= MAX_KW;
    kwAddBtn.disabled  = count >= MAX_KW;

    kwTags.innerHTML = '';

    if (count === 0) {
      kwTags.insertAdjacentHTML('beforeend', '<span class="kw-empty">No keywords — add at least one.</span>');
      return;
    }

    keywords.forEach((kw) => {
      const tag = document.createElement('span');
      tag.className = 'kw-tag';
      tag.innerHTML = `<span class="kw-tag-text" title="${escHtml(kw)}">${escHtml(kw)}</span>
        <button type="button" class="kw-tag-remove" aria-label="Remove ${escHtml(kw)}">×</button>`;
      tag.querySelector('.kw-tag-remove').addEventListener('click', () => {
        keywords = keywords.filter((k) => k !== kw);
        saveKeywords();
        renderKeywords();
      });
      kwTags.appendChild(tag);
    });
  }

  function addKeyword(raw) {
    const kw = raw.trim();
    if (!kw) return;
    if (kw.length > 50) return;
    if (keywords.length >= MAX_KW) return;
    if (keywords.some((k) => k.toLowerCase() === kw.toLowerCase())) {
      kwInput.value = '';
      return; // silently skip duplicates
    }
    keywords.push(kw);
    saveKeywords();
    renderKeywords();
    kwInput.value = '';
    kwInput.focus();
  }

  kwAddBtn.addEventListener('click', () => addKeyword(kwInput.value));
  kwInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') addKeyword(kwInput.value); });

  // ─── Stats / progress ────────────────────────────────────────────────────
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
      const stats   = data.discordFinderStats  || { searched: 0, total: 0, found: 0, status: 'idle' };
      const results = data.discordFinderResults || [];

      searchedEl.textContent = stats.searched;
      totalEl.textContent    = stats.total;
      foundEl.textContent    = stats.found;

      const pct = stats.total ? Math.round((stats.searched / stats.total) * 100) : 0;
      progressFill.style.width = pct + '%';

      if (stats.status === 'running') {
        progressText.textContent = 'Searching…';
        searchBtn.disabled = true;
        viewBtn.disabled   = true;
      } else if (stats.status === 'done') {
        progressText.textContent = `Complete — ${stats.found} found`;
        searchBtn.disabled = false;
        viewBtn.disabled   = false;
      } else if (stats.status === 'idle' && stats.searched > 0) {
        progressText.textContent = 'Ready to search again';
        searchBtn.disabled = false;
        viewBtn.disabled   = results.length === 0;
      } else {
        progressText.textContent = 'Ready';
        searchBtn.disabled = false;
        viewBtn.disabled   = results.length === 0;
        clearError();
      }
    });
  }

  // ─── Search ──────────────────────────────────────────────────────────────
  function startSearch(tab) {
    if (keywords.length === 0) {
      progressText.textContent = 'Add at least one keyword first';
      return;
    }
    clearError();
    progressText.textContent = 'Starting…';

    const payload = { type: 'START_SEARCH', keywords };

    chrome.tabs.sendMessage(tab.id, payload).then(
      () => { progressText.textContent = 'Searching…'; },
      () => {
        progressText.textContent = 'Loading script…';
        chrome.runtime.sendMessage({ ...payload, tabId: tab.id }, (response) => {
          if (chrome.runtime.lastError) {
            progressText.textContent = 'Reload the Discord tab and try again';
            showError(chrome.runtime.lastError.message);
            return;
          }
          if (response?.ok) {
            progressText.textContent = 'Searching…';
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

  clearBtn.addEventListener('click', () => {
    chrome.storage.local.set({
      discordFinderStats:   { searched: 0, total: 0, found: 0, status: 'idle' },
      discordFinderResults: [],
    }, () => {
      clearError();
      progressText.textContent = 'Ready';
      progressFill.style.width = '0%';
      viewBtn.disabled = true;
      renderStats();
    });
  });

  // ─── Live updates from storage ───────────────────────────────────────────
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && (changes.discordFinderStats || changes.discordFinderResults)) {
      renderStats();
    }
  });

  // ─── Init ────────────────────────────────────────────────────────────────
  loadKeywords();
  renderStats();
})();
