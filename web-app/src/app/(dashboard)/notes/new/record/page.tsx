'use client';

import { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuthStore } from '@/store/authStore';
import { notesApi, limitAwareMessage } from '@/lib/api';
import ProcessingSteps from '@/components/ProcessingSteps';
import {
  ArrowLeft,
  Mic,
  Square,
  Pause,
  Play,
  Upload,
  Loader2,
  AlertCircle
} from 'lucide-react';

type RecordingState = 'idle' | 'recording' | 'paused' | 'stopped';

// The backend accepts webm, mp4/m4a and ogg audio (50 MB max). Safari cannot record webm, so pick what the browser supports.
const MIME_CANDIDATES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

function pickMimeType(): string | undefined {
  if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') return undefined;
  return MIME_CANDIDATES.find((m) => MediaRecorder.isTypeSupported(m));
}

function extensionFor(mime: string): string {
  if (mime.includes('mp4')) return 'm4a';
  if (mime.includes('ogg')) return 'ogg';
  return 'webm';
}

export default function RecordAudioPage() {
  const router = useRouter();
  const { token } = useAuthStore();
  const [recordingState, setRecordingState] = useState<RecordingState>('idle');
  const [duration, setDuration] = useState(0);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [stage, setStage] = useState<'uploading' | 'transcribing'>('uploading');
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState('');

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
      }
      if (audioUrl) {
        URL.revokeObjectURL(audioUrl);
      }
    };
  }, [audioUrl]);

  // A recording that has not been uploaded exists only in this tab: warn before the tab is closed or reloaded.
  const hasUnsentRecording = recordingState !== 'idle' && !isUploading;
  useEffect(() => {
    if (!hasUnsentRecording) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [hasUnsentRecording]);

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const startRecording = async () => {
    try {
      setError(null);
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const mimeType = pickMimeType();
      const mediaRecorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      chunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = () => {
        const type = (mediaRecorder.mimeType || 'audio/webm').split(';')[0];
        const blob = new Blob(chunksRef.current, { type });
        setAudioBlob(blob);
        setAudioUrl(URL.createObjectURL(blob));
      };

      mediaRecorder.start(1000);
      setRecordingState('recording');
      setDuration(0);

      timerRef.current = setInterval(() => {
        setDuration(prev => prev + 1);
      }, 1000);
    } catch (err) {
      setError('Could not access microphone. Please check permissions.');
      console.error('Error accessing microphone:', err);
    }
  };

  const pauseRecording = () => {
    if (mediaRecorderRef.current && recordingState === 'recording') {
      mediaRecorderRef.current.pause();
      setRecordingState('paused');
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    }
  };

  const resumeRecording = () => {
    if (mediaRecorderRef.current && recordingState === 'paused') {
      mediaRecorderRef.current.resume();
      setRecordingState('recording');
      timerRef.current = setInterval(() => {
        setDuration(prev => prev + 1);
      }, 1000);
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current) {
      mediaRecorderRef.current.stop();
      setRecordingState('stopped');
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
      }
    }
  };

  const handleUpload = async () => {
    if (!audioBlob || !token) return;

    if (audioBlob.size > MAX_UPLOAD_BYTES) {
      setError('This recording is larger than the 50 MB upload limit. Please record a shorter note.');
      return;
    }

    setIsUploading(true);
    setStage('uploading');
    setError(null);

    try {
      const type = audioBlob.type || 'audio/webm';
      const { noteId } = await notesApi.uploadAudio(token, audioBlob, {
        title: title.trim() || undefined,
        filename: `recording-${Date.now()}.${extensionFor(type)}`,
        onStage: setStage,
      });
      router.push(`/notes/${noteId}`);
    } catch (err) {
      setError(limitAwareMessage(err, 'Failed to upload recording'));
    } finally {
      setIsUploading(false);
    }
  };

  const resetRecording = () => {
    setRecordingState('idle');
    setDuration(0);
    setAudioBlob(null);
    if (audioUrl) {
      URL.revokeObjectURL(audioUrl);
      setAudioUrl(null);
    }
    setTitle('');
    setError(null);
  };

  return (
    <div className="max-w-2xl mx-auto px-6 py-8">
      {/* Header */}
      <div className="flex items-center gap-4 mb-8">
        <Link
          href="/notes"
          className="p-2 hover:bg-[var(--surface-variant)] rounded-lg transition"
        >
          <ArrowLeft size={24} />
        </Link>
        <div>
          <h1 className="text-2xl font-bold">Record Audio</h1>
          <p className="text-[var(--text-secondary)]">
            Record and transcribe voice notes
          </p>
        </div>
      </div>

      {/* Error Message */}
      {error && (
        <div className="flex items-center gap-3 p-4 mb-6 bg-[var(--accent-red)]/10 border border-[var(--accent-red)]/20 rounded-lg">
          <AlertCircle className="w-5 h-5 text-[var(--accent-red)]" />
          <p className="text-[var(--accent-red)]">{error}</p>
        </div>
      )}

      {/* Recording Interface */}
      <div className="card text-center">
        {/* Visualization Circle */}
        <div className="relative w-48 h-48 mx-auto mb-8">
          <div
            className={`absolute inset-0 rounded-full border-4 transition-all ${
              recordingState === 'recording'
                ? 'border-[var(--accent-red)] animate-pulse'
                : recordingState === 'paused'
                ? 'border-[var(--accent-purple)]'
                : recordingState === 'stopped'
                ? 'border-[var(--accent-green)]'
                : 'border-[var(--border)]'
            }`}
          />
          <div className="absolute inset-0 flex items-center justify-center">
            {recordingState === 'idle' ? (
              <Mic className="w-16 h-16 text-[var(--text-muted)]" />
            ) : (
              <span className="text-4xl font-mono font-bold">
                {formatTime(duration)}
              </span>
            )}
          </div>
        </div>

        {/* Status Text */}
        <p className="text-lg mb-8">
          {recordingState === 'idle' && 'Tap to start recording'}
          {recordingState === 'recording' && 'Recording...'}
          {recordingState === 'paused' && 'Paused'}
          {recordingState === 'stopped' && 'Recording complete'}
        </p>

        {/* Controls */}
        <div className="flex items-center justify-center gap-4">
          {recordingState === 'idle' && (
            <button
              onClick={startRecording}
              className="w-20 h-20 rounded-full bg-[var(--accent-red)] hover:bg-[var(--accent-red)]/80 flex items-center justify-center transition"
            >
              <Mic size={32} className="text-white" />
            </button>
          )}

          {recordingState === 'recording' && (
            <>
              <button
                onClick={pauseRecording}
                className="w-16 h-16 rounded-full bg-[var(--surface-variant)] hover:bg-[var(--border)] flex items-center justify-center transition"
              >
                <Pause size={24} />
              </button>
              <button
                onClick={stopRecording}
                className="w-20 h-20 rounded-full bg-[var(--accent-red)] hover:bg-[var(--accent-red)]/80 flex items-center justify-center transition"
              >
                <Square size={32} className="text-white" />
              </button>
            </>
          )}

          {recordingState === 'paused' && (
            <>
              <button
                onClick={resumeRecording}
                className="w-16 h-16 rounded-full bg-[var(--accent-purple)] hover:bg-[var(--accent-purple-hover)] flex items-center justify-center transition"
              >
                <Play size={24} className="text-white" />
              </button>
              <button
                onClick={stopRecording}
                className="w-20 h-20 rounded-full bg-[var(--accent-red)] hover:bg-[var(--accent-red)]/80 flex items-center justify-center transition"
              >
                <Square size={32} className="text-white" />
              </button>
            </>
          )}

          {recordingState === 'stopped' && (
            <>
              <button
                onClick={resetRecording}
                className="btn-secondary"
              >
                Record Again
              </button>
            </>
          )}
        </div>

        {/* Audio Preview & Upload */}
        {recordingState === 'stopped' && audioUrl && (
          <div className="mt-8 pt-8 border-t border-[var(--border)]">
            {/* Audio Player */}
            <audio
              src={audioUrl}
              controls
              className="w-full mb-6"
            />

            {/* Title Input */}
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Note title (optional)"
              className="input mb-6"
            />

            {/* Upload Button */}
            <button
              onClick={handleUpload}
              disabled={isUploading}
              className="btn-primary w-full flex items-center justify-center gap-2"
            >
              {isUploading ? (
                <>
                  <Loader2 size={20} className="animate-spin" />
                  {stage === 'uploading' ? 'Uploading...' : 'Transcribing...'}
                </>
              ) : (
                <>
                  <Upload size={20} />
                  Transcribe & Save
                </>
              )}
            </button>

            {isUploading && (
              <ProcessingSteps
                steps={['Uploading your recording', 'Transcribing the audio']}
                current={stage === 'uploading' ? 0 : 1}
                hint="Transcription can take a minute or two for longer recordings. Please keep this tab open."
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}
