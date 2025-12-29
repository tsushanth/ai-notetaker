// Note types matching backend/mobile apps
export interface Note {
  id: string;
  user_id: string;
  title: string;
  content: string;
  formatted_content?: string;
  source_type?: string;
  source_url?: string;
  youtube_url?: string;
  audio_url?: string;
  metadata?: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface AIContent {
  id: string;
  note_id: string;
  content_type: 'quiz' | 'flashcards' | 'summary' | 'podcast';
  content: QuizContent | FlashcardContent[] | string | PodcastContent;
  language?: string;
  created_at: string;
}

export interface QuizContent {
  questions: QuizQuestion[];
}

export interface QuizQuestion {
  id: string;
  question: string;
  options: string[];
  correctAnswer: number;
  explanation?: string;
}

export interface FlashcardContent {
  id: string;
  front: string;
  back: string;
}

export interface PodcastContent {
  audioUrl?: string;
  transcript?: PodcastSegment[];
  duration?: number;
}

export interface PodcastSegment {
  speaker: string;
  text: string;
  timestamp?: number;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

export interface User {
  id: string;
  email: string;
  name?: string;
  avatar_url?: string;
  subscription_status?: 'free' | 'trial' | 'premium';
  trial_end_date?: string;
}

export interface AuthState {
  user: User | null;
  token: string | null;
  isLoading: boolean;
  isAuthenticated: boolean;
}
