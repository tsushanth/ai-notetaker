const { supabaseAdmin } = require('../config/supabase');
const { logger } = require('../utils/logger');
const { AppError } = require('../middleware/errorHandler');
const noteService = require('./noteService');
const axios = require('axios');

const HETZNER_WORKER_URL = process.env.LEARNING_WORKER_URL || 'http://178.156.231.255:3457';
const HETZNER_WORKER_SECRET = process.env.LEARNING_WORKER_SECRET;

class LearningService {
  // ============================================
  // Start or resume a learning session
  // ============================================
  async startSession(userId, noteId) {
    // Check for existing session
    const { data: existing } = await supabaseAdmin
      .from('learning_sessions')
      .select('*, learning_context(*)')
      .eq('user_id', userId)
      .eq('note_id', noteId)
      .single();

    if (existing) {
      // Check if there's a pending lesson ready
      const { data: pendingLessons } = await supabaseAdmin
        .from('learning_lessons')
        .select('*')
        .eq('session_id', existing.id)
        .eq('status', 'pending')
        .order('lesson_number', { ascending: true })
        .limit(1);

      // If no pending lesson and not currently generating, trigger generation
      if ((!pendingLessons || pendingLessons.length === 0) && existing.generation_status !== 'generating') {
        await this._triggerGeneration(existing.id);
      }

      return {
        session: existing,
        currentLesson: pendingLessons?.[0] || null,
        isGenerating: existing.generation_status === 'generating'
      };
    }

    // Fetch note content
    const note = await noteService.getNoteById(userId, noteId);
    if (!note) throw new AppError('Note not found', 404);

    const content = note.formatted_content || note.content || '';
    if (content.length < 50) {
      throw new AppError('Note content is too short for learning mode', 400);
    }

    // Create new session
    const { data: session, error } = await supabaseAdmin
      .from('learning_sessions')
      .insert({
        user_id: userId,
        note_id: noteId,
        status: 'active',
        current_level: 1,
        mastery_score: 0,
        generation_status: 'idle'
      })
      .select()
      .single();

    if (error) {
      logger.error('Failed to create learning session', { error: error.message });
      throw new AppError('Failed to create learning session', 500);
    }

    // Store the source content and initial context
    await supabaseAdmin
      .from('learning_context')
      .insert({
        session_id: session.id,
        source_content: content,
        curriculum: {},
        compressed_history: ''
      });

    logger.info('Learning session created', { userId, noteId, sessionId: session.id });

    // Trigger first lesson generation
    await this._triggerGeneration(session.id);

    return {
      session,
      currentLesson: null,
      isGenerating: true
    };
  }

  // ============================================
  // Get session status + current lesson
  // ============================================
  async getSessionStatus(userId, sessionId) {
    const { data: session, error } = await supabaseAdmin
      .from('learning_sessions')
      .select('*')
      .eq('id', sessionId)
      .eq('user_id', userId)
      .single();

    if (error || !session) throw new AppError('Session not found', 404);

    // Get current pending lesson
    const { data: pendingLessons } = await supabaseAdmin
      .from('learning_lessons')
      .select('*')
      .eq('session_id', sessionId)
      .eq('status', 'pending')
      .order('lesson_number', { ascending: true })
      .limit(1);

    // Get history summary
    const { data: completedLessons } = await supabaseAdmin
      .from('learning_lessons')
      .select('lesson_number, lesson_type, title, score, status')
      .eq('session_id', sessionId)
      .eq('status', 'completed')
      .order('lesson_number', { ascending: true });

    return {
      session,
      currentLesson: pendingLessons?.[0] || null,
      completedLessons: completedLessons || [],
      isGenerating: session.generation_status === 'generating'
    };
  }

  // ============================================
  // Submit user's response to a lesson
  // ============================================
  async submitLessonResponse(userId, lessonId, responses) {
    const { data: lesson, error } = await supabaseAdmin
      .from('learning_lessons')
      .select('*, learning_sessions!inner(*)')
      .eq('id', lessonId)
      .eq('user_id', userId)
      .single();

    if (error || !lesson) throw new AppError('Lesson not found', 404);

    const sessionId = lesson.session_id;

    // Calculate score from responses
    const score = this._calculateScore(responses, lesson.interaction_schema);

    // Update lesson
    await supabaseAdmin
      .from('learning_lessons')
      .update({
        status: 'completed',
        score,
        user_responses: responses,
        completed_at: new Date().toISOString(),
        time_spent_seconds: responses.timeSpentSeconds || null
      })
      .eq('id', lessonId);

    // Update session stats
    const session = lesson.learning_sessions;
    const newCorrect = session.total_correct + Math.round(score * (responses.totalQuestions || 1));
    const newAttempted = session.total_attempted + (responses.totalQuestions || 1);
    const newStreak = score >= 0.7 ? session.streak_count + 1 : 0;

    await supabaseAdmin
      .from('learning_sessions')
      .update({
        total_lessons_completed: session.total_lessons_completed + 1,
        total_correct: newCorrect,
        total_attempted: newAttempted,
        streak_count: newStreak,
        longest_streak: Math.max(session.longest_streak, newStreak),
        mastery_score: newAttempted > 0 ? newCorrect / newAttempted : 0,
        // Adjust difficulty based on performance
        current_level: this._adjustLevel(session.current_level, score),
        updated_at: new Date().toISOString()
      })
      .eq('id', sessionId);

    logger.info('Lesson completed', { sessionId, lessonId, score });

    // Trigger next lesson generation
    await this._triggerGeneration(sessionId);

    return { score, nextIsGenerating: true };
  }

  // ============================================
  // Trigger async lesson generation on Hetzner
  // ============================================
  async _triggerGeneration(sessionId) {
    // Mark as generating
    await supabaseAdmin
      .from('learning_sessions')
      .update({
        generation_status: 'generating',
        generation_started_at: new Date().toISOString()
      })
      .eq('id', sessionId);

    // Gather all context
    const { data: session } = await supabaseAdmin
      .from('learning_sessions')
      .select('*')
      .eq('id', sessionId)
      .single();

    const { data: context } = await supabaseAdmin
      .from('learning_context')
      .select('*')
      .eq('session_id', sessionId)
      .single();

    // Get recent lesson history (last 5 for context)
    const { data: recentLessons } = await supabaseAdmin
      .from('learning_lessons')
      .select('lesson_number, lesson_type, title, score, concepts_covered, ai_feedback')
      .eq('session_id', sessionId)
      .eq('status', 'completed')
      .order('lesson_number', { ascending: false })
      .limit(5);

    const payload = {
      sessionId,
      userId: session.user_id,
      noteId: session.note_id,
      sourceContent: context.source_content,
      curriculum: context.curriculum,
      compressedHistory: context.compressed_history,
      studentProfile: session.student_profile,
      conceptMastery: session.concept_mastery,
      currentLevel: session.current_level,
      masteryScore: session.mastery_score,
      totalLessonsCompleted: session.total_lessons_completed,
      streakCount: session.streak_count,
      recentLessons: recentLessons || [],
      lessonNumber: session.total_lessons_completed + 1
    };

    // Direct SDK generation (fire-and-forget). Replaces Hetzner CLI worker
    // round-trip — eliminates the OAuth-token sync chain across servers.
    this._generateLessonDirect(payload).catch(err => {
      logger.error('Lesson generation failed', { sessionId, error: err.message });
      supabaseAdmin
        .from('learning_sessions')
        .update({ generation_status: 'failed' })
        .eq('id', sessionId);
    });
  }

  async _generateLessonDirect(payload) {
    const { sessionId, lessonNumber } = payload;
    const prompt = this._buildLessonPrompt(payload);

    const resp = await axios.post('https://api.anthropic.com/v1/messages', {
      model: 'claude-sonnet-4-6',
      max_tokens: 32000,
      system: 'You output JSON only. Your entire response must be a single JSON object starting with { and ending with }. No markdown fences, no commentary before or after.',
      messages: [{ role: 'user', content: prompt }]
    }, {
      headers: {
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json'
      },
      timeout: 300000
    });

    const output = resp.data?.content?.[0]?.text || '';
    const stopReason = resp.data?.stop_reason;
    if (!output) throw new Error('Empty response from Anthropic');

    const lessonData = this._parseLessonOutput(output, lessonNumber, { sessionId, stopReason });
    await this.handleGeneratedLesson(sessionId, lessonData);
    logger.info('Lesson generated via SDK', { sessionId, lessonNumber, stopReason, outputChars: output.length });
  }

  _buildLessonPrompt(payload) {
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
${(sourceContent || '').substring(0, 50000)}
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

CRITICAL JS SYNTAX RULES (your last attempt broke because of this — read carefully):
- Use DOUBLE QUOTES for every JavaScript string. Apostrophes in copy ("you're", "don't", "it's", possessives) silently terminate single-quoted JS strings and break the whole <script> block, leaving the page blank.
- Use backticks (template literals) for any string that itself contains a double quote.
- Do NOT use unescaped apostrophes inside single-quoted strings. If you must use single quotes, escape every apostrophe as \\'.
- For HTML attributes inside JS string literals, prefer single-quoted HTML attrs (e.g. \`<div class="x" data-y='1'>\`) so the wrapping double-quoted JS string stays intact.

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

  _parseLessonOutput(output, lessonNumber, ctx = {}) {
    let cleaned = (output || '').trim()
      .replace(/^```(?:json)?\s*\n?/i, '')
      .replace(/\n?```\s*$/i, '')
      .trim();

    let json;
    try {
      json = JSON.parse(cleaned);
    } catch {
      // Balanced-brace extraction — handles nested objects (interactionSchema,
      // updatedConceptMastery, etc.) that a greedy {...} regex would mangle.
      const start = cleaned.indexOf('{');
      if (start >= 0) {
        let depth = 0, inStr = false, esc = false;
        for (let i = start; i < cleaned.length; i++) {
          const c = cleaned[i];
          if (esc) { esc = false; continue; }
          if (c === '\\' && inStr) { esc = true; continue; }
          if (c === '"') inStr = !inStr;
          else if (!inStr) {
            if (c === '{') depth++;
            else if (c === '}') {
              depth--;
              if (depth === 0) {
                const candidate = cleaned.substring(start, i + 1);
                try { json = JSON.parse(candidate); } catch {}
                break;
              }
            }
          }
        }
      }
    }
    if (!json) {
      logger.warn('Lesson JSON parse fell back', {
        sessionId: ctx.sessionId,
        stopReason: ctx.stopReason,
        outputChars: (output || '').length,
        outputHead: (output || '').substring(0, 300),
        outputTail: (output || '').slice(-200)
      });
      // Fallback: serve a minimal recap card so the user isn't stuck staring
      // at a spinner forever. They can tap "Next Lesson" to retry.
      json = {
        lessonType: 'recap',
        title: 'Review Time',
        difficultyLevel: 1,
        estimatedDuration: 60,
        conceptsCovered: [],
        interactionSchema: { type: 'free_response' },
        contentHtml: `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{background:#0a0a0b;color:#fff;font-family:system-ui;padding:20px;max-width:600px;margin:0 auto}h1{color:#9333ea}button{background:#9333ea;color:#fff;border:none;padding:12px 24px;border-radius:8px;font-size:16px;cursor:pointer;margin-top:20px}</style></head><body><h1>Let's Review</h1><p>The AI tutor is preparing your next personalized lesson. In the meantime, review the material and tap below when ready.</p><button onclick="window.ScribeAI.submitScore(1,1)">I've Reviewed</button><br><button onclick="window.ScribeAI.nextLesson()" style="margin-top:10px;background:#333">Next Lesson</button></body></html>`,
        updatedStudentProfile: {},
        updatedConceptMastery: {},
        updatedCompressedHistory: ''
      };
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

  // ============================================
  // Callback from Hetzner worker with generated lesson
  // ============================================
  async handleGeneratedLesson(sessionId, lessonData, workerSecret) {
    // Secret is only required for external (webhook) calls. Internal callers
    // (the in-process SDK generator) pass workerSecret=undefined.
    if (workerSecret !== undefined && workerSecret !== HETZNER_WORKER_SECRET) {
      throw new AppError('Invalid worker secret', 401);
    }

    const { data: session } = await supabaseAdmin
      .from('learning_sessions')
      .select('*')
      .eq('id', sessionId)
      .single();

    if (!session) throw new AppError('Session not found', 404);

    // Store the generated lesson
    await supabaseAdmin
      .from('learning_lessons')
      .insert({
        session_id: sessionId,
        user_id: session.user_id,
        lesson_number: lessonData.lessonNumber,
        lesson_type: lessonData.lessonType,
        title: lessonData.title,
        content_html: lessonData.contentHtml,
        concepts_covered: lessonData.conceptsCovered || [],
        difficulty_level: lessonData.difficultyLevel || session.current_level,
        estimated_duration_seconds: lessonData.estimatedDuration || 120,
        interaction_schema: lessonData.interactionSchema || {},
        status: 'pending'
      });

    // Update session and context
    await supabaseAdmin
      .from('learning_sessions')
      .update({
        generation_status: 'ready',
        student_profile: lessonData.updatedStudentProfile || session.student_profile,
        concept_mastery: lessonData.updatedConceptMastery || session.concept_mastery,
        updated_at: new Date().toISOString()
      })
      .eq('id', sessionId);

    // Update compressed history
    if (lessonData.updatedCompressedHistory || lessonData.updatedCurriculum) {
      const updates = {};
      if (lessonData.updatedCompressedHistory) updates.compressed_history = lessonData.updatedCompressedHistory;
      if (lessonData.updatedCurriculum) updates.curriculum = lessonData.updatedCurriculum;
      updates.updated_at = new Date().toISOString();

      await supabaseAdmin
        .from('learning_context')
        .update(updates)
        .eq('session_id', sessionId);
    }

    logger.info('Lesson generated and stored', { sessionId, lessonNumber: lessonData.lessonNumber });
  }

  // ============================================
  // Get all learning sessions for a user
  // ============================================
  async getUserSessions(userId) {
    const { data, error } = await supabaseAdmin
      .from('learning_sessions')
      .select(`
        id, note_id, status, current_level, mastery_score,
        total_lessons_completed, streak_count, longest_streak,
        generation_status, created_at, updated_at
      `)
      .eq('user_id', userId)
      .order('updated_at', { ascending: false });

    return data || [];
  }

  // ============================================
  // Helpers
  // ============================================

  _calculateScore(responses, schema) {
    if (responses.score !== undefined) return Math.min(1, Math.max(0, responses.score));
    if (responses.correct !== undefined && responses.total !== undefined) {
      return responses.total > 0 ? responses.correct / responses.total : 0;
    }
    return 0.5; // Default neutral score
  }

  _adjustLevel(currentLevel, score) {
    if (score >= 0.9) return Math.min(10, currentLevel + 1);
    if (score >= 0.7) return currentLevel;
    if (score >= 0.4) return Math.max(1, currentLevel - 1);
    return Math.max(1, currentLevel - 2);
  }
}

module.exports = new LearningService();
