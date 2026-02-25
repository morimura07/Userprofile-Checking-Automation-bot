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

  // Adaptive timing — polling replaces most fixed sleeps for speed
  const D = {
    afterScroll:    180,   // ms after scrolling to row before clicking
    profileLoad:   2200,   // max ms to wait for username el to appear (adaptive)
    extraLoad:      150,   // small extra ms after username el found (bio needs time)
    betweenUsers:   350,   // ms after panel closes before next user
    scrollPause:    300,   // ms pause while pre-scanning member list
    panelTimeout:  3000,   // max ms waiting for panel to open
    closeTimeout:  1800,   // max ms waiting for panel to close
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

  function scrollContainer(container) {
    const sp = container.closest('[class*="scroll"]') || container.parentElement;
    if (sp) sp.scrollTop = sp.scrollHeight;
  }

  async function collectAllMemberRows(container) {
    const seen = new Set();
    const collected = [];
    let stable = 0;
    let lastCount = 0;

    while (stable < 3) {
      for (const row of getMemberRows(container)) {
        const key = row.getAttribute('data-list-item-id') || row.textContent.slice(0, 50);
        if (key && !seen.has(key)) { seen.add(key); collected.push(row); }
      }
      if (collected.length === lastCount) stable++;
      else stable = 0;
      lastCount = collected.length;
      scrollContainer(container);
      await sleep(D.scrollPause);
    }
    return collected;
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

  // Display Name: extracted from the dialog aria-label "[Name]'s profile"
  // Discord may use a curly apostrophe (') instead of straight (')
  function extractDisplayName(panel) {
    const label = panel.getAttribute('aria-label') || '';
    // Match any apostrophe variant before "s profile"
    const m = label.match(/^(.+?)[\u2019\u2018\u02BC']s\s+profile\s*$/i);
    if (m) return m[1].trim();

    // Fallback A: strip the " profile" tail any way it comes
    if (/\s+profile\s*$/i.test(label)) {
      return label.replace(/[\u2019\u2018\u02BC']s\s+profile\s*$/i, '')
                  .replace(/\s+profile\s*$/i, '').trim();
    }

    // Fallback B: "Message @DisplayName" placeholder or aria-label on the message box
    const msgEl = panel.querySelector(
      '[placeholder*="Message @"], [aria-label*="Message @"]'
    );
    if (msgEl) {
      const attr = msgEl.getAttribute('placeholder') || msgEl.getAttribute('aria-label') || '';
      const pm = attr.match(/Message\s+@(.+)/i);
      if (pm) return pm[1].trim();
    }

    // Fallback C: first h1/h2 that is not "Bio" and doesn't end with "profile"
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

    const rows = await collectAllMemberRows(container);
    await setStats({ total: rows.length });

    const results = [];
    let searched  = 0;

    for (let i = 0; i < rows.length && !abortRequested; i++) {
      // ── Step 1: Ensure any open panel is closed first ──────────────────
      if (getProfilePanel()) {
        dismissPanel();
        await waitForPanelGone();
      }

      // ── Step 2: Scroll to the member row and click it ──────────────────
      const row = rows[i];
      row.scrollIntoView({ block: 'nearest', behavior: 'auto' });
      await sleep(D.afterScroll);
      row.click();

      // ── Step 3: Wait for the profile panel to appear ───────────────────
      const panel = await waitForPanel();
      if (!panel) {
        searched++;
        await setStats({ searched });
        continue;
      }

      // ── Step 4: Adaptive wait — poll until username element is present ─
      await waitForProfileContent(panel);
      await sleep(D.extraLoad); // tiny buffer for bio to render

      const loaded = getProfilePanel();
      if (!loaded) {
        searched++;
        await setStats({ searched });
        continue;
      }

      // ── Step 5: Check for keyword matches ─────────────────────────────
      const text    = (loaded.innerText || loaded.textContent || '').trim();
      const matched = matchKeyword(text, keywords);

      if (matched) {
        const displayName = extractDisplayName(loaded);
        const username    = extractUsername(loaded, displayName);
        const bio         = extractBio(loaded);

        results.push({
          displayName:    displayName || 'Unknown',
          username:       username    || '—',
          jobTitle:       matched,
          profileSnippet: bio         || '—',
        });
        await setStats({ found: results.length });
        await chrome.storage.local.set({ discordFinderResults: [...results] });
      }

      // ── Step 6: Close panel and wait for it to fully disappear ─────────
      dismissPanel();
      await waitForPanelGone();
      await sleep(D.betweenUsers);

      searched++;
      await setStats({ searched });
    }

    await setStats({ status: 'done' });
    isRunning = false;
  }
})();
