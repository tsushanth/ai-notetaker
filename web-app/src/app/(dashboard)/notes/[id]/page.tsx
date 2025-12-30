'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuthStore } from '@/store/authStore';
import { useNotesStore } from '@/store/notesStore';
import { useSettingsStore } from '@/store/settingsStore';
import { notesApi, aiApi } from '@/lib/api';
import {
  ArrowLeft,
  FileText,
  MessageSquare,
  HelpCircle,
  Layers,
  Radio,
  Loader2,
  Share2,
  Trash2,
  Send,
  RotateCcw,
  ChevronLeft,
  ChevronRight,
  Volume2
} from 'lucide-react';
import type { Note, ChatMessage, QuizQuestion, FlashcardContent } from '@/types';

type TabType = 'notes' | 'chat' | 'quiz' | 'flashcards' | 'podcast';

export default function NoteDetailPage() {
  const params = useParams();
  const router = useRouter();
  const noteId = params.id as string;

  const { token } = useAuthStore();
  const { currentNote, setCurrentNote, removeNote } = useNotesStore();
  const { language } = useSettingsStore();

  const [activeTab, setActiveTab] = useState<TabType>('notes');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Chat state
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [isSendingChat, setIsSendingChat] = useState(false);

  // Quiz state
  const [quizQuestions, setQuizQuestions] = useState<QuizQuestion[]>([]);
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [selectedAnswer, setSelectedAnswer] = useState<number | null>(null);
  const [showResult, setShowResult] = useState(false);
  const [score, setScore] = useState(0);
  const [isGeneratingQuiz, setIsGeneratingQuiz] = useState(false);

  // Flashcards state
  const [flashcards, setFlashcards] = useState<FlashcardContent[]>([]);
  const [currentCardIndex, setCurrentCardIndex] = useState(0);
  const [isFlipped, setIsFlipped] = useState(false);
  const [isGeneratingFlashcards, setIsGeneratingFlashcards] = useState(false);

  // Podcast state
  const [podcastUrl, setPodcastUrl] = useState<string | null>(null);
  const [isGeneratingPodcast, setIsGeneratingPodcast] = useState(false);
  const [podcastGenerationStartTime, setPodcastGenerationStartTime] = useState<number | null>(null);

  // Track last fetch time to force re-fetch when navigating back
  const [lastFetchTime, setLastFetchTime] = useState<number>(0);

  // Reset all state and re-fetch when noteId changes or when returning to this page
  useEffect(() => {
    const now = Date.now();
    console.log('[NoteDetail] Effect triggered, noteId:', noteId, 'lastFetch:', lastFetchTime, 'now:', now);

    // Always reset and re-fetch on mount or when noteId changes
    // Reset quiz state
    setQuizQuestions([]);
    setCurrentQuestionIndex(0);
    setSelectedAnswer(null);
    setShowResult(false);
    setScore(0);
    // Reset flashcard state
    setFlashcards([]);
    setCurrentCardIndex(0);
    setIsFlipped(false);
    // Reset podcast state
    setPodcastUrl(null);
    // Reset chat state
    setChatMessages([]);
    setChatInput('');
    // Reset tab to notes
    setActiveTab('notes');

    if (token && noteId) {
      console.log('[NoteDetail] Starting fresh fetch for note:', noteId);
      setLastFetchTime(now);
      fetchNote();
    }
  }, [token, noteId]);

  const fetchNote = async () => {
    if (!token) return;

    setIsLoading(true);
    setError(null);

    try {
      const response = await notesApi.getById(token, noteId);
      setCurrentNote(response.note as Note);

      // Also fetch AI content
      try {
        console.log('[NoteDetail] Fetching AI content for note:', noteId);
        const aiContentResponse = await aiApi.getContent(token, noteId);
        const content = aiContentResponse.content as any;
        console.log('[NoteDetail] AI content types received:', Object.keys(content || {}));
        if (content) {
          // Quiz data - handle various nested response formats
          if (content.quiz) {
            console.log('[NoteDetail] Has quiz content');
            let quizData = content.quiz.questions;
            if (quizData && !Array.isArray(quizData)) {
              quizData = quizData.quiz_questions || quizData.questions;
            }
            if (!Array.isArray(quizData)) {
              quizData = content.quiz.quiz_questions || content.quiz;
            }
            if (Array.isArray(quizData)) {
              // Transform backend format to frontend format
              const letterToIndex: Record<string, number> = { 'A': 0, 'B': 1, 'C': 2, 'D': 3 };
              const transformedQuestions = quizData.map((q: any) => ({
                ...q,
                correctAnswer: q.correctAnswer ?? letterToIndex[q.correct_answer] ?? 0,
              }));
              setQuizQuestions(transformedQuestions);
            }
          }
          // Flashcards - handle various response formats
          if (content.flashcards) {
            console.log('[NoteDetail] Has flashcards content');
            const flashcardsData = content.flashcards.flashcards || content.flashcards.cards || content.flashcards;
            if (Array.isArray(flashcardsData)) {
              console.log('[NoteDetail] Setting', flashcardsData.length, 'flashcards');
              setFlashcards(flashcardsData);
            }
          }
          // Podcast - handle both camelCase and snake_case
          if (content.podcast) {
            console.log('[NoteDetail] Has podcast content');
            const audioUrl = content.podcast.audio_url || content.podcast.audioUrl;
            console.log('[NoteDetail] Podcast URL:', audioUrl);
            if (audioUrl) setPodcastUrl(audioUrl);
          }
        }
      } catch {
        // AI content might not exist yet
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch note');
    } finally {
      setIsLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!token || !confirm('Are you sure you want to delete this note?')) return;

    try {
      await notesApi.delete(token, noteId);
      removeNote(noteId);
      router.push('/notes');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete note');
    }
  };

  const handleShare = () => {
    if (currentNote) {
      navigator.share?.({
        title: currentNote.title,
        text: currentNote.content.slice(0, 200) + '...',
      }).catch(() => {
        // Fallback: copy to clipboard
        navigator.clipboard.writeText(currentNote.content);
        alert('Content copied to clipboard');
      });
    }
  };

  // Chat handlers
  const handleSendChat = async () => {
    if (!token || !chatInput.trim() || isSendingChat) return;

    const userMessage: ChatMessage = {
      id: Date.now().toString(),
      role: 'user',
      content: chatInput.trim(),
      timestamp: new Date(),
    };

    setChatMessages(prev => [...prev, userMessage]);
    setChatInput('');
    setIsSendingChat(true);

    try {
      const response = await aiApi.chat(token, noteId, userMessage.content, chatMessages, language);
      const assistantMessage: ChatMessage = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: response.response,
        timestamp: new Date(),
      };
      setChatMessages(prev => [...prev, assistantMessage]);
    } catch (err) {
      setChatMessages(prev => [...prev, {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: 'Sorry, I encountered an error. Please try again.',
        timestamp: new Date(),
      }]);
    } finally {
      setIsSendingChat(false);
    }
  };

  // Quiz handlers
  const handleGenerateQuiz = async () => {
    console.log('handleGenerateQuiz called', { token: !!token, isGeneratingQuiz });
    if (!token || isGeneratingQuiz) {
      console.log('Early return: token missing or already generating');
      return;
    }

    setIsGeneratingQuiz(true);
    try {
      const response = await aiApi.generateQuiz(token, noteId, language);
      console.log('Quiz API response:', JSON.stringify(response, null, 2));
      const quiz = response.quiz as any;
      // Handle various nested response formats
      // Could be: quiz.questions (array), quiz.questions.quiz_questions (array), or quiz itself
      let questions = quiz?.questions;
      if (questions && !Array.isArray(questions)) {
        // questions is an object containing quiz_questions array
        questions = questions.quiz_questions || questions.questions;
      }
      if (!Array.isArray(questions)) {
        questions = quiz?.quiz_questions || quiz;
      }
      console.log('Extracted questions:', JSON.stringify(questions, null, 2));
      if (Array.isArray(questions)) {
        // Transform backend format to frontend format
        // Backend: { correct_answer: "A", options: ["A) ...", "B) ..."] }
        // Frontend: { correctAnswer: 0, options: ["...", "..."] }
        const transformedQuestions = questions.map((q: any) => {
          // Convert letter answer (A, B, C, D) to index (0, 1, 2, 3)
          const letterToIndex: Record<string, number> = { 'A': 0, 'B': 1, 'C': 2, 'D': 3 };
          const correctAnswer = q.correctAnswer ?? letterToIndex[q.correct_answer] ?? 0;
          return {
            ...q,
            correctAnswer,
          };
        });
        console.log('Transformed questions:', JSON.stringify(transformedQuestions, null, 2));
        setQuizQuestions(transformedQuestions);
      }
      setCurrentQuestionIndex(0);
      setSelectedAnswer(null);
      setShowResult(false);
      setScore(0);
    } catch (err) {
      console.error('Quiz generation error:', err);
      setError(err instanceof Error ? err.message : 'Failed to generate quiz');
    } finally {
      setIsGeneratingQuiz(false);
    }
  };

  const handleAnswerSelect = (answerIndex: number) => {
    if (showResult) return;
    setSelectedAnswer(answerIndex);
  };

  const handleCheckAnswer = () => {
    if (selectedAnswer === null) return;
    setShowResult(true);
    if (selectedAnswer === quizQuestions[currentQuestionIndex].correctAnswer) {
      setScore(prev => prev + 1);
    }
  };

  const handleNextQuestion = () => {
    if (currentQuestionIndex < quizQuestions.length - 1) {
      setCurrentQuestionIndex(prev => prev + 1);
      setSelectedAnswer(null);
      setShowResult(false);
    }
  };

  // Flashcard handlers
  const handleGenerateFlashcards = async () => {
    if (!token || isGeneratingFlashcards) return;

    setIsGeneratingFlashcards(true);
    try {
      const response = await aiApi.generateFlashcards(token, noteId, language);
      console.log('Flashcards API response:', JSON.stringify(response, null, 2));
      const flashcardsData = response.flashcards as any;
      console.log('flashcardsData:', JSON.stringify(flashcardsData, null, 2));
      // Handle various response formats: .flashcards, .cards, or direct array
      const cards = flashcardsData?.flashcards || flashcardsData?.cards || flashcardsData;
      console.log('Extracted cards:', JSON.stringify(cards, null, 2));
      console.log('Is array?', Array.isArray(cards));
      if (Array.isArray(cards)) {
        setFlashcards(cards);
        console.log('Set flashcards state with', cards.length, 'cards');
      } else {
        console.log('Cards is not an array, type:', typeof cards);
      }
      setCurrentCardIndex(0);
      setIsFlipped(false);
    } catch (err) {
      console.error('Flashcards generation error:', err);
      setError(err instanceof Error ? err.message : 'Failed to generate flashcards');
    } finally {
      setIsGeneratingFlashcards(false);
    }
  };

  // Podcast handlers
  const handleGeneratePodcast = async () => {
    if (!token || isGeneratingPodcast) return;

    const generationStartTime = Date.now();
    setPodcastGenerationStartTime(generationStartTime);
    setIsGeneratingPodcast(true);
    setError(null); // Clear any previous errors

    try {
      console.log('Starting podcast generation at:', new Date(generationStartTime).toISOString());
      const response = await aiApi.generatePodcast(token, noteId, language);
      console.log('Podcast API response:', JSON.stringify(response, null, 2));
      const podcast = response.podcast as any;
      // Handle both camelCase and snake_case, and async generation
      const audioUrl = podcast?.audio_url || podcast?.audioUrl;
      console.log('Extracted audio URL:', audioUrl, 'Status:', podcast?.status);

      if (audioUrl) {
        setPodcastUrl(audioUrl);
        setIsGeneratingPodcast(false);
        setPodcastGenerationStartTime(null);
      } else if (podcast?.status === 'generating' || podcast?.message?.includes('generating')) {
        // Podcast is generating async, start polling for status
        console.log('Podcast is generating, starting to poll...');
        pollPodcastStatus(generationStartTime);
        // Keep isGeneratingPodcast true while polling
      } else {
        console.log('No audio URL and not generating status, checking response structure...');
        // Maybe the response structure is different - check if it has a message indicating it started
        if (podcast?.message) {
          console.log('Podcast message:', podcast.message);
          // Assume it's generating if we got a message but no audio_url
          pollPodcastStatus(generationStartTime);
        } else {
          setIsGeneratingPodcast(false);
          setPodcastGenerationStartTime(null);
        }
      }
    } catch (err) {
      console.error('Podcast generation error:', err);
      setError(err instanceof Error ? err.message : 'Failed to generate podcast');
      setIsGeneratingPodcast(false);
      setPodcastGenerationStartTime(null);
    }
  };

  // Poll for podcast generation status
  const pollPodcastStatus = (generationStartTime: number) => {
    if (!token) return;

    const checkStatus = async (): Promise<boolean> => {
      try {
        // Add cache-busting timestamp and random to prevent 304 responses
        const timestamp = Date.now();
        const random = Math.random().toString(36).substring(7);
        const url = `https://ai-notetaker-backend-917362189743.us-central1.run.app/api/ai/podcast/status/${noteId}?t=${timestamp}&r=${random}`;

        console.log('Fetching podcast status from:', url);

        const response = await fetch(url, {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Cache-Control': 'no-cache, no-store, must-revalidate',
            'Pragma': 'no-cache',
            'Expires': '0',
          },
          cache: 'no-store', // Force no caching at fetch level
        });

        console.log('Podcast status HTTP response:', response.status);

        if (!response.ok) {
          console.log('Podcast status response not ok:', response.status);
          return false;
        }

        const data = await response.json();
        console.log('Podcast status data:', JSON.stringify(data, null, 2));

        if (data.success && data.data?.status === 'ready') {
          // Check if this podcast was created AFTER we started generation
          // This prevents showing an old cached podcast when regenerating
          const podcastCreatedAt = data.data.created_at ? new Date(data.data.created_at).getTime() : 0;
          const isNewPodcast = podcastCreatedAt > generationStartTime - 5000; // 5 second buffer

          console.log('Podcast created_at:', data.data.created_at, 'Generation started:', new Date(generationStartTime).toISOString(), 'Is new:', isNewPodcast);

          if (!isNewPodcast) {
            console.log('Podcast is old (created before regeneration started), continuing to poll...');
            return false;
          }

          const audioUrl = data.data.audio_url || data.data.audioUrl;
          console.log('Podcast ready! Audio URL:', audioUrl);
          if (audioUrl) {
            setPodcastUrl(audioUrl);
            setIsGeneratingPodcast(false);
            setPodcastGenerationStartTime(null);
            return true;
          }
        } else {
          console.log('Podcast not ready yet, status:', data.data?.status);
        }
        return false;
      } catch (err) {
        console.error('Error checking podcast status:', err);
        return false;
      }
    };

    // Poll every 5 seconds for up to 3 minutes (podcast can take a while)
    let attempts = 0;
    const maxAttempts = 36; // 3 minutes

    console.log('Starting podcast status polling...');

    const poll = async () => {
      attempts++;
      console.log(`Polling podcast status, attempt ${attempts}/${maxAttempts}`);

      const done = await checkStatus();

      if (done) {
        console.log('Podcast is ready, stopping polling');
        return;
      }

      if (attempts >= maxAttempts) {
        console.log('Max polling attempts reached');
        setError('Podcast generation timed out. Please try again.');
        setIsGeneratingPodcast(false);
        setPodcastGenerationStartTime(null);
        return;
      }

      // Schedule next poll
      setTimeout(poll, 5000);
    };

    // Start polling after a short delay to give backend time to start
    setTimeout(poll, 3000);
  };

  const tabs = [
    { id: 'notes' as TabType, label: 'Notes', icon: FileText },
    { id: 'chat' as TabType, label: 'Chat', icon: MessageSquare },
    { id: 'quiz' as TabType, label: 'Quiz', icon: HelpCircle },
    { id: 'flashcards' as TabType, label: 'Flashcards', icon: Layers },
    { id: 'podcast' as TabType, label: 'Podcast', icon: Radio },
  ];

  if (isLoading) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-[var(--accent-purple)]" />
      </div>
    );
  }

  if (error || !currentNote) {
    return (
      <div className="max-w-4xl mx-auto px-6 py-8">
        <div className="card text-center py-8">
          <p className="text-[var(--accent-red)] mb-4">{error || 'Note not found'}</p>
          <Link href="/notes" className="btn-secondary">
            Back to Notes
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto px-6 py-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-4">
          <Link
            href="/notes"
            className="p-2 rounded-lg hover:bg-[var(--card-background)] transition"
          >
            <ArrowLeft size={20} />
          </Link>
          <div>
            <h1 className="text-xl font-bold">{currentNote.title}</h1>
            <p className="text-sm text-[var(--text-muted)]">
              {new Date(currentNote.created_at).toLocaleDateString('en-US', {
                month: 'long',
                day: 'numeric',
                year: 'numeric'
              })}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleShare}
            className="p-2 rounded-lg hover:bg-[var(--card-background)] transition"
            title="Share"
          >
            <Share2 size={20} />
          </button>
          <button
            onClick={handleDelete}
            className="p-2 rounded-lg hover:bg-[var(--accent-red)] transition text-[var(--accent-red)] hover:text-white"
            title="Delete"
          >
            <Trash2 size={20} />
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 p-1 bg-[var(--card-background)] rounded-lg mb-6 overflow-x-auto">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-2 px-4 py-2 rounded-md font-medium transition whitespace-nowrap ${
              activeTab === tab.id
                ? 'bg-[var(--accent-purple)] text-white'
                : 'text-[var(--text-secondary)] hover:text-white'
            }`}
          >
            <tab.icon size={18} />
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div className="card min-h-[400px]">
        {/* Notes Tab */}
        {activeTab === 'notes' && (
          <div className="prose prose-invert max-w-none">
            <div className="whitespace-pre-wrap text-[var(--text-primary)]">
              {currentNote.formatted_content || currentNote.content}
            </div>
          </div>
        )}

        {/* Chat Tab */}
        {activeTab === 'chat' && (
          <div className="flex flex-col h-[500px]">
            <div className="flex-1 overflow-y-auto space-y-4 mb-4">
              {chatMessages.length === 0 && (
                <div className="text-center py-8 text-[var(--text-muted)]">
                  <MessageSquare className="w-12 h-12 mx-auto mb-4 opacity-50" />
                  <p>Ask questions about this note</p>
                </div>
              )}
              {chatMessages.map((message) => (
                <div
                  key={message.id}
                  className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  <div
                    className={`max-w-[80%] rounded-lg px-4 py-2 ${
                      message.role === 'user'
                        ? 'bg-[var(--accent-purple)] text-white'
                        : 'bg-[var(--surface-variant)]'
                    }`}
                  >
                    {message.content}
                  </div>
                </div>
              ))}
              {isSendingChat && (
                <div className="flex justify-start">
                  <div className="bg-[var(--surface-variant)] rounded-lg px-4 py-2">
                    <Loader2 className="w-5 h-5 animate-spin" />
                  </div>
                </div>
              )}
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSendChat()}
                placeholder="Ask a question..."
                className="input flex-1"
              />
              <button
                onClick={handleSendChat}
                disabled={!chatInput.trim() || isSendingChat}
                className="btn-primary px-4"
              >
                <Send size={20} />
              </button>
            </div>
          </div>
        )}

        {/* Quiz Tab */}
        {activeTab === 'quiz' && (
          <div>
            {quizQuestions.length === 0 ? (
              <div className="text-center py-8">
                <HelpCircle className="w-12 h-12 mx-auto mb-4 text-[var(--text-muted)] opacity-50" />
                <p className="text-[var(--text-muted)] mb-4">Generate a quiz to test your knowledge</p>
                <button
                  onClick={handleGenerateQuiz}
                  disabled={isGeneratingQuiz}
                  className="btn-primary"
                >
                  {isGeneratingQuiz ? (
                    <>
                      <Loader2 className="w-5 h-5 animate-spin mr-2" />
                      Generating...
                    </>
                  ) : (
                    'Generate Quiz'
                  )}
                </button>
              </div>
            ) : (
              <div>
                <div className="flex justify-between items-center mb-6">
                  <span className="text-sm text-[var(--text-muted)]">
                    Question {currentQuestionIndex + 1} of {quizQuestions.length}
                  </span>
                  <span className="text-sm font-medium">
                    Score: {score}/{currentQuestionIndex + (showResult ? 1 : 0)}
                  </span>
                </div>

                <h3 className="text-lg font-medium mb-4">
                  {quizQuestions[currentQuestionIndex].question}
                </h3>

                <div className="space-y-2 mb-6">
                  {quizQuestions[currentQuestionIndex].options.map((option, index) => {
                    // Strip letter prefix if present (e.g., "A) " or "A. ")
                    const displayOption = option.replace(/^[A-D][)\.\s]+\s*/, '');
                    return (
                      <button
                        key={index}
                        onClick={() => handleAnswerSelect(index)}
                        disabled={showResult}
                        className={`w-full text-left p-4 rounded-lg border transition ${
                          selectedAnswer === index
                            ? showResult
                              ? index === quizQuestions[currentQuestionIndex].correctAnswer
                                ? 'border-[var(--accent-green)] bg-green-500/10'
                                : 'border-[var(--accent-red)] bg-red-500/10'
                              : 'border-[var(--accent-purple)] bg-purple-500/10'
                            : showResult && index === quizQuestions[currentQuestionIndex].correctAnswer
                              ? 'border-[var(--accent-green)] bg-green-500/10'
                              : 'border-[var(--border)] hover:border-[var(--accent-purple)]'
                        }`}
                      >
                        <div className="flex items-center gap-3">
                          <span className="w-6 h-6 rounded-full border flex items-center justify-center text-sm">
                            {String.fromCharCode(65 + index)}
                          </span>
                          {displayOption}
                        </div>
                      </button>
                    );
                  })}
                </div>

                <div className="flex justify-between">
                  {!showResult ? (
                    <button
                      onClick={handleCheckAnswer}
                      disabled={selectedAnswer === null}
                      className="btn-primary"
                    >
                      Check Answer
                    </button>
                  ) : (
                    <button
                      onClick={handleNextQuestion}
                      disabled={currentQuestionIndex >= quizQuestions.length - 1}
                      className="btn-primary"
                    >
                      {currentQuestionIndex >= quizQuestions.length - 1 ? 'Quiz Complete!' : 'Next Question'}
                    </button>
                  )}
                  <button
                    onClick={handleGenerateQuiz}
                    disabled={isGeneratingQuiz}
                    className="btn-secondary flex items-center gap-2"
                  >
                    {isGeneratingQuiz ? (
                      <>
                        <Loader2 size={18} className="animate-spin" />
                        Generating...
                      </>
                    ) : (
                      <>
                        <RotateCcw size={18} />
                        New Quiz
                      </>
                    )}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Flashcards Tab */}
        {activeTab === 'flashcards' && (
          <div>
            {flashcards.length === 0 ? (
              <div className="text-center py-8">
                <Layers className="w-12 h-12 mx-auto mb-4 text-[var(--text-muted)] opacity-50" />
                <p className="text-[var(--text-muted)] mb-4">Generate flashcards to study key concepts</p>
                <button
                  onClick={handleGenerateFlashcards}
                  disabled={isGeneratingFlashcards}
                  className="btn-primary"
                >
                  {isGeneratingFlashcards ? (
                    <>
                      <Loader2 className="w-5 h-5 animate-spin mr-2" />
                      Generating...
                    </>
                  ) : (
                    'Generate Flashcards'
                  )}
                </button>
              </div>
            ) : (
              <div>
                <div className="text-center mb-4 text-sm text-[var(--text-muted)]">
                  Card {currentCardIndex + 1} of {flashcards.length}
                </div>

                <div
                  onClick={() => setIsFlipped(!isFlipped)}
                  className="cursor-pointer min-h-[250px] flex items-center justify-center p-8 bg-[var(--surface-variant)] rounded-lg mb-6 transition-transform hover:scale-[1.02]"
                >
                  <p className="text-lg text-center">
                    {isFlipped ? flashcards[currentCardIndex].back : flashcards[currentCardIndex].front}
                  </p>
                </div>

                <p className="text-center text-sm text-[var(--text-muted)] mb-4">
                  Click card to flip
                </p>

                <div className="flex justify-between items-center">
                  <button
                    onClick={() => {
                      setCurrentCardIndex(prev => prev - 1);
                      setIsFlipped(false);
                    }}
                    disabled={currentCardIndex === 0}
                    className="btn-secondary flex items-center gap-2"
                  >
                    <ChevronLeft size={18} />
                    Previous
                  </button>
                  <button
                    onClick={handleGenerateFlashcards}
                    disabled={isGeneratingFlashcards}
                    className="btn-secondary"
                    title="Generate new flashcards"
                  >
                    {isGeneratingFlashcards ? (
                      <Loader2 size={18} className="animate-spin" />
                    ) : (
                      <RotateCcw size={18} />
                    )}
                  </button>
                  <button
                    onClick={() => {
                      setCurrentCardIndex(prev => prev + 1);
                      setIsFlipped(false);
                    }}
                    disabled={currentCardIndex === flashcards.length - 1}
                    className="btn-secondary flex items-center gap-2"
                  >
                    Next
                    <ChevronRight size={18} />
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Podcast Tab */}
        {activeTab === 'podcast' && (
          <div>
            {!podcastUrl ? (
              <div className="text-center py-8">
                <Radio className="w-12 h-12 mx-auto mb-4 text-[var(--text-muted)] opacity-50" />
                <p className="text-[var(--text-muted)] mb-4">Generate an AI podcast discussion about this note</p>
                <button
                  onClick={handleGeneratePodcast}
                  disabled={isGeneratingPodcast}
                  className="btn-primary"
                >
                  {isGeneratingPodcast ? (
                    <>
                      <Loader2 className="w-5 h-5 animate-spin mr-2" />
                      Generating...
                    </>
                  ) : (
                    'Generate Podcast'
                  )}
                </button>
              </div>
            ) : (
              <div className="text-center py-8">
                <div className="w-24 h-24 mx-auto mb-6 rounded-full bg-[var(--accent-purple)] flex items-center justify-center">
                  <Volume2 className="w-12 h-12" />
                </div>
                <h3 className="text-lg font-medium mb-4">AI Podcast Ready</h3>
                <audio
                  controls
                  src={podcastUrl}
                  className="w-full max-w-md mx-auto"
                />
                <button
                  onClick={handleGeneratePodcast}
                  disabled={isGeneratingPodcast}
                  className="btn-secondary mt-4 flex items-center gap-2 mx-auto"
                >
                  {isGeneratingPodcast ? (
                    <>
                      <Loader2 size={18} className="animate-spin" />
                      Generating...
                    </>
                  ) : (
                    <>
                      <RotateCcw size={18} />
                      Regenerate
                    </>
                  )}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
