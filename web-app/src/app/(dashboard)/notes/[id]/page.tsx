'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuthStore } from '@/store/authStore';
import { useNotesStore } from '@/store/notesStore';
import { useSettingsStore } from '@/store/settingsStore';
import { notesApi, aiApi, ttsApi } from '@/lib/api';
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
  Volume2,
  Lightbulb,
  Image as ImageIcon,
  Download,
  ZoomIn,
  X,
  Mic,
  Play,
  Pause,
  Square,
  Settings
} from 'lucide-react';
import type { Note, ChatMessage, QuizQuestion, FlashcardContent, InfographicContent } from '@/types';

type TabType = 'notes' | 'chat' | 'quiz' | 'flashcards' | 'infographic' | 'podcast' | 'tts';

// Voice options for TTS (OpenAI voices with friendly names)
const TTS_VOICES = [
  { id: 'nova', name: 'Sarah', gender: 'Female', description: 'Friendly and upbeat' },
  { id: 'shimmer', name: 'Emily', gender: 'Female', description: 'Clear and professional' },
  { id: 'alloy', name: 'Alex', gender: 'Neutral', description: 'Balanced and versatile' },
  { id: 'echo', name: 'James', gender: 'Male', description: 'Warm and engaging' },
  { id: 'fable', name: 'Daniel', gender: 'Male', description: 'Expressive storyteller' },
  { id: 'onyx', name: 'Marcus', gender: 'Male', description: 'Deep and authoritative' },
];

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
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [isLoadingSuggestions, setIsLoadingSuggestions] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);

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
  const [podcastVoice, setPodcastVoice] = useState<string>('nova');

  // Infographic state
  const [infographicUrl, setInfographicUrl] = useState<string | null>(null);
  const [isGeneratingInfographic, setIsGeneratingInfographic] = useState(false);
  const [selectedStyle, setSelectedStyle] = useState<string>('modern');
  const [showFullscreenInfographic, setShowFullscreenInfographic] = useState(false);

  // TTS state
  const [ttsAudioUrl, setTtsAudioUrl] = useState<string | null>(null);
  const [isGeneratingTts, setIsGeneratingTts] = useState(false);
  const [selectedVoice, setSelectedVoice] = useState<string>('nova');
  const [ttsSpeed, setTtsSpeed] = useState<number>(1.0);
  const [isPlayingTts, setIsPlayingTts] = useState(false);
  const [ttsAudioRef, setTtsAudioRef] = useState<HTMLAudioElement | null>(null);

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
    // Reset infographic state
    setInfographicUrl(null);
    // Reset TTS state
    setTtsAudioUrl(null);
    if (ttsAudioRef) {
      ttsAudioRef.pause();
      setTtsAudioRef(null);
    }
    setIsPlayingTts(false);
    // Reset chat state
    setChatMessages([]);
    setChatInput('');
    setSuggestions([]);
    setShowSuggestions(false);
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
          // Infographic - handle both camelCase and snake_case
          if (content.infographic) {
            console.log('[NoteDetail] Has infographic content');
            const imageUrl = content.infographic.image_url || content.infographic.imageUrl;
            console.log('[NoteDetail] Infographic URL:', imageUrl);
            if (imageUrl) setInfographicUrl(imageUrl);
          }
          // TTS - handle both camelCase and snake_case
          if (content.tts) {
            console.log('[NoteDetail] Has TTS content');
            const audioUrl = content.tts.audio_url || content.tts.audioUrl;
            console.log('[NoteDetail] TTS URL:', audioUrl);
            if (audioUrl) {
              setTtsAudioUrl(audioUrl);
              setSelectedVoice(content.tts.voice || 'rachel');
              setTtsSpeed(content.tts.speed || 1.0);
            }
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

  // Fallback suggestions when API fails
  const FALLBACK_SUGGESTIONS = [
    "What are the main concepts in these notes?",
    "Can you summarize the key points?",
    "What should I focus on for an exam?"
  ];

  // Load chat suggestions
  const handleLoadSuggestions = async () => {
    if (!token || isLoadingSuggestions) return;

    setShowSuggestions(true);
    setIsLoadingSuggestions(true);

    try {
      const fetchedSuggestions = await aiApi.getSuggestions(token, noteId, language);
      setSuggestions(fetchedSuggestions.length > 0 ? fetchedSuggestions : FALLBACK_SUGGESTIONS);
    } catch (error) {
      console.error('Failed to load suggestions:', error);
      setSuggestions(FALLBACK_SUGGESTIONS);
    } finally {
      setIsLoadingSuggestions(false);
    }
  };

  // Handle suggestion click
  const handleSuggestionClick = (suggestion: string) => {
    // Remove the used suggestion from the list
    setSuggestions(prev => prev.filter(s => s !== suggestion));
    setChatInput(suggestion);
    // Automatically send the message
    handleSendChatWithMessage(suggestion);
  };

  // Chat handlers
  const handleSendChatWithMessage = async (message: string) => {
    if (!token || !message.trim() || isSendingChat) return;

    const userMessage: ChatMessage = {
      id: Date.now().toString(),
      role: 'user',
      content: message.trim(),
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

  const handleSendChat = async () => {
    if (!token || !chatInput.trim() || isSendingChat) return;
    handleSendChatWithMessage(chatInput);
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
      console.log('Starting podcast generation at:', new Date(generationStartTime).toISOString(), 'voice:', podcastVoice);
      const response = await aiApi.generatePodcast(token, noteId, { language, voice: podcastVoice });
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
    { id: 'infographic' as TabType, label: 'Infographic', icon: ImageIcon },
    { id: 'podcast' as TabType, label: 'Podcast', icon: Radio },
    { id: 'tts' as TabType, label: 'Read Aloud', icon: Mic },
  ];

  // Infographic handlers
  const handleGenerateInfographic = async () => {
    if (!token || isGeneratingInfographic) return;

    setIsGeneratingInfographic(true);
    setError(null);

    try {
      console.log('Starting infographic generation with style:', selectedStyle);
      const response = await aiApi.generateInfographic(token, noteId, selectedStyle);
      console.log('Infographic API response:', JSON.stringify(response, null, 2));
      const infographic = response.infographic as InfographicContent;
      const imageUrl = infographic?.image_url || infographic?.imageUrl;
      console.log('Extracted image URL:', imageUrl);

      if (imageUrl) {
        setInfographicUrl(imageUrl);
      }
    } catch (err) {
      console.error('Infographic generation error:', err);
      setError(err instanceof Error ? err.message : 'Failed to generate infographic');
    } finally {
      setIsGeneratingInfographic(false);
    }
  };

  const handleDownloadInfographic = async () => {
    if (!infographicUrl) return;

    try {
      const response = await fetch(infographicUrl);
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `infographic-${noteId}.png`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (err) {
      console.error('Failed to download infographic:', err);
    }
  };

  const infographicStyles = [
    { value: 'modern', label: 'Modern' },
    { value: 'colorful', label: 'Colorful' },
    { value: 'minimal', label: 'Minimal' },
    { value: 'professional', label: 'Professional' },
  ];

  // TTS handlers
  const handleGenerateTts = async () => {
    if (!token || isGeneratingTts || !currentNote) return;

    setIsGeneratingTts(true);
    setError(null);

    // Stop any existing audio
    if (ttsAudioRef) {
      ttsAudioRef.pause();
      setTtsAudioRef(null);
      setIsPlayingTts(false);
    }

    try {
      console.log('Generating TTS for note:', noteId, 'voice:', selectedVoice, 'speed:', ttsSpeed);

      // Use the new API that saves to storage
      const response = await ttsApi.generateForNote(token, noteId, {
        voice: selectedVoice,
        speed: ttsSpeed,
      });

      if (response.success && response.data) {
        setTtsAudioUrl(response.data.audio_url);

        // Create audio element for playback controls
        const audio = new Audio(response.data.audio_url);
        audio.playbackRate = ttsSpeed;

        audio.onended = () => {
          setIsPlayingTts(false);
        };

        audio.onerror = () => {
          setError('Failed to play audio');
          setIsPlayingTts(false);
        };

        setTtsAudioRef(audio);
      }
    } catch (err) {
      console.error('TTS generation error:', err);
      setError(err instanceof Error ? err.message : 'Failed to generate speech');
    } finally {
      setIsGeneratingTts(false);
    }
  };

  const handlePlayPauseTts = () => {
    if (!ttsAudioRef) return;

    if (isPlayingTts) {
      ttsAudioRef.pause();
      setIsPlayingTts(false);
    } else {
      ttsAudioRef.play();
      setIsPlayingTts(true);
    }
  };

  const handleStopTts = () => {
    if (ttsAudioRef) {
      ttsAudioRef.pause();
      ttsAudioRef.currentTime = 0;
      setIsPlayingTts(false);
    }
  };

  const handleDownloadTts = () => {
    if (!ttsAudioUrl) return;

    const a = document.createElement('a');
    a.href = ttsAudioUrl;
    a.download = `${currentNote?.title || 'note'}-audio.mp3`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

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
                  <p className="mb-4">Ask questions about this note</p>
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

              {/* Suggestions Section - shown after messages or in empty state */}
              {showSuggestions && suggestions.length > 0 && !isSendingChat && (
                <div className="mt-4 px-4">
                  <p className="text-xs text-[var(--text-muted)] mb-2 text-center">Suggested questions:</p>
                  <div className="space-y-2">
                    {suggestions.map((suggestion, index) => (
                      <button
                        key={index}
                        onClick={() => handleSuggestionClick(suggestion)}
                        className="w-full flex items-center justify-between p-3 bg-[var(--card-background)] hover:bg-[var(--surface-variant)] rounded-lg border border-[var(--border)] transition text-left group"
                      >
                        <span className="text-sm text-[var(--text-primary)] line-clamp-2">{suggestion}</span>
                        <Send className="w-4 h-4 text-[var(--accent-purple)] opacity-0 group-hover:opacity-100 transition flex-shrink-0 ml-2" />
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Loading suggestions */}
              {showSuggestions && isLoadingSuggestions && (
                <div className="flex items-center justify-center gap-2 py-4">
                  <Loader2 className="w-4 h-4 animate-spin text-[var(--accent-purple)]" />
                  <span className="text-sm text-[var(--text-muted)]">Generating suggestions...</span>
                </div>
              )}
            </div>

            {/* Input area with suggestions button */}
            <div className="space-y-2">
              {/* Get Suggestions button */}
              <div className="flex justify-center">
                <button
                  onClick={handleLoadSuggestions}
                  disabled={isLoadingSuggestions}
                  className="inline-flex items-center gap-2 px-4 py-2 text-sm bg-[var(--surface-variant)] hover:bg-[var(--card-background)] text-[var(--text-secondary)] hover:text-[var(--accent-purple)] rounded-full transition border border-[var(--border)]"
                >
                  <Lightbulb className="w-4 h-4" />
                  {isLoadingSuggestions ? 'Loading...' : showSuggestions && suggestions.length > 0 ? 'Get New Suggestions' : 'Get Question Suggestions'}
                </button>
              </div>

              {/* Chat input */}
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

        {/* Infographic Tab */}
        {activeTab === 'infographic' && (
          <div>
            {!infographicUrl ? (
              <div className="text-center py-8">
                <ImageIcon className="w-12 h-12 mx-auto mb-4 text-[var(--text-muted)] opacity-50" />
                <p className="text-[var(--text-muted)] mb-4">Generate a visual infographic summary of this note</p>

                {/* Style selector */}
                <div className="max-w-xs mx-auto mb-6">
                  <label className="block text-sm text-[var(--text-muted)] mb-2">Style</label>
                  <div className="flex flex-wrap gap-2 justify-center">
                    {infographicStyles.map((style) => (
                      <button
                        key={style.value}
                        onClick={() => setSelectedStyle(style.value)}
                        className={`px-4 py-2 rounded-lg text-sm font-medium transition ${
                          selectedStyle === style.value
                            ? 'bg-[var(--accent-purple)] text-white'
                            : 'bg-[var(--surface-variant)] text-[var(--text-secondary)] hover:bg-[var(--card-background)]'
                        }`}
                      >
                        {style.label}
                      </button>
                    ))}
                  </div>
                </div>

                <button
                  onClick={handleGenerateInfographic}
                  disabled={isGeneratingInfographic}
                  className="btn-primary"
                >
                  {isGeneratingInfographic ? (
                    <>
                      <Loader2 className="w-5 h-5 animate-spin mr-2" />
                      Generating... (this may take a minute)
                    </>
                  ) : (
                    'Generate Infographic'
                  )}
                </button>
              </div>
            ) : (
              <div className="text-center py-4">
                {/* Infographic image */}
                <div
                  className="relative inline-block cursor-pointer group mb-4"
                  onClick={() => setShowFullscreenInfographic(true)}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={infographicUrl}
                    alt="Generated infographic"
                    className="max-w-full max-h-[500px] rounded-lg shadow-lg transition group-hover:opacity-90"
                  />
                  <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition">
                    <div className="bg-black/50 rounded-full p-3">
                      <ZoomIn className="w-6 h-6 text-white" />
                    </div>
                  </div>
                </div>

                <p className="text-sm text-[var(--text-muted)] mb-4">Click image to view fullscreen</p>

                <div className="flex justify-center gap-3">
                  <button
                    onClick={handleDownloadInfographic}
                    className="btn-secondary flex items-center gap-2"
                  >
                    <Download size={18} />
                    Download
                  </button>
                  <button
                    onClick={handleGenerateInfographic}
                    disabled={isGeneratingInfographic}
                    className="btn-secondary flex items-center gap-2"
                  >
                    {isGeneratingInfographic ? (
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
              </div>
            )}
          </div>
        )}

        {/* Fullscreen Infographic Modal */}
        {showFullscreenInfographic && infographicUrl && (
          <div
            className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4"
            onClick={() => setShowFullscreenInfographic(false)}
          >
            <button
              onClick={() => setShowFullscreenInfographic(false)}
              className="absolute top-4 right-4 p-2 bg-white/10 rounded-full hover:bg-white/20 transition"
            >
              <X className="w-6 h-6 text-white" />
            </button>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={infographicUrl}
              alt="Generated infographic fullscreen"
              className="max-w-full max-h-full object-contain"
              onClick={(e) => e.stopPropagation()}
            />
          </div>
        )}

        {/* Podcast Tab */}
        {activeTab === 'podcast' && (
          <div>
            {!podcastUrl ? (
              <div className="text-center py-8">
                <Radio className="w-12 h-12 mx-auto mb-4 text-[var(--text-muted)] opacity-50" />
                <p className="text-[var(--text-muted)] mb-6">Generate an AI podcast discussion about this note</p>

                {/* Voice Selection */}
                <div className="max-w-lg mx-auto mb-6">
                  <label className="block text-sm text-[var(--text-muted)] mb-2">Select Narrator Voice</label>
                  <div className="flex flex-wrap gap-2 justify-center">
                    {TTS_VOICES.map(voice => (
                      <button
                        key={voice.id}
                        onClick={() => setPodcastVoice(voice.id)}
                        className={`px-4 py-2 rounded-lg text-sm font-medium transition ${
                          podcastVoice === voice.id
                            ? 'bg-[var(--accent-purple)] text-white'
                            : 'bg-[var(--surface-variant)] text-[var(--text-secondary)] hover:bg-[var(--card-background)]'
                        }`}
                        title={voice.description}
                      >
                        {voice.name}
                        <span className="ml-1 text-xs opacity-70">({voice.gender})</span>
                      </button>
                    ))}
                  </div>
                </div>

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
                <h3 className="text-lg font-medium mb-2">AI Podcast Ready</h3>
                <p className="text-sm text-[var(--text-muted)] mb-4">
                  Voice: {TTS_VOICES.find(v => v.id === podcastVoice)?.name || podcastVoice}
                </p>
                <audio
                  controls
                  src={podcastUrl}
                  className="w-full max-w-md mx-auto"
                />

                {/* Voice selection for regeneration */}
                <details className="mt-6 text-left max-w-lg mx-auto">
                  <summary className="cursor-pointer text-sm text-[var(--text-muted)] hover:text-[var(--text-primary)] flex items-center justify-center gap-2">
                    <Settings size={16} />
                    Change Voice
                  </summary>
                  <div className="mt-4">
                    <div className="flex flex-wrap gap-2 justify-center">
                      {TTS_VOICES.map(voice => (
                        <button
                          key={voice.id}
                          onClick={() => setPodcastVoice(voice.id)}
                          className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${
                            podcastVoice === voice.id
                              ? 'bg-[var(--accent-purple)] text-white'
                              : 'bg-[var(--surface-variant)] text-[var(--text-secondary)] hover:bg-[var(--card-background)]'
                          }`}
                          title={voice.description}
                        >
                          {voice.name}
                        </button>
                      ))}
                    </div>
                  </div>
                </details>

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

        {/* TTS (Read Aloud) Tab */}
        {activeTab === 'tts' && (
          <div>
            {!ttsAudioUrl ? (
              <div className="text-center py-8">
                <Mic className="w-12 h-12 mx-auto mb-4 text-[var(--text-muted)] opacity-50" />
                <p className="text-[var(--text-muted)] mb-4">Convert your notes to speech with AI voices</p>

                {/* Built-in Voice selector */}
                <div className="max-w-lg mx-auto mb-6">
                  <label className="block text-sm text-[var(--text-muted)] mb-2">Built-in Voices</label>
                  <div className="flex flex-wrap gap-2 justify-center">
                    {TTS_VOICES.map((voice) => (
                      <button
                        key={voice.id}
                        onClick={() => setSelectedVoice(voice.id)}
                        className={`px-4 py-2 rounded-lg text-sm font-medium transition ${
                          selectedVoice === voice.id
                            ? 'bg-[var(--accent-purple)] text-white'
                            : 'bg-[var(--surface-variant)] text-[var(--text-secondary)] hover:bg-[var(--card-background)]'
                        }`}
                      >
                        {voice.name}
                        <span className="ml-1 text-xs opacity-70">({voice.gender})</span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Speed selector */}
                <div className="max-w-xs mx-auto mb-6">
                  <label className="block text-sm text-[var(--text-muted)] mb-2">
                    Speed: {ttsSpeed}x
                  </label>
                  <input
                    type="range"
                    min="0.5"
                    max="2"
                    step="0.25"
                    value={ttsSpeed}
                    onChange={(e) => setTtsSpeed(parseFloat(e.target.value))}
                    className="w-full accent-[var(--accent-purple)]"
                  />
                  <div className="flex justify-between text-xs text-[var(--text-muted)] mt-1">
                    <span>0.5x</span>
                    <span>1x</span>
                    <span>1.5x</span>
                    <span>2x</span>
                  </div>
                </div>

                <button
                  onClick={handleGenerateTts}
                  disabled={isGeneratingTts}
                  className="btn-primary"
                >
                  {isGeneratingTts ? (
                    <>
                      <Loader2 className="w-5 h-5 animate-spin mr-2" />
                      Generating Audio...
                    </>
                  ) : (
                    <>
                      <Volume2 className="w-5 h-5 mr-2" />
                      Generate Audio
                    </>
                  )}
                </button>

                <p className="text-xs text-[var(--text-muted)] mt-4">
                  This will generate audio for the entire note content
                </p>
              </div>
            ) : (
              <div className="text-center py-8">
                <div className="w-24 h-24 mx-auto mb-6 rounded-full bg-[var(--accent-purple)] flex items-center justify-center">
                  <Volume2 className="w-12 h-12" />
                </div>
                <h3 className="text-lg font-medium mb-2">Audio Ready</h3>
                <p className="text-sm text-[var(--text-muted)] mb-6">
                  Voice: {TTS_VOICES.find(v => v.id === selectedVoice)?.name || selectedVoice} • Speed: {ttsSpeed}x
                </p>

                {/* Audio controls */}
                <div className="flex items-center justify-center gap-4 mb-6">
                  <button
                    onClick={handleStopTts}
                    className="p-3 rounded-full bg-[var(--surface-variant)] hover:bg-[var(--card-background)] transition"
                    title="Stop"
                  >
                    <Square size={24} />
                  </button>
                  <button
                    onClick={handlePlayPauseTts}
                    className="p-4 rounded-full bg-[var(--accent-purple)] hover:opacity-90 transition"
                    title={isPlayingTts ? 'Pause' : 'Play'}
                  >
                    {isPlayingTts ? <Pause size={32} /> : <Play size={32} />}
                  </button>
                  <button
                    onClick={handleDownloadTts}
                    className="p-3 rounded-full bg-[var(--surface-variant)] hover:bg-[var(--card-background)] transition"
                    title="Download"
                  >
                    <Download size={24} />
                  </button>
                </div>

                {/* Native audio element for additional controls */}
                <audio
                  controls
                  src={ttsAudioUrl}
                  className="w-full max-w-md mx-auto mb-4"
                  onPlay={() => setIsPlayingTts(true)}
                  onPause={() => setIsPlayingTts(false)}
                  onEnded={() => setIsPlayingTts(false)}
                />

                <div className="flex justify-center gap-3">
                  <button
                    onClick={handleGenerateTts}
                    disabled={isGeneratingTts}
                    className="btn-secondary flex items-center gap-2"
                  >
                    {isGeneratingTts ? (
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

                {/* Voice options in Audio Ready state */}
                <div className="mt-8 pt-6 border-t border-[var(--border-color)]">
                  <details className="text-left">
                    <summary className="cursor-pointer text-sm text-[var(--text-muted)] hover:text-[var(--text-primary)] flex items-center justify-center gap-2">
                      <Settings size={16} />
                      Voice Settings
                    </summary>
                    <div className="mt-4 space-y-4">
                      {/* Voices */}
                      <div>
                        <p className="text-xs text-[var(--text-muted)] mb-2">Select Voice</p>
                        <div className="flex flex-wrap justify-center gap-2">
                          {TTS_VOICES.map(voice => (
                            <button
                              key={voice.id}
                              onClick={() => setSelectedVoice(voice.id)}
                              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${
                                selectedVoice === voice.id
                                  ? 'bg-[var(--accent-purple)] text-white'
                                  : 'bg-[var(--surface-variant)] text-[var(--text-secondary)] hover:bg-[var(--card-background)]'
                              }`}
                              title={voice.description}
                            >
                              {voice.name}
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* Speed selector */}
                      <div className="max-w-xs mx-auto">
                        <label className="block text-xs text-[var(--text-muted)] mb-2">
                          Speed: {ttsSpeed}x
                        </label>
                        <input
                          type="range"
                          min="0.5"
                          max="2"
                          step="0.25"
                          value={ttsSpeed}
                          onChange={(e) => setTtsSpeed(parseFloat(e.target.value))}
                          className="w-full accent-[var(--accent-purple)]"
                        />
                      </div>
                    </div>
                  </details>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
