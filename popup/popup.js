(function () {
  // ─── DOM refs ────────────────────────────────────────────────────────────
  const searchedEl   = document.getElementById('searchedCount');
  const totalEl      = document.getElementById('totalCount');
  const foundEl      = document.getElementById('foundCount');
  const progressFill = document.getElementById('progressFill');
  const progressText = document.getElementById('progressText');
  const errorDetail  = document.getElementById('errorDetail');
  const searchBtn    = document.getElementById('searchBtn');
  const stopBtn      = document.getElementById('stopBtn');
  const viewBtn      = document.getElementById('viewBtn');
  const clearBtn     = document.getElementById('clearBtn');
  const kwInput      = document.getElementById('kwInput');
  const kwAddBtn     = document.getElementById('kwAddBtn');
  const kwTags       = document.getElementById('kwTags');
  const kwCounter    = document.getElementById('kwCounter');
  const sidebarBtn   = document.getElementById('sidebarBtn');
  const openaiKeyInput = document.getElementById('openaiKeyInput');
  const openaiKeySave  = document.getElementById('openaiKeySave');

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

  sidebarBtn.addEventListener('click', () => {
    chrome.windows.getCurrent((win) => {
      chrome.sidePanel.open({ windowId: win.id });
    });
  });

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
        searchBtn.style.display = 'none';
        searchBtn.disabled = true;
        stopBtn.style.display = 'flex';
        viewBtn.disabled = true;
      } else if (stats.status === 'done') {
        progressText.textContent = `Complete — ${stats.found} found`;
        searchBtn.style.display = 'flex';
        searchBtn.disabled = false;
        stopBtn.style.display = 'none';
        viewBtn.disabled = false;
        chrome.storage.local.remove('discordFinderActiveTabId');
      } else if (stats.status === 'idle' && stats.searched > 0) {
        progressText.textContent = 'Ready to search again';
        searchBtn.style.display = 'flex';
        searchBtn.disabled = false;
        stopBtn.style.display = 'none';
        viewBtn.disabled   = results.length === 0;
      } else {
        progressText.textContent = 'Ready';
        searchBtn.style.display = 'flex';
        searchBtn.disabled = false;
        stopBtn.style.display = 'none';
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

    chrome.storage.local.set({ discordFinderActiveTabId: tab.id });
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

  stopBtn.addEventListener('click', () => {
    chrome.storage.local.get(['discordFinderActiveTabId'], (data) => {
      const tabId = data.discordFinderActiveTabId;
      if (tabId != null) {
        chrome.tabs.sendMessage(tabId, { type: 'ABORT_SEARCH' }).catch(() => {});
        chrome.storage.local.remove('discordFinderActiveTabId');
      }
      progressText.textContent = 'Stopping…';
      stopBtn.style.display = 'none';
      searchBtn.style.display = 'flex';
      searchBtn.disabled = false;
      viewBtn.disabled = true;
    });
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

  // ─── OpenAI API key ──────────────────────────────────────────────────────
  chrome.storage.local.get(['discordFinderOpenAiKey'], (data) => {
    openaiKeyInput.value = data.discordFinderOpenAiKey || '';
  });
  openaiKeySave.addEventListener('click', () => {
    const key = (openaiKeyInput.value || '').trim();
    chrome.storage.local.set({ discordFinderOpenAiKey: key });
    openaiKeySave.textContent = 'Saved';
    setTimeout(() => { openaiKeySave.textContent = 'Save'; }, 1500);
  });

  // ─── Init ────────────────────────────────────────────────────────────────
  loadKeywords();
  renderStats();
})();
