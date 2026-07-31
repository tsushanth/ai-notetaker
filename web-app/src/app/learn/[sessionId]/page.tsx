'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { Loader2, BookOpen, Trophy, Flame, ChevronRight, RefreshCw } from 'lucide-react';

const API_BASE_URL = 'https://ai-notetaker-backend.fly.dev';

interface LessonData {
  id: string;
  lesson_number: number;
  lesson_type: string;
  title: string;
  content_html: string;
  difficulty_level: number;
  estimated_duration_seconds: number;
  interaction_schema: Record<string, unknown>;
  status: string;
}

interface SessionData {
  id: string;
  current_level: number;
  mastery_score: number;
  total_lessons_completed: number;
  streak_count: number;
  longest_streak: number;
  generation_status: string;
}

interface CompletedLesson {
  lesson_number: number;
  title: string;
  score: number;
  lesson_type: string;
}

export default function LearnPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const sessionId = params.sessionId as string;
  const token = searchParams.get('token');

  const [session, setSession] = useState<SessionData | null>(null);
  const [currentLesson, setCurrentLesson] = useState<LessonData | null>(null);
  const [completedLessons, setCompletedLessons] = useState<CompletedLesson[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastScore, setLastScore] = useState<number | null>(null);
  const [showScoreCard, setShowScoreCard] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const pollRef = useRef<NodeJS.Timeout>(undefined);

  const fetchStatus = useCallback(async () => {
    if (!token) return;
    try {
      const res = await fetch(`${API_BASE_URL}/api/learn/session/${sessionId}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const json = await res.json();
      if (json.success) {
        setSession(json.data.session);
        setCurrentLesson(json.data.currentLesson);
        setCompletedLessons(json.data.completedLessons || []);
        setIsGenerating(json.data.isGenerating);
        setLoading(false);

        // Stop polling if lesson is ready
        if (json.data.currentLesson && pollRef.current) {
          clearInterval(pollRef.current);
          pollRef.current = undefined;
        }
      } else {
        setError(json.error || 'Failed to load session');
        setLoading(false);
      }
    } catch {
      setError('Connection error');
      setLoading(false);
    }
  }, [sessionId, token]);

  // Initial fetch + polling when generating
  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  useEffect(() => {
    if (isGenerating && !currentLesson) {
      pollRef.current = setInterval(fetchStatus, 3000);
      return () => { if (pollRef.current) clearInterval(pollRef.current); };
    }
  }, [isGenerating, currentLesson, fetchStatus]);

  // Bridge for lesson HTML to call back
  useEffect(() => {
    const handleMessage = async (event: MessageEvent) => {
      if (event.data?.type === 'scribeai_submit_score') {
        const { correct, total } = event.data;
        const score = total > 0 ? correct / total : 0;
        setLastScore(score);
        setShowScoreCard(true);

        // Submit to backend
        if (currentLesson && token) {
          await fetch(`${API_BASE_URL}/api/learn/lesson/${currentLesson.id}/submit`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${token}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({ correct, total, totalQuestions: total, score })
          });
        }
      } else if (event.data?.type === 'scribeai_next_lesson') {
        setShowScoreCard(false);
        setCurrentLesson(null);
        setIsGenerating(true);
        setLastScore(null);
        fetchStatus();
        // Start polling
        pollRef.current = setInterval(fetchStatus, 3000);
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [currentLesson, token, fetchStatus]);

  // Inject bridge script into lesson HTML
  const getLessonHtmlWithBridge = (html: string) => {
    const bridge = `
      <script>
        window.ScribeAI = {
          submitScore: function(correct, total) {
            window.parent.postMessage({ type: 'scribeai_submit_score', correct: correct, total: total }, '*');
          },
          nextLesson: function() {
            window.parent.postMessage({ type: 'scribeai_next_lesson' }, '*');
          }
        };
      </script>
    `;
    // Inject bridge before </head> or at start
    if (html.includes('</head>')) {
      return html.replace('</head>', bridge + '</head>');
    }
    return bridge + html;
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: '#0a0a0b' }}>
        <div className="text-center">
          <Loader2 className="w-8 h-8 animate-spin mx-auto mb-4" style={{ color: '#9333ea' }} />
          <p style={{ color: '#888' }}>Loading your learning session...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4" style={{ background: '#0a0a0b' }}>
        <div className="text-center">
          <p className="text-red-400 mb-4">{error}</p>
          <button onClick={() => window.location.reload()} className="px-4 py-2 rounded-lg text-white" style={{ background: '#9333ea' }}>
            Retry
          </button>
        </div>
      </div>
    );
  }

  // Generating state
  if (isGenerating && !currentLesson) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: '#0a0a0b' }}>
        <div className="text-center max-w-sm px-4">
          <div className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-6" style={{ background: '#9333ea22' }}>
            <BookOpen className="w-8 h-8" style={{ color: '#9333ea' }} />
          </div>
          <h2 className="text-xl font-bold mb-2" style={{ color: '#fff' }}>
            {session && session.total_lessons_completed > 0
              ? 'Preparing your next lesson...'
              : 'Analyzing your material...'}
          </h2>
          <p className="text-sm mb-6" style={{ color: '#888' }}>
            {session && session.total_lessons_completed > 0
              ? 'The AI tutor is designing a personalized activity based on your progress.'
              : 'The AI tutor is studying your content and creating your first lesson.'}
          </p>
          <Loader2 className="w-6 h-6 animate-spin mx-auto" style={{ color: '#9333ea' }} />

          {session && session.total_lessons_completed > 0 && (
            <div className="mt-8 p-4 rounded-xl" style={{ background: '#111', border: '1px solid #222' }}>
              <div className="flex justify-between text-sm mb-2">
                <span style={{ color: '#888' }}>Mastery</span>
                <span style={{ color: '#9333ea' }}>{(session.mastery_score * 100).toFixed(0)}%</span>
              </div>
              <div className="w-full h-2 rounded-full" style={{ background: '#222' }}>
                <div className="h-2 rounded-full" style={{ background: '#9333ea', width: `${session.mastery_score * 100}%` }} />
              </div>
              <div className="flex justify-between mt-3 text-xs" style={{ color: '#666' }}>
                <span className="flex items-center gap-1"><Trophy className="w-3 h-3" /> {session.total_lessons_completed} lessons</span>
                <span className="flex items-center gap-1"><Flame className="w-3 h-3" /> {session.streak_count} streak</span>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  // Score card overlay
  if (showScoreCard && lastScore !== null) {
    const emoji = lastScore >= 0.9 ? '🎉' : lastScore >= 0.7 ? '👏' : lastScore >= 0.4 ? '💪' : '📚';
    const message = lastScore >= 0.9 ? 'Outstanding!' : lastScore >= 0.7 ? 'Great job!' : lastScore >= 0.4 ? 'Good effort!' : 'Keep practicing!';

    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: '#0a0a0b' }}>
        <div className="text-center max-w-sm px-4">
          <div className="text-6xl mb-4">{emoji}</div>
          <h2 className="text-2xl font-bold mb-2" style={{ color: '#fff' }}>{message}</h2>
          <p className="text-4xl font-bold mb-6" style={{ color: '#9333ea' }}>{(lastScore * 100).toFixed(0)}%</p>

          {session && (
            <div className="p-4 rounded-xl mb-6" style={{ background: '#111', border: '1px solid #222' }}>
              <div className="flex justify-around text-center">
                <div>
                  <div className="text-lg font-bold" style={{ color: '#fff' }}>{session.total_lessons_completed + 1}</div>
                  <div className="text-xs" style={{ color: '#666' }}>Lessons</div>
                </div>
                <div>
                  <div className="text-lg font-bold" style={{ color: '#fff' }}>{((session.mastery_score) * 100).toFixed(0)}%</div>
                  <div className="text-xs" style={{ color: '#666' }}>Mastery</div>
                </div>
                <div>
                  <div className="text-lg font-bold" style={{ color: '#fff' }}>{lastScore >= 0.7 ? session.streak_count + 1 : 0}</div>
                  <div className="text-xs" style={{ color: '#666' }}>Streak</div>
                </div>
              </div>
            </div>
          )}

          <button
            onClick={() => {
              setShowScoreCard(false);
              setCurrentLesson(null);
              setIsGenerating(true);
              setLastScore(null);
              fetchStatus();
              pollRef.current = setInterval(fetchStatus, 3000);
            }}
            className="w-full py-3 rounded-lg text-white font-medium flex items-center justify-center gap-2"
            style={{ background: '#9333ea' }}
          >
            Next Lesson <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>
    );
  }

  // Render lesson in iframe
  if (currentLesson) {
    const html = getLessonHtmlWithBridge(currentLesson.content_html);
    const blob = new Blob([html], { type: 'text/html' });
    const blobUrl = URL.createObjectURL(blob);

    return (
      <div className="h-screen flex flex-col" style={{ background: '#0a0a0b' }}>
        {/* Minimal header */}
        <div className="flex items-center justify-between px-4 py-2" style={{ background: '#111', borderBottom: '1px solid #222' }}>
          <div className="flex items-center gap-2">
            <span className="text-xs px-2 py-1 rounded" style={{ background: '#9333ea22', color: '#9333ea' }}>
              Lesson {currentLesson.lesson_number}
            </span>
            <span className="text-sm font-medium truncate" style={{ color: '#fff', maxWidth: '200px' }}>
              {currentLesson.title}
            </span>
          </div>
          <div className="flex items-center gap-3 text-xs" style={{ color: '#666' }}>
            {session && <span className="flex items-center gap-1"><Flame className="w-3 h-3" />{session.streak_count}</span>}
            {session && <span>{(session.mastery_score * 100).toFixed(0)}%</span>}
          </div>
        </div>

        {/* Lesson content */}
        <iframe
          ref={iframeRef}
          src={blobUrl}
          className="flex-1 w-full border-0"
          sandbox="allow-scripts allow-same-origin"
          title={currentLesson.title}
        />
      </div>
    );
  }

  return null;
}
