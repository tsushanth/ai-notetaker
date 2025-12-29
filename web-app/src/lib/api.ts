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
    const error = await response.json().catch(() => ({ message: 'Request failed' }));
    throw new Error(error.message || `API Error: ${response.status}`);
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
    const response = await apiRequest<{ success: boolean; data: unknown[] }>(`/api/ai/note/${noteId}`, { token });
    // Transform array of AI content items into organized object by content_type
    const aiContentArray = response.data || [];
    const organized: Record<string, unknown> = {};

    for (const item of aiContentArray as Array<{ content_type: string; content: unknown }>) {
      if (item.content_type && item.content) {
        organized[item.content_type] = item.content;
      }
    }

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

  chat: async (token: string, noteId: string, message: string, history?: unknown[]) => {
    const response = await apiRequest<{ success: boolean; data: { response: string } | string }>('/api/ai/chat', {
      method: 'POST',
      token,
      body: { note_id: noteId, question: message, conversation_history: history },
    });
    // Handle both nested response and direct string
    const chatResponse = typeof response.data === 'string'
      ? response.data
      : response.data?.response || '';
    return { response: chatResponse };
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

  validatePromoCode: async (code: string) => {
    return apiRequest<{
      success: boolean;
      data: {
        valid: boolean;
        code: string;
        discountType: string;
        discountValue: number;
        trialExtensionDays: number;
        creatorName: string;
      };
    }>('/api/creators/validate-code', {
      method: 'POST',
      body: { code },
    });
  },

  applyPromoCode: async (token: string, code: string, platform = 'web') => {
    return apiRequest<{
      success: boolean;
      data: unknown;
      message: string;
    }>('/api/creators/apply-code', {
      method: 'POST',
      token,
      body: { code, platform },
    });
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

export default { authApi, notesApi, aiApi, creatorsApi };
