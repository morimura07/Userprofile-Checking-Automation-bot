chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type !== 'START_SEARCH' || msg.tabId == null) {
    sendResponse({ ok: false, error: 'Missing tabId' });
    return true;
  }
  const tabId = msg.tabId;
  const target = { tabId, allFrames: true };

  chrome.scripting.executeScript({ target, files: ['content/content.js'] })
    .then(() => chrome.scripting.insertCSS({ target, files: ['content/content.css'] }))
    .then(() => new Promise((r) => setTimeout(r, 1200)))
    .then(() => chrome.tabs.sendMessage(tabId, { type: 'START_SEARCH' }))
    .then(() => sendResponse({ ok: true }))
    .catch((err) => {
      const msg = err?.message || String(err);
      console.error('Discord Profile Finder:', err);
      sendResponse({ ok: false, error: msg });
    });
  return true;
});
