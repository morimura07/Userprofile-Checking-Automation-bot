const OPENAI_SYSTEM_PROMPT = `You are a concise analyst. Given a Discord user's profile (display name, username, bio/role), respond in markdown with these sections only:
1. **Current focus** — What they are likely working on (1–2 sentences).
2. **Likely country/region** — Best guess from profile (one short line).
3. **Current project** — What project or domain they seem focused on (1–2 sentences).
4. **Message for channel** — A short, professional message to post in a Discord channel to get their attention (one paragraph).
5. **How to DM** — Brief tip on how to approach them in a direct message (2–3 sentences).
Keep the whole response clear and under 300 words. Use **bold** for section labels and plain text for content.`;

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'OPENAI_ANALYZE') {
    chrome.storage.local.get(['discordFinderOpenAiKey'], (data) => {
      const apiKey = (data.discordFinderOpenAiKey || '').trim();
      if (!apiKey) {
        sendResponse({ ok: false, error: 'API key not set. Add your OpenAI API key in the extension popup.' });
        return;
      }
      const userContent = [
        'Display name: ' + (msg.displayName || '—'),
        'Username: ' + (msg.username || '—'),
        'Role/title: ' + (msg.jobTitle || '—'),
        'Bio/profile:',
        msg.profileSnippet || '—',
      ].join('\n');

      fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + apiKey,
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [
            { role: 'system', content: OPENAI_SYSTEM_PROMPT },
            { role: 'user', content: userContent },
          ],
          max_tokens: 600,
        }),
      })
        .then((res) => res.json())
        .then((json) => {
          if (json.error) {
            sendResponse({ ok: false, error: json.error.message || JSON.stringify(json.error) });
            return;
          }
          const text = json.choices?.[0]?.message?.content?.trim();
          if (!text) {
            sendResponse({ ok: false, error: 'Empty response from OpenAI' });
            return;
          }
          sendResponse({ ok: true, content: text });
        })
        .catch((err) => {
          sendResponse({ ok: false, error: err.message || 'Network error' });
        });
    });
    return true;
  }

  if (msg.type !== 'START_SEARCH' || msg.tabId == null) {
    sendResponse({ ok: false, error: 'Missing tabId' });
    return true;
  }
  const tabId = msg.tabId;
  const target = { tabId, allFrames: true };

  chrome.scripting.executeScript({ target, files: ['content/content.js'] })
    .then(() => chrome.scripting.insertCSS({ target, files: ['content/content.css'] }))
    .then(() => new Promise((r) => setTimeout(r, 1200)))
    .then(() => chrome.tabs.sendMessage(tabId, { type: 'START_SEARCH', keywords: msg.keywords || [] }))
    .then(() => sendResponse({ ok: true }))
    .catch((err) => {
      const errMsg = err?.message || String(err);
      console.error('Discord Profile Finder:', err);
      sendResponse({ ok: false, error: errMsg });
    });
  return true;
});
