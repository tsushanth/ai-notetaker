'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/store/authStore';
import { useMeetingsStore } from '@/store/meetingsStore';
import {
  Meeting,
  MeetingStatus,
  MeetingPlatform,
  getMeetingStatusInfo,
  getPlatformInfo,
  validateMeetingUrl,
} from '@/types';

export default function MeetingsPage() {
  const router = useRouter();
  const { token, isAuthenticated } = useAuthStore();
  const {
    meetings,
    isLoading,
    error,
    loadMeetings,
    createMeeting,
    cancelMeeting,
    deleteMeeting,
    stopPolling,
    clearError,
  } = useMeetingsStore();

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [meetingUrl, setMeetingUrl] = useState('');
  const [title, setTitle] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  useEffect(() => {
    if (!isAuthenticated || !token) {
      router.push('/login');
      return;
    }
    loadMeetings(token);

    return () => {
      stopPolling();
    };
  }, [isAuthenticated, token, router, loadMeetings, stopPolling]);

  const handleCreate = useCallback(async () => {
    if (!token || !meetingUrl) return;

    setIsCreating(true);
    setCreateError(null);

    try {
      await createMeeting(token, meetingUrl, title || undefined);
      setShowCreateModal(false);
      setMeetingUrl('');
      setTitle('');
    } catch (err) {
      setCreateError((err as Error).message);
    } finally {
      setIsCreating(false);
    }
  }, [token, meetingUrl, title, createMeeting]);

  const handleCancel = useCallback(
    async (meetingId: string) => {
      if (!token) return;
      try {
        await cancelMeeting(token, meetingId);
      } catch (err) {
        console.error('Failed to cancel meeting:', err);
      }
    },
    [token, cancelMeeting]
  );

  const handleDelete = useCallback(
    async (meetingId: string) => {
      if (!token) return;
      if (!confirm('Are you sure you want to delete this meeting?')) return;
      try {
        await deleteMeeting(token, meetingId);
      } catch (err) {
        console.error('Failed to delete meeting:', err);
      }
    },
    [token, deleteMeeting]
  );

  const urlValidation = validateMeetingUrl(meetingUrl);

  const formatDuration = (seconds: number): string => {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    if (minutes > 60) {
      const hours = Math.floor(minutes / 60);
      const remainingMinutes = minutes % 60;
      return `${hours}:${String(remainingMinutes).padStart(2, '0')}:${String(remainingSeconds).padStart(2, '0')}`;
    }
    return `${minutes}:${String(remainingSeconds).padStart(2, '0')}`;
  };

  const getStatusColor = (status: MeetingStatus): string => {
    const info = getMeetingStatusInfo(status);
    if (status === 'completed') return 'text-green-500';
    if (status === 'failed' || status === 'cancelled') return 'text-red-500';
    if (status === 'recording') return 'text-red-500 animate-pulse';
    return 'text-yellow-500';
  };

  const getPlatformEmoji = (platform: MeetingPlatform): string => {
    switch (platform) {
      case 'zoom':
        return '🔵';
      case 'google_meet':
        return '🟢';
      case 'teams':
        return '🟣';
      case 'webex':
        return '🟡';
      default:
        return '⚪';
    }
  };

  return (
    <div className="container mx-auto px-4 py-8 max-w-4xl">
      {/* Header */}
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-2xl font-bold">Meeting Bot</h1>
          <p className="text-gray-500 dark:text-gray-400 mt-1">
            Record and transcribe your meetings automatically
          </p>
        </div>
        <button
          onClick={() => setShowCreateModal(true)}
          className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Join Meeting
        </button>
      </div>

      {/* Error display */}
      {error && (
        <div className="mb-6 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
          <div className="flex justify-between items-center">
            <p className="text-red-600 dark:text-red-400">{error}</p>
            <button onClick={clearError} className="text-red-500 hover:text-red-700">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
      )}

      {/* Content */}
      {isLoading && meetings.length === 0 ? (
        <div className="flex justify-center py-16">
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600" />
        </div>
      ) : meetings.length === 0 ? (
        <EmptyState onCreateMeeting={() => setShowCreateModal(true)} />
      ) : (
        <div className="space-y-4">
          {meetings.map((meeting) => (
            <MeetingCard
              key={meeting.id}
              meeting={meeting}
              onCancel={() => handleCancel(meeting.id)}
              onDelete={() => handleDelete(meeting.id)}
              onViewNote={() => meeting.note_id && router.push(`/notes/${meeting.note_id}`)}
              formatDuration={formatDuration}
              getStatusColor={getStatusColor}
              getPlatformEmoji={getPlatformEmoji}
            />
          ))}
        </div>
      )}

      {/* Create Modal */}
      {showCreateModal && (
        <CreateMeetingModal
          meetingUrl={meetingUrl}
          setMeetingUrl={setMeetingUrl}
          title={title}
          setTitle={setTitle}
          urlValidation={urlValidation}
          isCreating={isCreating}
          createError={createError}
          onClose={() => {
            setShowCreateModal(false);
            setMeetingUrl('');
            setTitle('');
            setCreateError(null);
          }}
          onCreate={handleCreate}
        />
      )}
    </div>
  );
}

// Empty State Component
function EmptyState({ onCreateMeeting }: { onCreateMeeting: () => void }) {
  return (
    <div className="text-center py-16">
      <div className="text-6xl mb-4">📹</div>
      <h2 className="text-xl font-semibold mb-2">No Meetings Yet</h2>
      <p className="text-gray-500 dark:text-gray-400 mb-6 max-w-md mx-auto">
        Enter a meeting link to have our bot join, record, and transcribe automatically.
      </p>
      <button
        onClick={onCreateMeeting}
        className="flex items-center gap-2 mx-auto bg-blue-600 text-white px-6 py-2 rounded-lg hover:bg-blue-700 transition-colors"
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"
          />
        </svg>
        Join a Meeting
      </button>
    </div>
  );
}

// Meeting Card Component
function MeetingCard({
  meeting,
  onCancel,
  onDelete,
  onViewNote,
  formatDuration,
  getStatusColor,
  getPlatformEmoji,
}: {
  meeting: Meeting;
  onCancel: () => void;
  onDelete: () => void;
  onViewNote: () => void;
  formatDuration: (seconds: number) => string;
  getStatusColor: (status: MeetingStatus) => string;
  getPlatformEmoji: (platform: MeetingPlatform) => string;
}) {
  const statusInfo = getMeetingStatusInfo(meeting.status);
  const platformInfo = getPlatformInfo(meeting.platform);

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg p-4 shadow-sm border border-gray-200 dark:border-gray-700">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          {/* Platform icon */}
          <div
            className="text-2xl w-12 h-12 flex items-center justify-center rounded-lg"
            style={{ backgroundColor: `${platformInfo.color}20` }}
          >
            {getPlatformEmoji(meeting.platform)}
          </div>

          {/* Content */}
          <div>
            <h3 className="font-medium text-gray-900 dark:text-white">
              {meeting.title || 'Untitled Meeting'}
            </h3>
            <div className="flex items-center gap-2 mt-1">
              {/* Status indicator */}
              {meeting.status === 'recording' && (
                <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
              )}
              {statusInfo.isActive && meeting.status !== 'recording' && (
                <div className="w-3 h-3 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
              )}
              <span className={`text-sm ${getStatusColor(meeting.status)}`}>
                {statusInfo.displayText}
              </span>
            </div>
            {meeting.duration_seconds && (
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                Duration: {formatDuration(meeting.duration_seconds)}
              </p>
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-2">
          {statusInfo.isCancellable && (
            <button
              onClick={onCancel}
              className="text-red-500 hover:text-red-700 text-sm font-medium"
            >
              Cancel
            </button>
          )}
          {meeting.status === 'completed' && meeting.note_id && (
            <button
              onClick={onViewNote}
              className="text-blue-600 hover:text-blue-800 text-sm font-medium"
            >
              View Note
            </button>
          )}
          {(meeting.status === 'failed' || meeting.status === 'cancelled') && (
            <button
              onClick={onDelete}
              className="text-red-500 hover:text-red-700 text-sm font-medium"
            >
              Delete
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// Create Meeting Modal Component
function CreateMeetingModal({
  meetingUrl,
  setMeetingUrl,
  title,
  setTitle,
  urlValidation,
  isCreating,
  createError,
  onClose,
  onCreate,
}: {
  meetingUrl: string;
  setMeetingUrl: (url: string) => void;
  title: string;
  setTitle: (title: string) => void;
  urlValidation: { valid: boolean; platform: string | null };
  isCreating: boolean;
  createError: string | null;
  onClose: () => void;
  onCreate: () => void;
}) {
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
      <div className="bg-white dark:bg-gray-800 rounded-lg p-6 max-w-md w-full shadow-xl">
        {/* Header */}
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-bold text-gray-900 dark:text-white">Join a Meeting</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-700 dark:hover:text-gray-300">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <p className="text-gray-500 dark:text-gray-400 mb-6">
          Paste your meeting link and our bot will join to record and transcribe.
        </p>

        <div className="space-y-4">
          {/* Meeting URL input */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Meeting Link
            </label>
            <input
              type="url"
              value={meetingUrl}
              onChange={(e) => setMeetingUrl(e.target.value)}
              placeholder="https://zoom.us/j/..."
              className="w-full p-3 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
            {meetingUrl && (
              <p className={`text-sm mt-1 ${urlValidation.valid ? 'text-green-500' : 'text-red-500'}`}>
                {urlValidation.valid
                  ? `${getPlatformInfo(urlValidation.platform as MeetingPlatform).displayName} detected`
                  : 'Invalid meeting URL'}
              </p>
            )}
          </div>

          {/* Title input */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Title (optional)
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g., Team Standup"
              className="w-full p-3 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>

          {/* Supported platforms */}
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Supported: Zoom, Google Meet, Microsoft Teams, Webex
          </p>

          {/* Error message */}
          {createError && <p className="text-red-500 text-sm">{createError}</p>}
        </div>

        {/* Actions */}
        <div className="flex gap-3 mt-6">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
            disabled={isCreating}
          >
            Cancel
          </button>
          <button
            onClick={onCreate}
            disabled={!urlValidation.valid || isCreating}
            className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
          >
            {isCreating ? (
              <>
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                Sending Bot...
              </>
            ) : (
              <>
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"
                  />
                </svg>
                Send Bot
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
