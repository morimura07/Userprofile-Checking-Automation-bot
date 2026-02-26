(function () {
  // ─── GUARD ────────────────────────────────────────────────────────────────
  // With all_frames:true the script loads in every frame.
  // Only the frame that has #app-mount should run the search.
  function hasAppMount() {
    return !!document.getElementById('app-mount');
  }

  // Register listener FIRST so Chrome can always reach us
  chrome.runtime.onMessage.addListener(function (msg, _sender, sendResponse) {
    if (msg.type === 'START_SEARCH') {
      if (!hasAppMount()) {
        sendResponse({ ok: false, error: 'not app frame' });
        return true;
      }
      const kw = (msg.keywords && msg.keywords.length > 0) ? msg.keywords : DEFAULT_KEYWORDS;
      runSearch(kw).catch(console.error);
      sendResponse({ ok: true });
    } else if (msg.type === 'ABORT_SEARCH') {
      abortRequested = true;
      sendResponse({ ok: true });
    }
    return true;
  });

  // ─── CONSTANTS ────────────────────────────────────────────────────────────
  const DEFAULT_KEYWORDS = [
    'CEO', 'Founder', 'CO-Founder', 'Co-Founder',
    'Project Manager', 'CTO', 'Looking for Developer',
  ];

  // Timing — same fast path for all users (no extra wait for no-bio)
  const D = {
    afterScroll:      180,   // ms after scrolling to row before clicking
    profileLoad:     2200,   // max ms to wait for username el to appear
    extraLoad:        250,   // ms after username before reading panel (lets bio appear if present)
    betweenUsers:     350,   // ms after panel closes before next user
    scrollStep:       200,   // px to scroll member list to reveal next batch (virtualized list)
    afterScrollStep:  280,   // ms after scrolling before reading new rows
    panelTimeout:    3000,   // max ms waiting for panel to open
    closeTimeout:    1800,   // max ms waiting for panel to close
  };

  let isRunning     = false;
  let abortRequested = false;

  // ─── HELPERS ──────────────────────────────────────────────────────────────
  function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

  function setStats(update) {
    return new Promise((resolve) => {
      chrome.storage.local.get(['discordFinderStats'], (data) => {
        const prev = data.discordFinderStats || { searched: 0, total: 0, found: 0, status: 'idle' };
        chrome.storage.local.set({ discordFinderStats: { ...prev, ...update } }, resolve);
      });
    });
  }

  // Simulate a real user click: full mouse sequence + coordinates from element center
  function simulateHumanClick(element) {
    const rect = element.getBoundingClientRect();
    const clientX = rect.left + rect.width / 2;
    const clientY = rect.top + rect.height / 2;
    const opts = {
      view: window,
      bubbles: true,
      cancelable: true,
      buttons: 1,
      button: 0,
      clientX,
      clientY,
      screenX: clientX + (window.screenX || 0),
      screenY: clientY + (window.screenY || 0),
    };
    element.dispatchEvent(new MouseEvent('mousedown', opts));
    element.dispatchEvent(new MouseEvent('mouseup', opts));
    element.dispatchEvent(new MouseEvent('click', opts));
  }

  // ─── MEMBER LIST ─────────────────────────────────────────────────────────
  function getMemberListContainer() {
    const app = document.getElementById('app-mount');
    if (!app) return null;

    const byId = app.querySelector('[data-list-id="members"]');
    if (byId) return byId;

    for (const el of app.querySelectorAll('[data-list-id]')) {
      if ((el.getAttribute('data-list-id') || '').toLowerCase().includes('member')) return el;
    }

    const sidebar = app.querySelector('[class*="membersWrap"], [class*="membersList"], [class*="members"]');
    if (sidebar) return sidebar.querySelector('[role="list"]') || sidebar;

    return null;
  }

  function getMemberRows(container) {
    if (!container) return [];
    const byItemId = container.querySelectorAll('[data-list-item-id^="members-"]');
    if (byItemId.length > 0) return Array.from(byItemId);
    return Array.from(container.querySelectorAll('[role="listitem"]'));
  }

  function getRowId(row) {
    const id = row.getAttribute('data-list-item-id');
    if (id) return id;
    return (row.textContent || '').slice(0, 80).trim() || null;
  }

  function getScrollParent(container) {
    if (!container) return null;
    let el = container.closest('[class*="scroll"]') || container.parentElement;
    while (el) {
      if (el.scrollHeight > el.clientHeight) return el;
      el = el.parentElement;
    }
    return container.closest('[class*="scroll"]') || container.parentElement;
  }

  function scrollMemberListToTop(container) {
    const sp = getScrollParent(container);
    if (sp) sp.scrollTop = 0;
  }

  function scrollMemberListDown(container, amount) {
    const sp = getScrollParent(container);
    if (!sp) return;
    sp.scrollTop = Math.min(sp.scrollTop + amount, sp.scrollHeight - sp.clientHeight);
  }

  function isMemberListAtBottom(container) {
    const sp = getScrollParent(container);
    if (!sp) return true;
    return sp.scrollTop + sp.clientHeight >= sp.scrollHeight - 2;
  }

  // ─── PROFILE PANEL ───────────────────────────────────────────────────────
  function getProfilePanel() {
    const app = document.getElementById('app-mount');
    if (!app) return null;
    return (
      app.querySelector('[role="dialog"]') ||
      app.querySelector('[class*="userPopout"], [class*="userProfile"]') ||
      null
    );
  }

  function waitForPanel(timeout) {
    const ms = timeout || D.panelTimeout;
    return new Promise((resolve) => {
      const t = Date.now();
      (function check() {
        const p = getProfilePanel();
        if (p) return resolve(p);
        if (Date.now() - t > ms) return resolve(null);
        setTimeout(check, 120);
      })();
    });
  }

  function waitForPanelGone(timeout) {
    const ms = timeout || D.closeTimeout;
    return new Promise((resolve) => {
      const t = Date.now();
      (function check() {
        if (!getProfilePanel()) return resolve();
        if (Date.now() - t > ms) return resolve();
        setTimeout(check, 120);
      })();
    });
  }

  // Wait until the username element is present in the panel (signals content is loaded)
  function waitForProfileContent(panel, timeout) {
    const ms = timeout || D.profileLoad;
    return new Promise((resolve) => {
      const t = Date.now();
      (function check() {
        if (!panel.isConnected) return resolve(false);
        if (panel.querySelector('[class*="userTagUsername"]')) return resolve(true);
        if (Date.now() - t > ms) return resolve(false);
        setTimeout(check, 100);
      })();
    });
  }

  // Escape key is the most reliable way to close any Discord overlay
  function dismissPanel() {
    const app = document.getElementById('app-mount') || document;
    app.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true, cancelable: true }));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true, cancelable: true }));
  }

  // ─── DATA EXTRACTION ─────────────────────────────────────────────────────

  // Display Name: Discord uses a div with class containing "nickname" for the display name
  // (e.g. div.nickname_63ed3 or heading-lg/bold + nickname)
  function extractDisplayName(panel) {
    // Method 1: Discord's nickname element — most reliable (same approach as userTagUsername)
    const nicknameEl = panel.querySelector('[class*="nickname"]');
    if (nicknameEl) {
      const t = (nicknameEl.textContent || '').trim();
      if (t && t.length >= 1 && t.length < 60) return t;
    }

    // Method 2: dialog aria-label "[Name]'s profile" (curly or straight apostrophe)
    const label = panel.getAttribute('aria-label') || '';
    const m = label.match(/^(.+?)[\u2019\u2018\u02BC']s\s+profile\s*$/i);
    if (m) return m[1].trim();
    if (/\s+profile\s*$/i.test(label)) {
      const name = label.replace(/[\u2019\u2018\u02BC']s\s+profile\s*$/i, '').replace(/\s+profile\s*$/i, '').trim();
      if (name) return name;
    }

    // Method 3: "Message @DisplayName" placeholder
    const msgEl = panel.querySelector('[placeholder*="Message @"], [aria-label*="Message @"]');
    if (msgEl) {
      const attr = msgEl.getAttribute('placeholder') || msgEl.getAttribute('aria-label') || '';
      const pm = attr.match(/Message\s+@(.+)/i);
      if (pm) return pm[1].trim();
    }

    // Method 4: first h1/h2 that is not "Bio" and doesn't end with "profile"
    for (const h of panel.querySelectorAll('h1, h2')) {
      const t = (h.textContent || '').trim();
      if (t && t.length < 60 && !/^bio$/i.test(t) && !/profile$/i.test(t)) return t;
    }

    return '';
  }

  // Username (ID): the handle like "free_ground", "juxinal", "morimura012"
  function extractUsername(panel, displayName) {
    // ── Method 1: Discord's username span ────────────────────────────────────
    // DevTools inspection shows the class is "userTagUsername_XXXXX"
    // The prefix "userTagUsername" is stable across Discord updates.
    const usernameSpan = panel.querySelector('[class*="userTagUsername"]');
    if (usernameSpan) {
      const t = (usernameSpan.textContent || '').trim();
      if (t && t.length >= 2 && t.length <= 32) return t;
    }

    // ── Method 2: "Message @handle" input placeholder ────────────────────────
    // Discord sets the message box placeholder to "Message @username"
    const msgEl = panel.querySelector('[placeholder*="Message @"]');
    if (msgEl) {
      const m = (msgEl.getAttribute('placeholder') || '').match(/Message\s+@(.+)/i);
      if (m) return m[1].trim();
    }

    // ── Method 3: TreeWalker fallback (skips role badges, statuses, buttons) ─
    const SKIP = new Set([
      'Friend', 'Add Friend', 'Block', 'Pending', 'Message', 'Incoming',
      'More', 'Open', 'Add', 'Note', 'Send', 'Remove', 'Unblock', 'Call',
      'Video', 'Report', 'Mute', 'Deafen', 'Move', 'Kick', 'Ban',
      'Bio', 'Roles', 'Role', 'Developer', 'Designer', 'Moderator',
    ]);
    const walker = document.createTreeWalker(panel, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const raw = (node.textContent || '').trim();
      const text = raw.replace(/^[·•@\s]+/, '').trim();
      if (!text || text.length < 2 || text.length > 32) continue;
      if (SKIP.has(text)) continue;
      // Exact-case comparison — avoids skipping lowercase handle when displayName is CamelCase
      if (text === displayName) continue;
      if (/^(He|She|They|We|Them|Him|Her)\b/i.test(text)) continue;
      if (/^[a-zA-Z0-9._-]{2,32}$/.test(text)) return text;
    }
    return displayName;
  }

  // Bio: the "About Me" content — lines AFTER the mutual-server header, before action buttons
  function extractBio(panel) {
    if (!panel) return '';

    // Method 1: Discord-specific bio/markup class names
    const bioEl = panel.querySelector(
      '[class*="userBio"], [class*="bio"], [class*="aboutMe"], [class*="markup"]'
    );
    if (bioEl) {
      let t = (bioEl.innerText || bioEl.textContent || '').trim();
      // Strip Discord's section label "Bio" if it appears as the very first word/line
      t = t.replace(/^Bio\s*[\r\n]+/i, '').replace(/^Bio\s{2,}/i, '').trim();
      if (t.length > 5) return t.slice(0, 220);
    }

    // Method 2: Parse the full innerText and extract lines after the header
    const SKIP_LINE = [
      'Open in Mod View', 'Add Note', 'only visible to you',
      'View Full Bio', '+ Add role', 'Message @', 'Add Friend',
      'Block', 'Friend', 'Call', 'Video', 'More', 'Incoming',
    ];
    const fullText = (panel.innerText || '').trim();
    const lines = fullText.split(/\n/).map((l) => l.trim()).filter(Boolean);

    let pastHeader = false;
    const bioLines = [];

    for (const line of lines) {
      if (SKIP_LINE.some((s) => line.includes(s))) continue;
      if (/^(He|She|They|We|Them|Him|Her)\//i.test(line)) continue;
      if (/^Bio\s*$/i.test(line)) continue;       // skip "Bio" section label
      if (/\d+\s+Mutual\s+Server/i.test(line)) { pastHeader = true; continue; }
      if (!pastHeader) continue;
      bioLines.push(line);
      if (bioLines.length >= 6) break;
    }

    return bioLines.join(' ').trim().slice(0, 220);
  }

  // Finds the first matching keyword in text (case-insensitive)
  function matchKeyword(text, keywords) {
    const t = text.toLowerCase();
    return keywords.find((k) => t.includes(k.toLowerCase())) || null;
  }

  // ─── MAIN SEARCH LOOP ────────────────────────────────────────────────────
  async function runSearch(keywords) {
    if (isRunning || !hasAppMount()) return;
    isRunning      = true;
    abortRequested = false;

    await setStats({ searched: 0, total: 0, found: 0, status: 'running' });
    await chrome.storage.local.set({ discordFinderResults: [] });

    const container = getMemberListContainer();
    if (!container) { isRunning = false; return; }

    scrollMemberListToTop(container);
    await sleep(D.afterScrollStep);

    const results = [];
    const processedIds = new Set();
    let searched = 0;

    function processLoadedPanel(loaded) {
      const text = (loaded.innerText || loaded.textContent || '').trim();
      const matched = matchKeyword(text, keywords);
      if (matched) {
        results.push({
          displayName:    extractDisplayName(loaded) || 'Unknown',
          username:       extractUsername(loaded, extractDisplayName(loaded)) || '—',
          jobTitle:       matched,
          profileSnippet: extractBio(loaded) || '—',
        });
        return true;
      }
      return false;
    }

    function openAndWaitForProfile(row) {
      return new Promise((resolve) => {
        (async () => {
          if (getProfilePanel()) { dismissPanel(); await waitForPanelGone(); }
          row.scrollIntoView({ block: 'nearest', behavior: 'auto' });
          await sleep(D.afterScroll);
          simulateHumanClick(row);
          const panel = await waitForPanel();
          if (!panel) return resolve(null);
          await waitForProfileContent(panel);
          await sleep(D.extraLoad);
          resolve(getProfilePanel());
        })();
      });
    }

    // Scroll from top, process each visible member once, then scroll down (single pass)
    while (!abortRequested) {
      const rows = getMemberRows(container);
      let newInThisRound = 0;

      for (const row of rows) {
        if (abortRequested) break;
        const id = getRowId(row);
        if (!id || processedIds.has(id)) continue;

        processedIds.add(id);
        newInThisRound++;
        searched++;

        const loaded = await openAndWaitForProfile(row);

        if (loaded && processLoadedPanel(loaded)) {
          await setStats({ total: processedIds.size, searched, found: results.length });
          await chrome.storage.local.set({ discordFinderResults: [...results] });
        }

        dismissPanel();
        await waitForPanelGone();
        await sleep(D.betweenUsers);
        await setStats({ total: processedIds.size, searched });
      }

      if (isMemberListAtBottom(container) && newInThisRound === 0) break;
      scrollMemberListDown(container, D.scrollStep);
      await sleep(D.afterScrollStep);
    }

    await setStats({ status: 'done' });
    isRunning = false;
  }
})();
