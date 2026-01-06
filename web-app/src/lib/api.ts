// API client for communicating with the backend
// Hardcoded for reliability in production builds
const API_BASE_URL = 'https://ai-notetaker-backend-917362189743.us-central1.run.app';

interface ApiOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  body?: unknown;
  token?: string;
  headers?: Record<string, string>;
}

async function apiRequest<T>(endpoint: string, options: ApiOptions = {}): Promise<T> {
  const { method = 'GET', body, token, headers = {} } = options;

  const requestHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
    ...headers,
  };

  if (token) {
    requestHeaders['Authorization'] = `Bearer ${token}`;
  }

  const response = await fetch(`${API_BASE_URL}${endpoint}`, {
    method,
    headers: requestHeaders,
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({ message: 'Request failed' }));
    // Backend returns errors as { success: false, error: "message" } or { message: "message" }
    const errorMessage = errorData.error || errorData.message || `API Error: ${response.status}`;
    throw new Error(errorMessage);
  }

  return response.json();
}

// Auth API
export const authApi = {
  loginWithGoogle: async (idToken: string) => {
    return apiRequest<{ token: string; user: unknown }>('/api/auth/google', {
      method: 'POST',
      body: { idToken },
    });
  },

  loginWithApple: async (idToken: string) => {
    return apiRequest<{ token: string; user: unknown }>('/api/auth/apple', {
      method: 'POST',
      body: { idToken },
    });
  },

  loginWithEmail: async (email: string, password: string) => {
    return apiRequest<{ token: string; user: unknown }>('/api/auth/login', {
      method: 'POST',
      body: { email, password },
    });
  },

  register: async (email: string, password: string, name?: string) => {
    return apiRequest<{ token: string; user: unknown }>('/api/auth/register', {
      method: 'POST',
      body: { email, password, name },
    });
  },

  getProfile: async (token: string) => {
    return apiRequest<{ user: unknown }>('/api/auth/profile', { token });
  },
};

// Notes API
export const notesApi = {
  getAll: async (token: string) => {
    const response = await apiRequest<{ success: boolean; data: unknown[]; pagination?: unknown }>('/api/notes', { token });
    // Map backend response format to expected format
    return { notes: response.data || [] };
  },

  getById: async (token: string, noteId: string) => {
    const response = await apiRequest<{ success: boolean; data: unknown }>(`/api/notes/${noteId}`, { token });
    return { note: response.data };
  },

  create: async (token: string, data: { title: string; content: string; sourceType?: string }) => {
    return apiRequest<{ note: unknown }>('/api/notes', {
      method: 'POST',
      token,
      body: data,
    });
  },

  update: async (token: string, noteId: string, data: Partial<{ title: string; content: string }>) => {
    return apiRequest<{ note: unknown }>(`/api/notes/${noteId}`, {
      method: 'PUT',
      token,
      body: data,
    });
  },

  delete: async (token: string, noteId: string) => {
    return apiRequest<{ success: boolean }>(`/api/notes/${noteId}`, {
      method: 'DELETE',
      token,
    });
  },

  // Upload endpoints
  uploadAudio: async (token: string, formData: FormData) => {
    const response = await fetch(`${API_BASE_URL}/api/notes/upload/audio`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
      },
      body: formData,
    });

    if (!response.ok) {
      throw new Error('Failed to upload audio');
    }

    return response.json();
  },

  uploadPdf: async (token: string, formData: FormData) => {
    const response = await fetch(`${API_BASE_URL}/api/notes/upload/pdf`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
      },
      body: formData,
    });

    if (!response.ok) {
      throw new Error('Failed to upload PDF');
    }

    return response.json();
  },

  processYoutube: async (token: string, url: string) => {
    return apiRequest<{ note: unknown }>('/api/notes/youtube', {
      method: 'POST',
      token,
      body: { url },
    });
  },
};

// AI Content API
export const aiApi = {
  getContent: async (token: string, noteId: string) => {
    // Use direct fetch with cache-busting to prevent stale content after regeneration
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(7);
    const url = `${API_BASE_URL}/api/ai/note/${noteId}?t=${timestamp}&r=${random}`;

    console.log('[getContent] Fetching AI content from:', url);

    const fetchResponse = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
      },
      cache: 'no-store', // Next.js specific - prevent caching
    });

    console.log('[getContent] HTTP status:', fetchResponse.status);

    if (!fetchResponse.ok) {
      throw new Error(`Failed to fetch AI content: ${fetchResponse.status}`);
    }

    const response = await fetchResponse.json() as { success: boolean; data: unknown[] };

    // Transform array of AI content items into organized object by content_type
    // Backend returns items ordered by created_at DESC (newest first)
    // We only keep the first (newest) item of each type
    const aiContentArray = response.data || [];
    const organized: Record<string, unknown> = {};

    console.log('[getContent] Raw response item count:', aiContentArray.length);

    for (const item of aiContentArray as Array<{ content_type: string; content: unknown; created_at?: string }>) {
      if (item.content_type && item.content) {
        // Only set if not already set (keep the first/newest one)
        if (!organized[item.content_type]) {
          console.log(`[getContent] Setting ${item.content_type} from item created at:`, item.created_at);
          organized[item.content_type] = item.content;
        } else {
          console.log(`[getContent] Skipping older ${item.content_type} created at:`, item.created_at);
        }
      }
    }

    console.log('[getContent] Organized content types:', Object.keys(organized));
    return { content: organized };
  },

  generateQuiz: async (token: string, noteId: string, language?: string) => {
    const response = await apiRequest<{ success: boolean; data: unknown }>('/api/ai/quiz', {
      method: 'POST',
      token,
      body: { note_id: noteId, options: { language } },
    });
    return { quiz: response.data };
  },

  generateFlashcards: async (token: string, noteId: string, language?: string) => {
    const response = await apiRequest<{ success: boolean; data: unknown }>('/api/ai/flashcards', {
      method: 'POST',
      token,
      body: { note_id: noteId, options: { language } },
    });
    return { flashcards: response.data };
  },

  generatePodcast: async (token: string, noteId: string, language?: string) => {
    const response = await apiRequest<{ success: boolean; data: unknown }>('/api/ai/podcast', {
      method: 'POST',
      token,
      body: { note_id: noteId, options: { language } },
    });
    return { podcast: response.data };
  },

  generateInfographic: async (token: string, noteId: string, style?: string) => {
    const response = await apiRequest<{ success: boolean; data: unknown }>('/api/ai/infographic', {
      method: 'POST',
      token,
      body: { note_id: noteId, options: { style: style || 'modern' } },
    });
    return { infographic: response.data };
  },

  chat: async (token: string, noteId: string, message: string, history?: unknown[], language?: string) => {
    const response = await apiRequest<{ success: boolean; data: { answer?: string; response?: string } | string }>('/api/ai/chat', {
      method: 'POST',
      token,
      body: { note_id: noteId, question: message, conversation_history: history, language },
    });
    // Handle various response formats: .answer (backend), .response, or direct string
    const chatResponse = typeof response.data === 'string'
      ? response.data
      : response.data?.answer || response.data?.response || '';
    return { response: chatResponse };
  },

  getSuggestions: async (token: string, noteId: string, language?: string) => {
    const langParam = language ? `?language=${encodeURIComponent(language)}` : '';
    const response = await apiRequest<{
      success: boolean;
      data: { suggestions: string[]; note_id: string }
    }>(`/api/ai/suggestions/${noteId}${langParam}`, { token });
    return response.data?.suggestions || [];
  },
};

// Creators API
export const creatorsApi = {
  register: async (data: {
    email: string;
    name: string;
    username: string;
    socialPlatform?: string;
    socialUrl?: string;
    socialFollowers?: number;
  }) => {
    return apiRequest<{
      success: boolean;
      data: {
        creator: {
          id: string;
          email: string;
          name: string;
          username: string;
          status: string;
        };
        promoCode: string;
      };
      message: string;
    }>('/api/creators/register', {
      method: 'POST',
      body: data,
    });
  },

  login: async (token: string) => {
    return apiRequest<{
      success: boolean;
      data: { creator: unknown };
      message: string;
    }>('/api/creators/login', {
      method: 'POST',
      token,
    });
  },

  getProfile: async (token: string) => {
    return apiRequest<{
      success: boolean;
      data: unknown;
    }>('/api/creators/profile', { token });
  },

  getDashboard: async (token: string) => {
    return apiRequest<{
      success: boolean;
      data: {
        totalEarnings: number;
        pendingEarnings: number;
        thisMonthEarnings: number;
        conversions: number;
        clicks: number;
        conversionRate: number;
        promoCodes: unknown[];
      };
    }>('/api/creators/dashboard', { token });
  },

  getPromoCodes: async (token: string) => {
    return apiRequest<{
      success: boolean;
      data: unknown[];
    }>('/api/creators/promo-codes', { token });
  },

  createPromoCode: async (token: string, data: {
    discountType?: string;
    discountValue?: number;
    trialExtensionDays?: number;
    validUntil?: string;
    maxRedemptions?: number;
  }) => {
    return apiRequest<{
      success: boolean;
      data: unknown;
      message: string;
    }>('/api/creators/promo-codes', {
      method: 'POST',
      token,
      body: data,
    });
  },

  getEarnings: async (token: string, limit = 50, offset = 0) => {
    return apiRequest<{
      success: boolean;
      data: unknown[];
      pagination: { total: number; limit: number; offset: number };
    }>(`/api/creators/earnings?limit=${limit}&offset=${offset}`, { token });
  },

  getPayouts: async (token: string, limit = 50, offset = 0) => {
    return apiRequest<{
      success: boolean;
      data: unknown[];
      pagination: { total: number; limit: number; offset: number };
    }>(`/api/creators/payouts?limit=${limit}&offset=${offset}`, { token });
  },

  validatePromoCode: async (code: string, token?: string) => {
    return apiRequest<{
      success: boolean;
      data: {
        valid: boolean;
        code: string;
        trialExtensionDays: number;
        creatorName: string;
      };
    }>('/api/creators/validate-code', {
      method: 'POST',
      body: { code },
      token,
    });
  },

  applyPromoCode: async (token: string, code: string, platform = 'web') => {
    return apiRequest<{
      success: boolean;
      data: {
        code: string;
        trialExtensionDays: number;
        creatorName: string;
      };
      message: string;
    }>('/api/creators/apply-code', {
      method: 'POST',
      token,
      body: { code, platform },
    });
  },

  getCurrentCode: async (token: string) => {
    return apiRequest<{
      success: boolean;
      data: {
        code: string;
        trialExtensionDays: number;
        creatorName: string;
        status: string;
        appliedAt: string;
      } | null;
    }>('/api/creators/current-code', { token });
  },

  // Stripe Connect
  connectStripe: async (token: string) => {
    return apiRequest<{
      success: boolean;
      data: {
        onboardingUrl?: string;
        status?: string;
        message?: string;
      };
    }>('/api/creators/stripe/connect', {
      method: 'POST',
      token,
    });
  },

  getStripeStatus: async (token: string) => {
    return apiRequest<{
      success: boolean;
      data: {
        status: string;
        canReceivePayouts: boolean;
        chargesEnabled?: boolean;
        payoutsEnabled?: boolean;
        detailsSubmitted?: boolean;
      };
    }>('/api/creators/stripe/status', { token });
  },

  getStripeDashboard: async (token: string) => {
    return apiRequest<{
      success: boolean;
      data: {
        dashboardUrl: string;
      };
    }>('/api/creators/stripe/dashboard', {
      method: 'POST',
      token,
    });
  },
};

// Subscription API
export const subscriptionApi = {
  getAccess: async (token: string) => {
    return apiRequest<{
      success: boolean;
      data: {
        hasAccess: boolean;
        isSubscribed: boolean;
        isInTrial: boolean;
        reason: string;
        trialDaysRemaining: number;
        trialExpiresAt: string | null;
        trialExpired: boolean;
        productId: string | null;
        expiresAt: string | null;
        usage: {
          current: { notes: number; aiGenerations: number; podcasts: number };
          limits: { notesPerMonth: number; aiGenerationsPerMonth: number; podcastsPerMonth: number };
          remaining: { notes: number; aiGenerations: number; podcasts: number };
        };
        features: {
          canCreateNotes: boolean;
          canUseAI: boolean;
          canGeneratePodcasts: boolean;
          unlimitedAccess: boolean;
        };
      };
    }>('/api/subscriptions/access', { token });
  },

  getStatus: async (token: string) => {
    return apiRequest<{
      success: boolean;
      data: {
        isSubscribed: boolean;
        status: string;
        productId?: string;
        platform?: string;
        expiresAt?: string;
        isTrial?: boolean;
        trialEndsAt?: string;
        autoRenewEnabled?: boolean;
      };
    }>('/api/subscriptions/status', { token });
  },

  getPrices: async () => {
    return apiRequest<{
      success: boolean;
      data: Array<{
        id: string;
        name: string;
        description: string;
        amount: number;
        currency: string;
        interval: string;
        intervalCount: number;
        trialDays: number;
      }>;
    }>('/api/subscriptions/stripe/prices');
  },

  createCheckout: async (token: string, plan: 'monthly' | 'yearly', priceId?: string) => {
    return apiRequest<{
      success: boolean;
      data: {
        sessionId: string;
        url: string;
        discountApplied: boolean;
      };
    }>('/api/subscriptions/stripe/checkout', {
      method: 'POST',
      token,
      body: { plan, priceId },
    });
  },

  openPortal: async (token: string) => {
    return apiRequest<{
      success: boolean;
      data: { url: string };
    }>('/api/subscriptions/stripe/portal', {
      method: 'POST',
      token,
    });
  },
};

// Meetings API
import { Meeting, MeetingsPagination, BotRun } from '@/types';

export const meetingsApi = {
  create: async (token: string, meetingUrl: string, title?: string) => {
    return apiRequest<{
      success: boolean;
      data: {
        meeting: Meeting;
        botRun: BotRun | null;
        recallBotId: string | null;
      };
      error?: string;
    }>('/api/meetings', {
      method: 'POST',
      token,
      body: { meetingUrl, title },
    });
  },

  getAll: async (token: string, page = 1, limit = 20) => {
    return apiRequest<{
      success: boolean;
      data: Meeting[];
      pagination: MeetingsPagination;
    }>(`/api/meetings?page=${page}&limit=${limit}`, { token });
  },

  getById: async (token: string, meetingId: string) => {
    return apiRequest<{
      success: boolean;
      data: Meeting;
    }>(`/api/meetings/${meetingId}`, { token });
  },

  cancel: async (token: string, meetingId: string) => {
    return apiRequest<{
      success: boolean;
      message: string;
    }>(`/api/meetings/${meetingId}/cancel`, {
      method: 'POST',
      token,
    });
  },

  delete: async (token: string, meetingId: string) => {
    return apiRequest<{
      success: boolean;
      message: string;
    }>(`/api/meetings/${meetingId}`, {
      method: 'DELETE',
      token,
    });
  },

  validateUrl: async (token: string, meetingUrl: string) => {
    return apiRequest<{
      success: boolean;
      data: {
        valid: boolean;
        platform: string | null;
      };
    }>('/api/meetings/validate-url', {
      method: 'POST',
      token,
      body: { meetingUrl },
    });
  },
};

export default { authApi, notesApi, aiApi, creatorsApi, subscriptionApi, meetingsApi };
