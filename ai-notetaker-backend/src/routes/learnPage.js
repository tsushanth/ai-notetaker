const express = require('express');
const router = express.Router();
const { asyncHandler } = require('../middleware/errorHandler');

/**
 * Serve the learn page HTML directly from the backend
 * This avoids needing to deploy the web app separately
 */
router.get('/:sessionId', (req, res, next) => {
  // Override Helmet CSP for this page — it uses inline scripts
  res.removeHeader('Content-Security-Policy');
  next();
}, asyncHandler(async (req, res) => {
  const { sessionId } = req.params;
  const token = req.query.token || '';

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
  <title>Scribe AI - Learn</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { background: #0a0a0b; color: #fff; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif; min-height: 100vh; }
    .loading { display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 100vh; gap: 16px; }
    .spinner { width: 32px; height: 32px; border: 3px solid #222; border-top-color: #9333ea; border-radius: 50%; animation: spin 0.8s linear infinite; }
    @keyframes spin { to { transform: rotate(360deg); } }
    .text-muted { color: #888; font-size: 14px; }
    .text-primary { color: #fff; }
    .text-purple { color: #9333ea; }
    .error { text-align: center; padding: 32px; }
    .error-icon { font-size: 48px; margin-bottom: 16px; }
    .btn { background: #9333ea; color: #fff; border: none; padding: 12px 24px; border-radius: 12px; font-size: 16px; font-weight: 600; cursor: pointer; width: 100%; max-width: 300px; }
    .btn:active { opacity: 0.8; }

    /* Score card */
    .score-card { text-align: center; padding: 32px; max-width: 400px; margin: 0 auto; }
    .score-emoji { font-size: 64px; margin-bottom: 16px; }
    .score-value { font-size: 48px; font-weight: 700; color: #9333ea; margin: 8px 0 24px; }
    .stats-row { display: flex; justify-content: space-around; padding: 16px; background: #111; border: 1px solid #222; border-radius: 12px; margin-bottom: 24px; }
    .stat { text-align: center; }
    .stat-value { font-size: 18px; font-weight: 700; }
    .stat-label { font-size: 11px; color: #666; }

    /* Header bar */
    .header { display: flex; align-items: center; justify-content: space-between; padding: 8px 16px; background: #111; border-bottom: 1px solid #222; }
    .lesson-badge { font-size: 12px; padding: 4px 8px; background: rgba(147,51,234,0.13); color: #9333ea; border-radius: 6px; }
    .lesson-title { font-size: 14px; font-weight: 600; margin-left: 8px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 200px; }
    .header-stats { font-size: 12px; color: #666; }

    /* Generating state */
    .generating { text-align: center; max-width: 360px; margin: 0 auto; padding: 32px 16px; }
    .gen-icon { width: 64px; height: 64px; border-radius: 50%; background: rgba(147,51,234,0.13); display: flex; align-items: center; justify-content: center; margin: 0 auto 24px; font-size: 32px; }
    .progress-bar-bg { width: 100%; height: 8px; background: #222; border-radius: 4px; margin-top: 16px; }
    .progress-bar { height: 8px; background: #9333ea; border-radius: 4px; transition: width 0.3s; }

    /* Lesson iframe */
    .lesson-frame { width: 100%; border: none; flex: 1; }
    .lesson-container { display: flex; flex-direction: column; height: 100vh; }
  </style>
</head>
<body>
  <div id="app"></div>
  <script>
    const API = 'https://ai-notetaker-backend.fly.dev';
    const SESSION_ID = '${sessionId}';
    const TOKEN = '${token}';
    let pollTimer = null;
    let session = null;

    async function fetchStatus() {
      try {
        document.getElementById('app').innerHTML += '<p style="color:#666;font-size:11px;text-align:center">Fetching session...</p>';
        const res = await fetch(API + '/api/learn/session/' + SESSION_ID, {
          headers: { 'Authorization': 'Bearer ' + TOKEN }
        });
        const json = await res.json();
        if (!json.success) { showError(json.error || 'Session not found'); return; }
        session = json.data.session;
        if (json.data.currentLesson) {
          stopPolling();
          showLesson(json.data.currentLesson);
        } else if (json.data.isGenerating) {
          showGenerating();
          startPolling();
        } else {
          showGenerating();
          startPolling();
        }
      } catch (e) { showError('Error: ' + e.message); }
    }

    function startPolling() { if (!pollTimer) pollTimer = setInterval(fetchStatus, 3000); }
    function stopPolling() { if (pollTimer) { clearInterval(pollTimer); pollTimer = null; } }

    function showLoading() {
      document.getElementById('app').innerHTML = '<div class="loading"><div class="spinner"></div><p class="text-muted">Loading...</p></div>';
    }

    function showError(msg) {
      stopPolling();
      document.getElementById('app').innerHTML = '<div class="loading error"><div class="error-icon">⚠️</div><h2>' + msg + '</h2><p class="text-muted" style="margin:8px 0 24px">This share link may have expired.</p><button class="btn" onclick="location.reload()">Retry</button></div>';
    }

    function showGenerating() {
      const lessons = session ? session.total_lessons_completed : 0;
      const mastery = session ? (session.mastery_score * 100).toFixed(0) : 0;
      const streak = session ? session.streak_count : 0;
      const title = lessons > 0 ? 'Preparing your next lesson...' : 'Analyzing your material...';
      const sub = lessons > 0 ? 'The AI tutor is designing a personalized activity based on your progress.' : 'The AI tutor is studying your content and creating your first lesson.';

      let statsHtml = '';
      if (lessons > 0) {
        statsHtml = '<div style="margin-top:32px;padding:16px;background:#111;border:1px solid #222;border-radius:12px"><div style="display:flex;justify-content:space-between;font-size:14px;margin-bottom:8px"><span class="text-muted">Mastery</span><span class="text-purple">' + mastery + '%</span></div><div class="progress-bar-bg"><div class="progress-bar" style="width:' + mastery + '%"></div></div><div style="display:flex;justify-content:space-between;margin-top:12px;font-size:12px;color:#666"><span>🏆 ' + lessons + ' lessons</span><span>🔥 ' + streak + ' streak</span></div></div>';
      }

      document.getElementById('app').innerHTML = '<div class="loading generating"><div class="gen-icon">📚</div><h2 style="font-size:20px;margin-bottom:8px">' + title + '</h2><p class="text-muted">' + sub + '</p><div class="spinner" style="margin-top:24px"></div>' + statsHtml + '</div>';
    }

    function showLesson(lesson) {
      const mastery = session ? (session.mastery_score * 100).toFixed(0) : 0;
      const streak = session ? session.streak_count : 0;

      // Inject bridge into lesson HTML
      const bridge = '<script>window.ScribeAI={submitScore:function(c,t){window.parent.postMessage({type:"score",correct:c,total:t},"*")},nextLesson:function(){window.parent.postMessage({type:"next"},"*")}}<\\/script>';
      let html = lesson.content_html;
      html = html.includes('</head>') ? html.replace('</head>', bridge + '</head>') : bridge + html;

      const blob = new Blob([html], { type: 'text/html' });
      const url = URL.createObjectURL(blob);

      document.getElementById('app').innerHTML = '<div class="lesson-container"><div class="header"><div style="display:flex;align-items:center"><span class="lesson-badge">Lesson ' + lesson.lesson_number + '</span><span class="lesson-title">' + (lesson.title || '') + '</span></div><div class="header-stats">🔥' + streak + ' · ' + mastery + '%</div></div><iframe class="lesson-frame" src="' + url + '" sandbox="allow-scripts allow-same-origin"></iframe></div>';

      window.onmessage = function(e) {
        if (e.data && e.data.type === 'score') submitScore(lesson.id, e.data.correct, e.data.total);
        if (e.data && e.data.type === 'next') nextLesson();
      };
    }

    async function submitScore(lessonId, correct, total) {
      const score = total > 0 ? correct / total : 0;
      try {
        await fetch(API + '/api/learn/lesson/' + lessonId + '/submit', {
          method: 'POST',
          headers: { 'Authorization': 'Bearer ' + TOKEN, 'Content-Type': 'application/json' },
          body: JSON.stringify({ correct, total, totalQuestions: total, score })
        });
      } catch (e) {}
      showScoreCard(score);
    }

    function showScoreCard(score) {
      const pct = (score * 100).toFixed(0);
      const emoji = score >= 0.9 ? '🎉' : score >= 0.7 ? '👏' : score >= 0.4 ? '💪' : '📚';
      const msg = score >= 0.9 ? 'Outstanding!' : score >= 0.7 ? 'Great job!' : score >= 0.4 ? 'Good effort!' : 'Keep practicing!';
      const lessons = session ? session.total_lessons_completed + 1 : 1;
      const mastery = session ? (session.mastery_score * 100).toFixed(0) : pct;
      const streak = score >= 0.7 ? (session ? session.streak_count + 1 : 1) : 0;

      document.getElementById('app').innerHTML = '<div class="loading score-card"><div class="score-emoji">' + emoji + '</div><h2 style="font-size:24px">' + msg + '</h2><div class="score-value">' + pct + '%</div><div class="stats-row"><div class="stat"><div class="stat-value">' + lessons + '</div><div class="stat-label">Lessons</div></div><div class="stat"><div class="stat-value">' + mastery + '%</div><div class="stat-label">Mastery</div></div><div class="stat"><div class="stat-value">' + streak + '</div><div class="stat-label">Streak</div></div></div><button class="btn" onclick="nextLesson()">Next Lesson →</button></div>';
    }

    function nextLesson() {
      showGenerating();
      fetchStatus();
      startPolling();
    }

    // Start
    showLoading();
    fetchStatus();
  </script>
</body>
</html>`;

  res.setHeader('Content-Type', 'text/html');
  res.send(html);
}));

module.exports = router;
