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

export interface InfographicContent {
  image_url?: string;
  imageUrl?: string;
  extracted_data?: InfographicExtractedData;
  style?: string;
}

export interface InfographicExtractedData {
  title?: string;
  subtitle?: string;
  key_stats?: InfographicStat[];
  main_sections?: InfographicSection[];
  key_takeaway?: string;
}

export interface InfographicStat {
  label: string;
  value: string;
  description?: string;
}

export interface InfographicSection {
  title: string;
  points: string[];
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

// Meeting types
export interface Meeting {
  id: string;
  user_id: string;
  title: string | null;
  meeting_url: string;
  platform: MeetingPlatform;
  status: MeetingStatus;
  scheduled_start: string | null;
  actual_start: string | null;
  actual_end: string | null;
  duration_seconds: number | null;
  error_message: string | null;
  note_id: string | null;
  created_at: string;
  updated_at: string;
  bot_runs?: BotRun[];
  meeting_recordings?: MeetingRecording[];
}

export type MeetingPlatform = 'zoom' | 'google_meet' | 'teams' | 'webex' | 'other';

export type MeetingStatus =
  | 'pending'
  | 'bot_joining'
  | 'in_progress'
  | 'recording'
  | 'processing'
  | 'transcribing'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface BotRun {
  id: string;
  meeting_id: string;
  recall_bot_id: string | null;
  status: string;
  join_time: string | null;
  leave_time: string | null;
  recording_path: string | null;
  transcript_raw: string | null;
}

export interface MeetingRecording {
  id: string;
  meeting_id: string;
  bot_run_id: string | null;
  storage_path: string;
  storage_url: string | null;
  file_size_bytes: number | null;
  duration_seconds: number | null;
  format: string | null;
  status: string;
  created_at: string;
}

export interface MeetingsPagination {
  page: number;
  limit: number;
  total: number;
  pages: number;
}

// Meeting status helper
export const getMeetingStatusInfo = (status: MeetingStatus) => {
  const statusMap: Record<MeetingStatus, { displayText: string; isActive: boolean; isCancellable: boolean }> = {
    pending: { displayText: 'Waiting to join', isActive: true, isCancellable: true },
    bot_joining: { displayText: 'Bot joining...', isActive: true, isCancellable: true },
    in_progress: { displayText: 'In meeting', isActive: true, isCancellable: true },
    recording: { displayText: 'Recording', isActive: true, isCancellable: true },
    processing: { displayText: 'Processing', isActive: true, isCancellable: false },
    transcribing: { displayText: 'Transcribing', isActive: true, isCancellable: false },
    completed: { displayText: 'Completed', isActive: false, isCancellable: false },
    failed: { displayText: 'Failed', isActive: false, isCancellable: false },
    cancelled: { displayText: 'Cancelled', isActive: false, isCancellable: false },
  };
  return statusMap[status];
};

// Meeting platform helper
export const getPlatformInfo = (platform: MeetingPlatform) => {
  const platformMap: Record<MeetingPlatform, { displayName: string; color: string }> = {
    zoom: { displayName: 'Zoom', color: '#2D8CFF' },
    google_meet: { displayName: 'Google Meet', color: '#00897B' },
    teams: { displayName: 'Microsoft Teams', color: '#6264A7' },
    webex: { displayName: 'Webex', color: '#FF7A00' },
    other: { displayName: 'Other', color: '#9E9E9E' },
  };
  return platformMap[platform];
};

// Meeting URL validator
export const validateMeetingUrl = (url: string): { valid: boolean; platform: MeetingPlatform | null } => {
  const lowercased = url.toLowerCase();

  if (lowercased.includes('zoom.us/j/') || lowercased.includes('zoom.us/my/')) {
    return { valid: true, platform: 'zoom' };
  }
  if (lowercased.includes('meet.google.com/')) {
    return { valid: true, platform: 'google_meet' };
  }
  if (lowercased.includes('teams.microsoft.com') || lowercased.includes('teams.live.com')) {
    return { valid: true, platform: 'teams' };
  }
  if (lowercased.includes('webex.com')) {
    return { valid: true, platform: 'webex' };
  }

  return { valid: false, platform: null };
};
