const http = require('http');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PORT = process.env.WORKER_PORT || 3457;
const WORKER_SECRET = process.env.LEARNING_WORKER_SECRET;
const BACKEND_URL = process.env.BACKEND_URL || 'https://ai-notetaker-backend-917362189743.us-central1.run.app';

const server = http.createServer(async (req, res) => {
  // CORS
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200);
    res.end(JSON.stringify({ status: 'healthy', timestamp: new Date().toISOString() }));
    return;
  }

  if (req.method === 'POST' && req.url === '/generate-lesson') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      try {
        const payload = JSON.parse(body);

        // Verify secret
        const authHeader = req.headers['authorization'];
        const token = authHeader?.replace('Bearer ', '');
        if (token !== WORKER_SECRET) {
          res.writeHead(401);
          res.end(JSON.stringify({ error: 'Unauthorized' }));
          return;
        }

        // Acknowledge immediately — process async
        res.writeHead(202);
        res.end(JSON.stringify({ status: 'accepted', sessionId: payload.sessionId }));

        // Generate lesson in background
        generateLesson(payload).catch(err => {
          console.error(`[${payload.sessionId}] Generation failed:`, err.message);
          // Notify backend of failure
          notifyBackend(payload.sessionId, null, err.message);
        });
      } catch (err) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: 'Invalid JSON' }));
      }
    });
    return;
  }

  if (req.method === 'POST' && req.url === '/generate-challenge') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      try {
        const payload = JSON.parse(body);
        const authHeader = req.headers['authorization'];
        const token = authHeader?.replace('Bearer ', '');
        if (token !== WORKER_SECRET) {
          res.writeHead(401);
          res.end(JSON.stringify({ error: 'Unauthorized' }));
          return;
        }
        try {
          const result = await generateChallenge(payload);
          res.writeHead(200);
          res.end(JSON.stringify({ success: true, data: result }));
        } catch (err) {
          console.error('Challenge generation failed:', err.message);
          res.writeHead(500);
          res.end(JSON.stringify({ error: err.message }));
        }
      } catch (err) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: 'Invalid JSON' }));
      }
    });
    return;
  }

  if (req.method === 'POST' && req.url === '/create-content') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      try {
        const payload = JSON.parse(body);
        const authHeader = req.headers['authorization'];
        const token = authHeader?.replace('Bearer ', '');
        if (token !== WORKER_SECRET) {
          res.writeHead(401);
          res.end(JSON.stringify({ error: 'Unauthorized' }));
          return;
        }

        // Synchronous — wait for result
        try {
          const result = await createContent(payload);
          res.writeHead(200);
          res.end(JSON.stringify({ success: true, data: result }));
        } catch (err) {
          console.error('Content creation failed:', err.message);
          res.writeHead(500);
          res.end(JSON.stringify({ error: err.message }));
        }
      } catch (err) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: 'Invalid JSON' }));
      }
    });
    return;
  }

  if (req.method === 'POST' && req.url === '/generate-infographic') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      try {
        const payload = JSON.parse(body);
        const authHeader = req.headers['authorization'];
        const token = authHeader?.replace('Bearer ', '');
        if (token !== WORKER_SECRET) {
          res.writeHead(401);
          res.end(JSON.stringify({ error: 'Unauthorized' }));
          return;
        }

        // Acknowledge immediately — process async
        res.writeHead(202);
        res.end(JSON.stringify({ status: 'accepted' }));

        // Generate in background, callback to backend
        generateInfographic(payload).then(result => {
          notifyBackend(null, null, null, {
            type: 'infographic',
            noteId: payload.noteId,
            userId: payload.userId,
            svg: result.svg,
            extractedData: payload.extractedData,
            style: payload.style,
            secret: WORKER_SECRET
          });
        }).catch(err => {
          console.error('Infographic generation failed:', err.message);
          notifyBackend(null, null, null, {
            type: 'infographic_error',
            noteId: payload.noteId,
            userId: payload.userId,
            error: err.message,
            secret: WORKER_SECRET
          });
        });
      } catch (err) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: 'Invalid JSON' }));
      }
    });
    return;
  }

  res.writeHead(404);
  res.end(JSON.stringify({ error: 'Not found' }));
});

/**
 * Extract clean HTML from Claude output — strips preamble, markdown fences, trailing text
 */
function extractHTML(output) {
  let html = output.trim();
  // Strip markdown code fences
  html = html.replace(/^```(?:html)?\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim();
  // Find the actual HTML start
  const doctypeIdx = html.indexOf('<!DOCTYPE');
  const htmlIdx = html.indexOf('<html');
  const startIdx = doctypeIdx >= 0 ? doctypeIdx : htmlIdx;
  if (startIdx > 0) {
    html = html.substring(startIdx);
  }
  // Find the actual HTML end
  const endIdx = html.lastIndexOf('</html>');
  if (endIdx > 0) {
    html = html.substring(0, endIdx + 7);
  }
  return html;
}

async function generateChallenge(payload) {
  const { content, title, challengeType = 'quiz', noteId, numQuestions = 10 } = payload;
  console.log(`[challenge] Generating ${challengeType} for note ${noteId}`);

  const workDir = path.join(os.tmpdir(), `challenge_${noteId}_${Date.now()}`);
  fs.mkdirSync(workDir, { recursive: true });

  try {
    const typeInstructions = {
      quiz: `Create a timed multiple-choice quiz with ${numQuestions} questions. Each question has 4 options, one correct. Show a timer counting up. Track correct/total answers.`,
      speed_round: `Create a speed round with ${numQuestions} rapid-fire true/false questions. Give 10 seconds per question with a countdown timer. Track speed and accuracy.`,
      memory_game: `Create a memory matching game using ${Math.min(numQuestions, 8)} pairs of key terms and their definitions from the content. Track time to complete and number of attempts.`,
      word_scramble: `Create a word scramble game with ${numQuestions} key terms from the content. Scramble each word, show a hint (the definition), and track how many they unscramble correctly and time taken.`,
      true_false: `Create a true/false challenge with ${numQuestions} statements about the content. Some should be true, some subtly false. Track correct answers and time.`
    };

    const prompt = `You are creating a competitive challenge game that will be shared between friends. It must be fun, engaging, and fair.

## SOURCE MATERIAL
Title: ${title || 'Challenge'}
${content.substring(0, 20000)}

## CHALLENGE TYPE
${typeInstructions[challengeType] || typeInstructions.quiz}

## REQUIREMENTS FOR THE HTML PAGE
1. Output a COMPLETE self-contained HTML page with inline CSS and JS
2. Dark theme: background #0a0a0b, text #ffffff, accent #9333ea, cards #111111, correct #22c55e, wrong #ef4444
3. Mobile-first (max-width: 600px, centered)
4. Show a welcome screen with the challenge title and a "Start" button
5. Track: correct answers, total questions, time spent (seconds)
6. At the end show a results screen with score percentage and time
7. The results screen MUST call: window.ScribeCompete.submitScore(correct, total, timeSeconds)
8. Also show a "View Leaderboard" button that calls: window.ScribeCompete.showLeaderboard()
9. Make it visually polished — animations, transitions, progress bar
10. Include a "Share Challenge" button on the results screen that calls: window.ScribeCompete.shareChallenge()
11. Show question number progress (e.g., "3 of 10")

CRITICAL INSTRUCTIONS:
- Your ENTIRE response must be ONLY the HTML page, starting with <!DOCTYPE html> and ending with </html>
- Do NOT include any text before <!DOCTYPE html> — no "Here is", no "I've created", no explanations
- Do NOT include any text after </html>
- Do NOT wrap in markdown code fences
- The very first characters of your response MUST be: <!DOCTYPE html>`;

    const promptFile = path.join(workDir, 'prompt.md');
    fs.writeFileSync(promptFile, prompt, 'utf-8');

    const output = execSync(`claude -p < "${promptFile}"`, {
      cwd: workDir,
      timeout: 300000,
      maxBuffer: 10 * 1024 * 1024,
      env: { ...process.env, HOME: '/home/vibecoder' },
      shell: '/bin/bash'
    }).toString();

    console.log(`[challenge] Claude output: ${output.length} chars`);

    // Extract clean HTML
    let html = extractHTML(output);
    let metadata = { title: title || 'Challenge', totalQuestions: numQuestions, type: challengeType };

    if (!html.includes('<')) {
      throw new Error('Claude did not return valid HTML');
    }

    return { html, metadata };
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
}

async function createContent(payload) {
  const { content, title, userPrompt, noteId } = payload;
  console.log(`[create] Creating content for note ${noteId}: "${userPrompt.substring(0, 50)}..."`);

  const workDir = path.join(os.tmpdir(), `create_${noteId}_${Date.now()}`);
  fs.mkdirSync(workDir, { recursive: true });

  try {
    const prompt = `You are a creative content generator. The user has study notes and wants you to create something specific from them.

## SOURCE MATERIAL
Title: ${title || 'Notes'}
${content.substring(0, 30000)}

## USER'S REQUEST
${userPrompt}

## RULES
1. Create a COMPLETE, self-contained HTML page with inline CSS and JS
2. Dark theme: background #0a0a0b, text #ffffff, accent #9333ea (purple), cards #111111
3. Mobile-first design (max-width: 600px, centered, good padding)
4. Make it visually rich and engaging — use icons (emoji), cards, sections, colors
5. If the user asks for something interactive (quiz, game, etc.), include JavaScript
6. If the user asks for a document (study guide, cheat sheet, summary), make it well-formatted with headers, lists, highlights
7. If the user asks for creative content (poem, song, story), present it beautifully with typography
8. Add a subtle "Created with Scribe AI" footer
9. Make sure all content is derived from the source material above

CRITICAL INSTRUCTIONS:
- Your ENTIRE response must be ONLY the HTML page, starting with <!DOCTYPE html> and ending with </html>
- Do NOT include any text before <!DOCTYPE html> — no "Here is", no "I've created", no explanations
- Do NOT wrap in markdown code fences
- The very first characters of your response MUST be: <!DOCTYPE html>`;

    const promptFile = path.join(workDir, 'prompt.md');
    fs.writeFileSync(promptFile, prompt, 'utf-8');

    const output = execSync(`claude -p < "${promptFile}"`, {
      cwd: workDir,
      timeout: 300000,
      maxBuffer: 10 * 1024 * 1024,
      env: { ...process.env, HOME: '/home/vibecoder' },
      shell: '/bin/bash'
    }).toString();

    console.log(`[create] Claude output: ${output.length} chars`);

    let html = extractHTML(output);

    if (!html.includes('<')) {
      throw new Error('Claude did not return valid HTML');
    }

    return { html };
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
}

async function generateInfographic(payload) {
  const { content, title, style = 'modern', noteId } = payload;
  console.log(`[infographic] Generating for note ${noteId}, style: ${style}`);

  const workDir = path.join(os.tmpdir(), `infographic_${noteId}_${Date.now()}`);
  fs.mkdirSync(workDir, { recursive: true });

  try {
    const styleDescs = {
      modern: 'clean modern design with gradient backgrounds, rounded shapes, dark theme (#0a0a0b background, #9333ea accent purple, white text)',
      colorful: 'vibrant colorful design with bold gradients, playful icons, dark background (#0a0a0b)',
      minimal: 'minimalist design with plenty of space, subtle colors on dark background (#0a0a0b)',
      professional: 'professional corporate style with structured layout, muted colors on dark background (#0a0a0b)'
    };

    const prompt = `You are an expert infographic designer. Create a COMPLETE, self-contained SVG infographic from the following content.

## CONTENT
Title: ${title || 'Infographic'}
${content.substring(0, 15000)}

## REQUIREMENTS
1. Output ONLY a valid SVG element (no markdown, no explanation, just the raw SVG)
2. Style: ${styleDescs[style] || styleDescs.modern}
3. SVG dimensions: width="1024" height="1792" (portrait)
4. Include:
   - A compelling title at the top
   - 2-4 key statistics/facts as large highlighted numbers
   - 2-3 main sections with icons and bullet points
   - Visual elements: icons (use simple SVG shapes), dividers, backgrounds
   - A key takeaway at the bottom
   - "Created with Scribe AI" footer
5. Use embedded fonts (system-ui, sans-serif)
6. Make text readable (min 20px for body, 40px+ for headers)
7. Use colors: primary #9333ea (purple), accent #a855f7 (light purple), background #0a0a0b, cards #111111, text #ffffff, muted #888888

RESPOND WITH ONLY THE SVG. NO OTHER TEXT.`;

    const promptFile = path.join(workDir, 'prompt.md');
    fs.writeFileSync(promptFile, prompt, 'utf-8');

    const output = execSync(`claude -p < "${promptFile}"`, {
      cwd: workDir,
      timeout: 300000, // 5 min
      maxBuffer: 10 * 1024 * 1024,
      env: { ...process.env, HOME: '/home/vibecoder' },
      shell: '/bin/bash'
    }).toString();

    console.log(`[infographic] Claude output: ${output.length} chars`);

    // Extract SVG from output (strip markdown fences if present)
    let svg = output.trim();
    svg = svg.replace(/^```(?:svg|xml)?\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim();

    // Validate it's actually SVG
    if (!svg.includes('<svg')) {
      throw new Error('Claude did not return valid SVG');
    }

    // Wrap SVG in HTML for rendering, then convert to PNG using puppeteer-like approach
    // Since we may not have puppeteer, we'll return the SVG as a data URL
    // The backend will wrap it and store it

    return {
      svg: svg,
      format: 'svg'
    };

  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
}

async function generateLesson(payload) {
  const {
    sessionId, sourceContent, curriculum, compressedHistory,
    studentProfile, conceptMastery, currentLevel, masteryScore,
    totalLessonsCompleted, streakCount, recentLessons, lessonNumber
  } = payload;

  console.log(`[${sessionId}] Generating lesson #${lessonNumber}...`);

  // Create temp working directory
  const workDir = path.join(os.tmpdir(), `learn_${sessionId}_${Date.now()}`);
  fs.mkdirSync(workDir, { recursive: true });

  try {
    // Write the prompt file
    const prompt = buildPrompt(payload);
    const promptFile = path.join(workDir, 'prompt.md');
    fs.writeFileSync(promptFile, prompt, 'utf-8');

    // Write source content as reference
    const contentFile = path.join(workDir, 'source_content.md');
    fs.writeFileSync(contentFile, sourceContent, 'utf-8');

    // Verify prompt file exists and has content
    const promptSize = fs.statSync(promptFile).size;
    console.log(`[${sessionId}] Prompt file: ${promptSize} bytes`);

    // Call Claude CLI with -p (print mode), prompt via stdin
    console.log(`[${sessionId}] Running Claude CLI...`);
    let output;
    try {
      output = execSync(`claude -p < "${promptFile}"`, {
        cwd: workDir,
        timeout: 300000, // 5 min max
        maxBuffer: 10 * 1024 * 1024, // 10MB
        env: { ...process.env, HOME: '/home/vibecoder' },
        shell: '/bin/bash'
      }).toString();
    } catch (cliErr) {
      const stderr = cliErr.stderr?.toString() || '';
      const stdout = cliErr.stdout?.toString() || '';
      console.error(`[${sessionId}] Claude CLI error:`, cliErr.message);
      console.error(`[${sessionId}] Claude CLI stderr:`, stderr);
      console.error(`[${sessionId}] Claude CLI stdout (${stdout.length} chars):`, stdout.substring(0, 500));
      throw cliErr;
    }

    console.log(`[${sessionId}] Claude output: ${output.length} chars`);

    // Parse the structured response
    const lessonData = parseClaudeOutput(output, lessonNumber);

    // Send back to backend
    await notifyBackend(sessionId, lessonData);
    console.log(`[${sessionId}] Lesson delivered to backend`);

  } finally {
    // Cleanup
    fs.rmSync(workDir, { recursive: true, force: true });
    console.log(`[${sessionId}] Workspace cleaned up`);
  }
}

function buildPrompt(payload) {
  const {
    sourceContent, curriculum, compressedHistory, studentProfile,
    conceptMastery, currentLevel, masteryScore, totalLessonsCompleted,
    streakCount, recentLessons, lessonNumber
  } = payload;

  const isFirstLesson = lessonNumber === 1;
  const recentSummary = (recentLessons || []).map(l =>
    `- Lesson ${l.lesson_number} (${l.lesson_type}): "${l.title}" — Score: ${l.score !== null ? (l.score * 100).toFixed(0) + '%' : 'N/A'}`
  ).join('\n') || 'None yet';

  return `You are an expert adaptive learning tutor. Your job is to teach the student the content below using creative, engaging methods.

## SOURCE MATERIAL TO TEACH
<source_content>
${sourceContent.substring(0, 50000)}
</source_content>

${!isFirstLesson ? `## STUDENT PROFILE
${JSON.stringify(studentProfile, null, 2)}

## CONCEPT MASTERY (0-1 scores)
${JSON.stringify(conceptMastery, null, 2)}

## LEARNING HISTORY SUMMARY
${compressedHistory || 'Just starting out'}

## RECENT LESSONS
${recentSummary}

## CURRENT STATS
- Lesson number: ${lessonNumber}
- Current level: ${currentLevel}/10
- Overall mastery: ${(masteryScore * 100).toFixed(0)}%
- Streak: ${streakCount} correct in a row
- Total completed: ${totalLessonsCompleted}
` : `## FIRST LESSON
This is the student's first lesson. Start by:1. Analyzing the content and identifying key concepts
2. Creating a fun, engaging introduction to the material
3. Use a simple activity to gauge the student's existing knowledge
`}

## YOUR TASK
Generate the next learning activity. You MUST respond with a JSON object in this exact format (no markdown fences, no extra text — ONLY the JSON):

{
  "lessonType": "quiz|game|visualization|mnemonic|song|story|recap|challenge",
  "title": "Short engaging title",
  "difficultyLevel": ${currentLevel},
  "estimatedDuration": 120,
  "conceptsCovered": ["concept1", "concept2"],
  "interactionSchema": {
    "type": "multiple_choice|drag_drop|free_response|matching|sequence|fill_blank|interactive",
    "questions": 5
  },
  "contentHtml": "<FULL SELF-CONTAINED HTML PAGE HERE - see rules below>",
  ${isFirstLesson ? `"updatedCurriculum": { "concepts": ["list", "of", "key", "concepts"], "teachingOrder": ["ordered", "concept", "list"] },` : ''}
  "updatedStudentProfile": { "learning_style": "visual|auditory|kinesthetic|reading", "strengths": [], "struggles": [], "engagement_notes": "" },
  "updatedConceptMastery": {},
  "updatedCompressedHistory": "Brief summary of all learning progress so far including this lesson"
}

## RULES FOR contentHtml
1. MUST be a complete, self-contained HTML page with inline CSS and JS
2. Dark theme (background: #0a0a0b, text: #ffffff, accent: #9333ea)
3. Mobile-first design (max-width: 600px, centered)
4. Make it INTERACTIVE — the student should DO something, not just read
5. Include a scoring mechanism that calls: window.ScribeAI.submitScore(correct, total)
6. Vary the activity type! Use:
   - Visual memory games (match cards, find patterns)
   - Drag-and-drop sorting/categorization
   - Fill-in-the-blank with hints
   - Timed challenges
   - Story-based scenarios where concepts are applied
   - Mnemonic devices with visual aids
   - Mini songs/rhymes (display lyrics with key terms highlighted)
   - Interactive diagrams/flowcharts
   - "Teach it back" — student explains a concept
7. ${currentLevel <= 3 ? 'Keep it simple and encouraging. Lots of hints and positive feedback.' : currentLevel <= 6 ? 'Moderate difficulty. Mix easy wins with challenges.' : 'Push the student. Complex scenarios, fewer hints, time pressure.'}
8. ${streakCount >= 3 ? 'Student is on a streak! Increase difficulty or try a new activity type.' : ''}
9. ${masteryScore < 0.4 && totalLessonsCompleted > 2 ? 'Student is struggling. Switch to a more engaging format. Try gamification, storytelling, or visual aids.' : ''}
10. End with a "Next Lesson" button that calls: window.ScribeAI.nextLesson()

RESPOND WITH ONLY THE JSON OBJECT. NO OTHER TEXT.`;
}

function parseClaudeOutput(output, lessonNumber) {
  // Try to extract JSON from Claude's output
  let json;

  // Strip markdown code fences if present
  let cleaned = output.trim();
  cleaned = cleaned.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim();

  // Try direct parse first
  try {
    json = JSON.parse(cleaned);
  } catch {
    // Try to find JSON in the output
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        json = JSON.parse(jsonMatch[0]);
      } catch (e) {
        console.error('Failed to parse JSON from Claude output');
        // Create a fallback lesson
        json = {
          lessonType: 'recap',
          title: 'Review Time',
          difficultyLevel: 1,
          estimatedDuration: 60,
          conceptsCovered: [],
          interactionSchema: { type: 'free_response' },
          contentHtml: `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{background:#0a0a0b;color:#fff;font-family:system-ui;padding:20px;max-width:600px;margin:0 auto}h1{color:#9333ea}button{background:#9333ea;color:#fff;border:none;padding:12px 24px;border-radius:8px;font-size:16px;cursor:pointer;margin-top:20px}</style></head><body><h1>Let's Review</h1><p>The AI tutor is preparing your next personalized lesson. In the meantime, review the material and click below when ready.</p><button onclick="window.ScribeAI.submitScore(1,1)">I've Reviewed</button><br><button onclick="window.ScribeAI.nextLesson()" style="margin-top:10px;background:#333">Next Lesson</button></body></html>`,
          updatedStudentProfile: {},
          updatedConceptMastery: {},
          updatedCompressedHistory: ''
        };
      }
    }
  }

  if (!json) {
    throw new Error('Could not parse Claude output as JSON');
  }

  return {
    lessonNumber,
    lessonType: json.lessonType || 'quiz',
    title: json.title || `Lesson ${lessonNumber}`,
    contentHtml: json.contentHtml || '<p>Error generating lesson</p>',
    conceptsCovered: json.conceptsCovered || [],
    difficultyLevel: json.difficultyLevel || 1,
    estimatedDuration: json.estimatedDuration || 120,
    interactionSchema: json.interactionSchema || {},
    updatedStudentProfile: json.updatedStudentProfile,
    updatedConceptMastery: json.updatedConceptMastery,
    updatedCompressedHistory: json.updatedCompressedHistory,
    updatedCurriculum: json.updatedCurriculum
  };
}

async function notifyBackend(sessionId, lessonData, errorMessage, customPayload) {
  const https = require('https');

  // Support custom payloads (e.g. infographic callbacks)
  let url, body;
  if (customPayload) {
    url = `${BACKEND_URL}/api/learn/webhook/infographic-ready`;
    body = JSON.stringify(customPayload);
  } else {
    url = `${BACKEND_URL}/api/learn/webhook/lesson-ready`;
    body = JSON.stringify(
      errorMessage
        ? { sessionId, secret: WORKER_SECRET, error: errorMessage }
        : { sessionId, lessonData, secret: WORKER_SECRET }
    );
  }

  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const req = https.request({
      hostname: urlObj.hostname,
      port: urlObj.port || 443,
      path: urlObj.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        console.log(`[${sessionId}] Backend response: ${res.statusCode}`);
        resolve(data);
      });
    });

    req.on('error', (err) => {
      console.error(`[${sessionId}] Backend notify failed:`, err.message);
      reject(err);
    });

    req.write(body);
    req.end();
  });
}

server.listen(PORT, () => {
  console.log(`Learning worker running on port ${PORT}`);
  console.log(`Backend URL: ${BACKEND_URL}`);
});
