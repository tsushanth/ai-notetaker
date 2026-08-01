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
  <title>Scribe AI - Compete</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{background:#0a0a0b;color:#fff;font-family:-apple-system,BlinkMacSystemFont,system-ui,sans-serif;min-height:100vh}
    .container{max-width:600px;margin:0 auto;padding:16px}
    .spinner{width:32px;height:32px;border:3px solid #222;border-top-color:#9333ea;border-radius:50%;animation:spin .8s linear infinite;margin:0 auto}
    @keyframes spin{to{transform:rotate(360deg)}}
    .header{text-align:center;padding:32px 0 24px}
    .header-icon{font-size:48px;margin-bottom:12px}
    .header h1{font-size:22px;font-weight:700;margin-bottom:6px}
    .header p{font-size:13px;color:#888}
    .types{display:flex;flex-wrap:wrap;gap:10px;justify-content:center;margin:20px 0}
    .type-card{width:100px;padding:14px 8px;background:#111;border:1px solid #222;border-radius:12px;text-align:center;cursor:pointer;transition:all .2s}
    .type-card.selected{background:rgba(147,51,234,.15);border-color:#9333ea}
    .type-card:active{transform:scale(.95)}
    .type-emoji{font-size:28px;margin-bottom:6px}
    .type-label{font-size:12px;font-weight:600}
    .btn{background:#9333ea;color:#fff;border:none;padding:14px;border-radius:12px;font-size:16px;font-weight:600;cursor:pointer;width:100%;margin-top:16px}
    .btn:active{opacity:.8}
    .btn:disabled{background:#333;color:#666}
    .btn-outline{background:transparent;border:1px solid #333;color:#888}
    .generating{text-align:center;padding:48px 16px}
    .generating h2{font-size:18px;margin:16px 0 8px}
    .generating p{font-size:13px;color:#888}
    .error{background:#1a0a0a;border:1px solid #441111;border-radius:12px;padding:16px;color:#ff6b6b;font-size:14px;margin:16px 0}
    .challenges-list{margin-top:24px}
    .challenges-list h3{font-size:14px;color:#666;margin-bottom:12px}
    .challenge-item{background:#111;border:1px solid #222;border-radius:12px;padding:14px;margin-bottom:8px;cursor:pointer;display:flex;justify-content:space-between;align-items:center}
    .challenge-item:active{background:#1a1a2e}
    .challenge-title{font-size:14px;font-weight:600}
    .challenge-meta{font-size:11px;color:#666;margin-top:4px}
    .challenge-players{font-size:13px;color:#9333ea;font-weight:600}
  </style>
</head>
<body>
  <div id="app" class="container"></div>
  <script>
    const API = 'https://ai-notetaker-backend.fly.dev';
    const NOTE_ID = '${noteId}';
    const TOKEN = '${token}';
    let selectedType = 'quiz';
    let myChallenges = [];

    const types = [
      {id:'quiz',emoji:'📝',label:'Quiz'},
      {id:'speed_round',emoji:'⚡',label:'Speed Round'},
      {id:'true_false',emoji:'✅',label:'True / False'},
      {id:'memory_game',emoji:'🧠',label:'Memory'},
      {id:'word_scramble',emoji:'🔤',label:'Scramble'}
    ];

    function showHome() {
      const typesHtml = types.map(t =>
        '<div class="type-card' + (selectedType===t.id?' selected':'') + '" onclick="selectType(\\'' + t.id + '\\')">' +
          '<div class="type-emoji">' + t.emoji + '</div>' +
          '<div class="type-label">' + t.label + '</div>' +
        '</div>'
      ).join('');

      let listHtml = '';
      if (myChallenges.length > 0) {
        listHtml = '<div class="challenges-list"><h3>Your Challenges</h3>' +
          myChallenges.map(c =>
            '<div class="challenge-item" onclick="openChallenge(\\'' + c.share_token + '\\')">' +
              '<div><div class="challenge-title">' + c.title + '</div>' +
              '<div class="challenge-meta">' + c.challenge_type.replace('_',' ') + ' • ' + c.total_questions + ' questions</div></div>' +
              '<div class="challenge-players">' + (c.participantCount||0) + ' played</div>' +
            '</div>'
          ).join('') + '</div>';
      }

      document.getElementById('app').innerHTML =
        '<div class="header"><div class="header-icon">🏆</div><h1>Compete</h1><p>Create a challenge and share with friends</p></div>' +
        '<div class="types">' + typesHtml + '</div>' +
        '<button class="btn" onclick="createChallenge()">⚡ Create Challenge</button>' +
        listHtml;

      loadMyChallenges();
    }

    function selectType(type) {
      selectedType = type;
      showHome();
    }

    async function loadMyChallenges() {
      try {
        const res = await fetch(API + '/api/compete/my-challenges', {
          headers: { 'Authorization': 'Bearer ' + TOKEN }
        });
        const json = await res.json();
        if (json.success && json.data.length > 0) {
          myChallenges = json.data;
          // Re-render list only if we have data now
          const listEl = document.querySelector('.challenges-list');
          if (!listEl && myChallenges.length > 0) showHome();
        }
      } catch(e) {}
    }

    async function createChallenge() {
      document.getElementById('app').innerHTML =
        '<div class="generating"><div class="spinner"></div><h2>Creating Challenge...</h2><p>AI is generating questions from your notes</p><p style="color:#555;margin-top:16px">This takes 30-60 seconds</p></div>';

      try {
        const res = await fetch(API + '/api/compete/' + NOTE_ID + '/create', {
          method: 'POST',
          headers: { 'Authorization': 'Bearer ' + TOKEN, 'Content-Type': 'application/json' },
          body: JSON.stringify({ challengeType: selectedType, numQuestions: 10 })
        });
        const json = await res.json();

        if (res.status === 401 || (json.error && json.error.toLowerCase().includes('expired'))) {
          document.getElementById('app').innerHTML =
            '<div class="generating"><div style="font-size:48px;margin-bottom:16px">🔑</div><h2 style="font-size:18px;margin-bottom:8px">Session Expired</h2><p style="color:#888;font-size:14px">Please go back to Notes and open this tab again.</p></div>';
          return;
        }
        if (json.success) {
          const shareUrl = json.data.shareUrl;
          try { await navigator.clipboard.writeText(shareUrl); } catch(e) {}
          window.location.href = API + '/compete/' + json.data.shareToken + '?token=' + TOKEN;
        } else {
          document.getElementById('app').innerHTML =
            '<div class="generating"><div class="error">' + (json.error || 'Failed to create challenge') + '</div>' +
            '<button class="btn" onclick="showHome()" style="max-width:200px;margin:16px auto">← Try Again</button></div>';
        }
      } catch (e) {
        document.getElementById('app').innerHTML =
          '<div class="generating"><div class="error">Connection error: ' + e.message + '</div>' +
          '<button class="btn" onclick="showHome()" style="max-width:200px;margin:16px auto">← Try Again</button></div>';
      }
    }

    function openChallenge(shareToken) {
      window.location.href = API + '/compete/' + shareToken + '?token=' + TOKEN;
    }

    showHome();
  </script>
</body>
</html>`;

  res.setHeader('Content-Type', 'text/html');
  res.send(html);
}));

module.exports = router;
