const express = require('express');
const router = express.Router();
const { asyncHandler } = require('../middleware/errorHandler');

router.get('/:shareToken', asyncHandler(async (req, res) => {
  const { shareToken } = req.params;
  const token = req.query.token || '';
  const mode = req.query.mode || 'play'; // play, leaderboard, create

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
    .loading{display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:80vh;gap:16px}
    .spinner{width:32px;height:32px;border:3px solid #222;border-top-color:#9333ea;border-radius:50%;animation:spin .8s linear infinite}
    @keyframes spin{to{transform:rotate(360deg)}}

    /* Name input */
    .name-screen{text-align:center;padding:40px 16px}
    .name-screen h1{font-size:22px;margin-bottom:8px}
    .name-screen p{color:#888;font-size:14px;margin-bottom:24px}
    .name-input{width:100%;background:#111;border:1px solid #222;border-radius:12px;padding:14px;color:#fff;font-size:16px;text-align:center;outline:none}
    .name-input:focus{border-color:#9333ea}
    .btn{background:#9333ea;color:#fff;border:none;padding:14px 24px;border-radius:12px;font-size:16px;font-weight:600;cursor:pointer;width:100%;margin-top:16px}
    .btn:active{opacity:.8}
    .btn:disabled{background:#333;color:#666}
    .btn-outline{background:transparent;border:1px solid #333;color:#888}

    /* Leaderboard */
    .lb{margin-top:20px}
    .lb h2{font-size:18px;margin-bottom:12px;display:flex;align-items:center;gap:8px}
    .lb-row{display:flex;align-items:center;padding:12px;background:#111;border:1px solid #222;border-radius:10px;margin-bottom:6px}
    .lb-rank{width:32px;height:32px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:14px;margin-right:12px}
    .lb-rank.gold{background:#fbbf24;color:#000}
    .lb-rank.silver{background:#94a3b8;color:#000}
    .lb-rank.bronze{background:#d97706;color:#000}
    .lb-rank.other{background:#222;color:#888}
    .lb-name{flex:1;font-weight:600;font-size:14px}
    .lb-score{font-size:16px;font-weight:700;color:#9333ea;margin-right:12px}
    .lb-time{font-size:12px;color:#666}
    .lb-empty{text-align:center;padding:24px;color:#555;font-size:14px}
    .challenge-meta{text-align:center;padding:16px;background:#111;border:1px solid #222;border-radius:12px;margin-bottom:16px}
    .challenge-meta h1{font-size:20px;margin-bottom:4px}
    .challenge-meta p{font-size:13px;color:#888}

    /* Game iframe */
    .game-frame{width:100%;border:none;border-radius:12px;background:#111}
    .game-container{display:flex;flex-direction:column;height:100vh}
    .game-header{display:flex;justify-content:space-between;align-items:center;padding:8px 16px;background:#111;border-bottom:1px solid #222}
    .game-header span{font-size:13px;color:#888}

    .tab-bar{display:flex;border-bottom:1px solid #222;margin-bottom:16px}
    .tab{flex:1;text-align:center;padding:12px;font-size:14px;font-weight:600;color:#666;cursor:pointer;border-bottom:2px solid transparent}
    .tab.active{color:#9333ea;border-bottom-color:#9333ea}
  </style>
</head>
<body>
  <div id="app" class="container"></div>
  <script>
    const API = 'https://ai-notetaker-backend.fly.dev';
    const SHARE_TOKEN = '${shareToken}';
    const AUTH_TOKEN = '${token}';
    const MODE = '${mode}';
    let challenge = null;
    let leaderboard = [];
    let playerName = localStorage.getItem('compete_name') || '';
    let currentView = MODE === 'leaderboard' ? 'leaderboard' : 'name';

    async function fetchChallenge() {
      try {
        const res = await fetch(API + '/api/compete/challenge/' + SHARE_TOKEN);
        const json = await res.json();
        if (json.success) {
          challenge = json.data.challenge;
          leaderboard = json.data.leaderboard;
          if (currentView === 'name') showNameScreen();
          else showLeaderboard();
        } else {
          showError(json.error || 'Challenge not found');
        }
      } catch (e) { showError('Connection error'); }
    }

    function showNameScreen() {
      currentView = 'name';
      document.getElementById('app').innerHTML =
        '<div class="name-screen">' +
          '<div style="font-size:48px;margin-bottom:16px">🏆</div>' +
          '<h1>' + (challenge ? challenge.title : 'Challenge') + '</h1>' +
          '<p>' + (challenge ? challenge.challenge_type.replace('_',' ') + ' • ' + challenge.total_questions + ' questions' : '') + '</p>' +
          '<input class="name-input" id="nameInput" placeholder="Enter your name" value="' + playerName + '" maxlength="50" />' +
          '<button class="btn" id="startBtn" onclick="startChallenge()">Start Challenge</button>' +
          '<button class="btn btn-outline" style="margin-top:8px" onclick="showLeaderboard()">View Leaderboard (' + leaderboard.length + ')</button>' +
        '</div>';
      document.getElementById('nameInput').focus();
    }

    function startChallenge() {
      const name = document.getElementById('nameInput').value.trim();
      if (!name) { document.getElementById('nameInput').style.borderColor = '#ef4444'; return; }
      playerName = name;
      localStorage.setItem('compete_name', name);
      loadGame();
    }

    async function loadGame() {
      document.getElementById('app').innerHTML = '<div class="loading"><div class="spinner"></div><p style="color:#888">Loading challenge...</p></div>';

      try {
        const res = await fetch(API + '/api/compete/challenge/' + SHARE_TOKEN + '/content');
        const json = await res.json();
        if (!json.success) { showError('Failed to load challenge'); return; }

        // Inject bridge
        let gameHtml = json.data.html;
        const bridge = '<script>window.ScribeCompete={submitScore:function(c,t,s){window.parent.postMessage({type:"compete_score",correct:c,total:t,time:s},"*")},showLeaderboard:function(){window.parent.postMessage({type:"compete_leaderboard"},"*")},shareChallenge:function(){window.parent.postMessage({type:"compete_share"},"*")}}<\\/script>';
        gameHtml = gameHtml.includes('</head>') ? gameHtml.replace('</head>', bridge + '</head>') : bridge + gameHtml;

        const blob = new Blob([gameHtml], { type: 'text/html' });
        const url = URL.createObjectURL(blob);

        document.getElementById('app').className = '';
        document.getElementById('app').innerHTML =
          '<div class="game-container">' +
            '<div class="game-header"><span>' + playerName + '</span><span>' + (challenge ? challenge.title : '') + '</span></div>' +
            '<iframe class="game-frame" src="' + url + '" sandbox="allow-scripts" style="flex:1;height:' + (window.innerHeight - 50) + 'px"></iframe>' +
          '</div>';

        window.onmessage = function(e) {
          if (e.data?.type === 'compete_score') submitScore(e.data.correct, e.data.total, e.data.time);
          if (e.data?.type === 'compete_leaderboard') showLeaderboard();
          if (e.data?.type === 'compete_share') shareLink();
        };
      } catch (e) { showError('Failed to load: ' + e.message); }
    }

    async function submitScore(correct, total, timeSeconds) {
      document.getElementById('app').className = 'container';
      document.getElementById('app').innerHTML = '<div class="loading"><div class="spinner"></div><p style="color:#888">Submitting score...</p></div>';

      try {
        const res = await fetch(API + '/api/compete/challenge/' + SHARE_TOKEN + '/submit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ displayName: playerName, correct, total, timeSeconds })
        });
        const json = await res.json();
        if (json.success) {
          leaderboard = json.data.leaderboard;
          showResults(correct, total, timeSeconds, json.data.rank);
        } else { showLeaderboard(); }
      } catch (e) { showLeaderboard(); }
    }

    function showResults(correct, total, timeSeconds, rank) {
      const pct = total > 0 ? Math.round(correct / total * 100) : 0;
      const emoji = pct >= 90 ? '🎉' : pct >= 70 ? '🔥' : pct >= 50 ? '💪' : '📚';

      document.getElementById('app').className = 'container';
      document.getElementById('app').innerHTML =
        '<div style="text-align:center;padding:24px 0">' +
          '<div style="font-size:56px">' + emoji + '</div>' +
          '<h1 style="font-size:28px;margin:8px 0">' + pct + '%</h1>' +
          '<p style="color:#888;font-size:14px">' + correct + '/' + total + ' correct • ' + timeSeconds + 's</p>' +
          '<div style="background:#111;border:1px solid #222;border-radius:12px;padding:16px;margin:20px 0;display:inline-block">' +
            '<span style="font-size:14px;color:#888">Your Rank</span><br>' +
            '<span style="font-size:32px;font-weight:700;color:#9333ea">#' + rank + '</span>' +
            '<span style="font-size:14px;color:#666"> of ' + leaderboard.length + '</span>' +
          '</div>' +
        '</div>' +
        '<button class="btn" onclick="showLeaderboard()">🏆 View Leaderboard</button>' +
        '<button class="btn btn-outline" style="margin-top:8px" onclick="shareLink()">📤 Share Challenge</button>' +
        '<button class="btn btn-outline" style="margin-top:8px" onclick="loadGame()">🔄 Play Again</button>';
    }

    function showLeaderboard() {
      currentView = 'leaderboard';
      document.getElementById('app').className = 'container';

      let lbHtml = '';
      if (leaderboard.length === 0) {
        lbHtml = '<div class="lb-empty">No one has completed this challenge yet. Be the first!</div>';
      } else {
        lbHtml = leaderboard.map((p, i) => {
          const rankClass = i === 0 ? 'gold' : i === 1 ? 'silver' : i === 2 ? 'bronze' : 'other';
          const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : (i + 1);
          const pct = p.total_questions > 0 ? Math.round(p.score * 100) : 0;
          return '<div class="lb-row">' +
            '<div class="lb-rank ' + rankClass + '">' + medal + '</div>' +
            '<div class="lb-name">' + p.display_name + '</div>' +
            '<div class="lb-score">' + pct + '%</div>' +
            '<div class="lb-time">' + (p.time_spent_seconds || 0) + 's</div>' +
          '</div>';
        }).join('');
      }

      document.getElementById('app').innerHTML =
        (challenge ? '<div class="challenge-meta"><h1>' + challenge.title + '</h1><p>' + challenge.challenge_type.replace('_',' ') + ' • ' + challenge.total_questions + ' questions • ' + leaderboard.length + ' players</p></div>' : '') +
        '<div class="lb"><h2>🏆 Leaderboard</h2>' + lbHtml + '</div>' +
        '<button class="btn" style="margin-top:16px" onclick="showNameScreen()">Play Challenge</button>' +
        '<button class="btn btn-outline" style="margin-top:8px" onclick="shareLink()">📤 Share with Friends</button>';
    }

    function shareLink() {
      const url = window.location.href.split('?')[0];
      if (navigator.share) {
        navigator.share({ title: challenge ? challenge.title : 'Challenge', text: 'Can you beat my score?', url });
      } else {
        navigator.clipboard.writeText(url).then(() => alert('Link copied!'));
      }
    }

    function showError(msg) {
      document.getElementById('app').innerHTML = '<div class="loading"><div style="font-size:48px;margin-bottom:16px">⚠️</div><p style="color:#888">' + msg + '</p><button class="btn" style="max-width:200px;margin-top:16px" onclick="location.reload()">Retry</button></div>';
    }

    fetchChallenge();
  </script>
</body>
</html>`;

  res.setHeader('Content-Type', 'text/html');
  res.send(html);
}));

module.exports = router;
