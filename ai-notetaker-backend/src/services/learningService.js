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

    // Fire and forget — worker will call back
    axios.post(`${HETZNER_WORKER_URL}/generate-lesson`, payload, {
      headers: {
        'Authorization': `Bearer ${HETZNER_WORKER_SECRET}`,
        'Content-Type': 'application/json'
      },
      timeout: 5000 // Just to send the request, not wait for completion
    }).catch(err => {
      logger.error('Failed to trigger lesson generation', { sessionId, error: err.message });
      // Mark as failed so user can retry
      supabaseAdmin
        .from('learning_sessions')
        .update({ generation_status: 'failed' })
        .eq('id', sessionId);
    });
  }

  // ============================================
  // Callback from Hetzner worker with generated lesson
  // ============================================
  async handleGeneratedLesson(sessionId, lessonData, workerSecret) {
    if (workerSecret !== HETZNER_WORKER_SECRET) {
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
