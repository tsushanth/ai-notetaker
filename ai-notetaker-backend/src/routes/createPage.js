const express = require('express');
const router = express.Router();
const { asyncHandler } = require('../middleware/errorHandler');

router.get('/:noteId', asyncHandler(async (req, res) => {
  const { noteId } = req.params;
  const token = req.query.token || '';

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
  <title>Scribe AI - Create</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { background: #0a0a0b; color: #fff; font-family: -apple-system, BlinkMacSystemFont, system-ui, sans-serif; min-height: 100vh; }
    .container { max-width: 600px; margin: 0 auto; padding: 16px; }
    .header { text-align: center; padding: 24px 0 20px; }
    .header-icon { font-size: 40px; margin-bottom: 12px; }
    .header h1 { font-size: 22px; font-weight: 700; margin-bottom: 6px; }
    .header p { font-size: 13px; color: #888; }

    .suggestions { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 20px; }
    .chip { background: #111; border: 1px solid #222; border-radius: 20px; padding: 8px 14px; font-size: 13px; color: #a855f7; cursor: pointer; transition: all 0.2s; }
    .chip:active { background: #1a1a2e; border-color: #9333ea; }

    .input-area { position: relative; margin-bottom: 16px; }
    .input-area textarea { width: 100%; background: #111; border: 1px solid #222; border-radius: 16px; padding: 16px; padding-right: 56px; color: #fff; font-size: 15px; font-family: inherit; resize: none; min-height: 56px; max-height: 120px; outline: none; }
    .input-area textarea:focus { border-color: #9333ea; }
    .input-area textarea::placeholder { color: #555; }
    .send-btn { position: absolute; right: 8px; bottom: 8px; width: 40px; height: 40px; border-radius: 20px; background: #9333ea; border: none; color: #fff; font-size: 18px; cursor: pointer; display: flex; align-items: center; justify-content: center; }
    .send-btn:disabled { background: #333; color: #666; }

    .generating { text-align: center; padding: 60px 20px; }
    .spinner { width: 40px; height: 40px; border: 3px solid #222; border-top-color: #9333ea; border-radius: 50%; animation: spin 0.8s linear infinite; margin: 0 auto 20px; }
    @keyframes spin { to { transform: rotate(360deg); } }

    .result-frame { width: 100%; border: none; border-radius: 12px; background: #111; min-height: 400px; }
    .result-header { display: flex; justify-content: space-between; align-items: center; padding: 12px 0; }
    .back-btn { background: none; border: 1px solid #333; border-radius: 8px; color: #888; padding: 6px 14px; font-size: 13px; cursor: pointer; }
    .back-btn:active { background: #111; }

    .error { background: #1a0a0a; border: 1px solid #441111; border-radius: 12px; padding: 16px; margin: 16px 0; color: #ff6b6b; font-size: 14px; }

    .history { margin-top: 24px; }
    .history h3 { font-size: 14px; color: #666; margin-bottom: 12px; }
    .history-item { background: #111; border: 1px solid #222; border-radius: 12px; padding: 14px; margin-bottom: 8px; cursor: pointer; }
    .history-item:active { background: #1a1a2e; }
    .history-item .prompt-text { font-size: 14px; color: #ccc; }
    .history-item .time-text { font-size: 11px; color: #555; margin-top: 4px; }
  </style>
</head>
<body>
  <div id="app" class="container"></div>
  <script>
    const API = 'https://ai-notetaker-backend-917362189743.us-central1.run.app';
    const NOTE_ID = '${noteId}';
    const TOKEN = '${token}';
    let createdItems = JSON.parse(localStorage.getItem('create_history_' + NOTE_ID) || '[]');

    const suggestions = [
      { emoji: '📋', text: 'Study guide' },
      { emoji: '📝', text: 'Cheat sheet' },
      { emoji: '🎵', text: 'Memory song' },
      { emoji: '📊', text: 'Comparison table' },
      { emoji: '🗺️', text: 'Concept map' },
      { emoji: '✍️', text: 'Practice problems' },
      { emoji: '📖', text: 'ELI5 explanation' },
      { emoji: '🎯', text: 'Key takeaways' },
      { emoji: '⏰', text: 'Timeline' },
      { emoji: '🃏', text: 'Memory tricks' },
    ];

    function showHome() {
      const chipsHtml = suggestions.map(s =>
        '<div class="chip" onclick="quickCreate(\\'' + s.text + '\\')">' + s.emoji + ' ' + s.text + '</div>'
      ).join('');

      let historyHtml = '';
      if (createdItems.length > 0) {
        historyHtml = '<div class="history"><h3>Recent creations</h3>' +
          createdItems.slice(0, 5).map((item, i) =>
            '<div class="history-item" onclick="showResult(' + i + ')"><div class="prompt-text">' + item.prompt + '</div><div class="time-text">' + new Date(item.time).toLocaleString() + '</div></div>'
          ).join('') + '</div>';
      }

      document.getElementById('app').innerHTML =
        '<div class="header"><div class="header-icon">✨</div><h1>Create Anything</h1><p>Describe what you want to create from your notes</p></div>' +
        '<div class="suggestions">' + chipsHtml + '</div>' +
        '<div class="input-area"><textarea id="promptInput" placeholder="Or type your own request..." rows="2" oninput="autoResize(this)" onkeydown="if(event.key===\\'Enter\\'&&!event.shiftKey){event.preventDefault();generate();}"></textarea><button class="send-btn" id="sendBtn" onclick="generate()">→</button></div>' +
        historyHtml;
    }

    function quickCreate(text) {
      generate(text);
    }

    function autoResize(el) {
      el.style.height = 'auto';
      el.style.height = Math.min(el.scrollHeight, 120) + 'px';
    }

    async function generate(directPrompt) {
      const prompt = directPrompt || (document.getElementById('promptInput')?.value || '').trim();
      if (!prompt) return;
      // Dismiss keyboard
      if (document.activeElement) document.activeElement.blur();

      document.getElementById('app').innerHTML =
        '<div class="generating"><div class="spinner"></div><h2 style="font-size:18px;margin-bottom:8px">Creating...</h2><p style="color:#888;font-size:14px">"' + prompt.substring(0, 60) + (prompt.length > 60 ? '...' : '') + '"</p><p style="color:#555;font-size:12px;margin-top:16px">This may take 30-60 seconds</p></div>';

      try {
        const res = await fetch(API + '/api/create/' + NOTE_ID, {
          method: 'POST',
          headers: { 'Authorization': 'Bearer ' + TOKEN, 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt })
        });
        if (res.status === 401) {
          showTokenExpired();
          return;
        }
        const json = await res.json();

        if (!json.success) {
          if (json.error && json.error.toLowerCase().includes('expired')) {
            showTokenExpired();
          } else {
            showError(json.error || 'Failed to create content');
          }
          return;
        }

        // Save to history
        createdItems.unshift({ prompt, html: json.data.html, time: Date.now() });
        if (createdItems.length > 10) createdItems = createdItems.slice(0, 10);
        localStorage.setItem('create_history_' + NOTE_ID, JSON.stringify(createdItems));

        renderResult(json.data.html, prompt);
      } catch (e) {
        showError('Connection error: ' + e.message);
      }
    }

    function showResult(index) {
      const item = createdItems[index];
      if (item) renderResult(item.html, item.prompt);
    }

    function renderResult(html, prompt) {
      const blob = new Blob([html], { type: 'text/html' });
      const url = URL.createObjectURL(blob);

      document.getElementById('app').innerHTML =
        '<div class="result-header"><button class="back-btn" onclick="showHome()">← Back</button><span style="font-size:13px;color:#888">' + prompt.substring(0, 30) + '</span></div>' +
        '<iframe class="result-frame" src="' + url + '" sandbox="allow-scripts" style="height:' + (window.innerHeight - 80) + 'px"></iframe>';
    }

    function showTokenExpired() {
      document.getElementById('app').innerHTML =
        '<div class="generating">' +
          '<div style="font-size:48px;margin-bottom:16px">🔑</div>' +
          '<h2 style="font-size:18px;margin-bottom:8px">Session Expired</h2>' +
          '<p style="color:#888;font-size:14px;margin-bottom:24px">Please go back to Notes and open this tab again to refresh your session.</p>' +
        '</div>';
    }

    function showError(msg) {
      document.getElementById('app').innerHTML =
        '<div class="generating"><div class="error">' + msg + '</div><button class="back-btn" onclick="showHome()" style="margin-top:16px">← Try again</button></div>';
    }

    showHome();
  </script>
</body>
</html>`;

  res.setHeader('Content-Type', 'text/html');
  res.send(html);
}));

module.exports = router;
