import { create } from 'zustand';
import { Meeting, getMeetingStatusInfo } from '@/types';
import { meetingsApi } from '@/lib/api';

interface MeetingsState {
  meetings: Meeting[];
  isLoading: boolean;
  error: string | null;
  pollingInterval: NodeJS.Timeout | null;

  // Actions
  loadMeetings: (token: string) => Promise<void>;
  createMeeting: (token: string, meetingUrl: string, title?: string) => Promise<Meeting>;
  cancelMeeting: (token: string, meetingId: string) => Promise<void>;
  deleteMeeting: (token: string, meetingId: string) => Promise<void>;
  startPolling: (token: string) => void;
  stopPolling: () => void;
  clearError: () => void;
}

export const useMeetingsStore = create<MeetingsState>((set, get) => ({
  meetings: [],
  isLoading: false,
  error: null,
  pollingInterval: null,

  loadMeetings: async (token: string) => {
    set({ isLoading: true, error: null });
    try {
      const response = await meetingsApi.getAll(token);
      const meetings = response.data || [];
      set({ meetings, isLoading: false });

      // Check if there are active meetings
      const hasActive = meetings.some((m) => getMeetingStatusInfo(m.status).isActive);
      if (hasActive) {
        get().startPolling(token);
      } else {
        get().stopPolling();
      }
    } catch (error) {
      set({ error: (error as Error).message, isLoading: false });
    }
  },

  createMeeting: async (token: string, meetingUrl: string, title?: string) => {
    const response = await meetingsApi.create(token, meetingUrl, title);
    if (response.success && response.data) {
      const newMeeting = response.data.meeting;
      set((state) => ({ meetings: [newMeeting, ...state.meetings] }));
      get().startPolling(token);
      return newMeeting;
    }
    throw new Error(response.error || 'Failed to create meeting');
  },

  cancelMeeting: async (token: string, meetingId: string) => {
    await meetingsApi.cancel(token, meetingId);
    await get().loadMeetings(token);
  },

  deleteMeeting: async (token: string, meetingId: string) => {
    await meetingsApi.delete(token, meetingId);
    set((state) => ({
      meetings: state.meetings.filter((m) => m.id !== meetingId),
    }));
  },

  startPolling: (token: string) => {
    const { pollingInterval } = get();
    if (pollingInterval) return;

    const interval = setInterval(async () => {
      try {
        const response = await meetingsApi.getAll(token);
        const meetings = response.data || [];
        set({ meetings });

        // Stop polling if no more active meetings
        const hasActive = meetings.some((m) => getMeetingStatusInfo(m.status).isActive);
        if (!hasActive) {
          get().stopPolling();
        }
      } catch (error) {
        console.error('Polling error:', error);
      }
    }, 5000);

    set({ pollingInterval: interval });
  },

  stopPolling: () => {
    const { pollingInterval } = get();
    if (pollingInterval) {
      clearInterval(pollingInterval);
      set({ pollingInterval: null });
    }
  },

  clearError: () => {
    set({ error: null });
  },
}));
