'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuthStore } from '@/store/authStore';
import { authApi } from '@/lib/api';
import { Loader2 } from 'lucide-react';
import { STUDY_FORMATS } from '@/lib/studyFormats';

const GOOGLE_CLIENT_ID =
  process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ||
  '655434901651-u6bjf9lr0no2e4ust6pok76s0aeusnv6.apps.googleusercontent.com';

export default function LoginPage() {
  const router = useRouter();
  const { login, isAuthenticated } = useAuthStore();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const googleButtonRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isAuthenticated) {
      router.push('/notes');
    }
  }, [isAuthenticated, router]);

  useEffect(() => {
    let cancelled = false;

    const initGoogle = () => {
      if (cancelled) return;
      const { google } = window as any;
      if (!google?.accounts?.id || !googleButtonRef.current) {
        setTimeout(initGoogle, 100);
        return;
      }

      google.accounts.id.initialize({
        client_id: GOOGLE_CLIENT_ID,
        ux_mode: 'popup',
        auto_select: false,
        callback: async (response: any) => {
          setError('');
          setIsLoading(true);
          try {
            const result = await authApi.loginWithGoogle(response.credential);
            login(result.user as any, result.token);
            router.push('/notes');
          } catch (err) {
            setError(err instanceof Error ? err.message : 'Google login failed');
            setIsLoading(false);
          }
        },
      });

      google.accounts.id.renderButton(googleButtonRef.current, {
        type: 'standard',
        theme: 'outline',
        size: 'large',
        text: 'continue_with',
        shape: 'rectangular',
        logo_alignment: 'left',
        width: Math.min(googleButtonRef.current.clientWidth || 360, 400),
      });
    };

    initGoogle();
    return () => {
      cancelled = true;
    };
  }, [login, router]);

  return (
    <div className="min-h-screen grid md:grid-cols-2">
      {/* Form */}
      <div className="flex items-center justify-center px-4 py-16">
        <div className="w-full max-w-sm">
          <Link href="/" className="inline-flex items-center gap-2 mb-10">
            <span className="bg-[var(--accent-purple)] px-2.5 py-1.5 rounded-lg text-[#14110a] font-bold font-[family-name:var(--font-display)]">
              S
            </span>
            <span className="font-semibold font-[family-name:var(--font-display)]">Scribe AI</span>
          </Link>

          <h1 className="font-[family-name:var(--font-display)] text-2xl font-medium mb-1.5">
            Sign in to keep studying
          </h1>
          <p className="text-[var(--text-secondary)] text-sm mb-8">
            Your notes, flashcards, and quizzes are waiting.
          </p>

          <div ref={googleButtonRef} className="flex justify-center" />

          {isLoading && (
            <div className="flex justify-center mt-4">
              <Loader2 className="w-5 h-5 animate-spin text-[var(--text-secondary)]" />
            </div>
          )}

          {error && (
            <p className="text-sm text-[var(--accent-red)] mt-4 text-center">{error}</p>
          )}

          <p className="text-center text-sm text-[var(--text-secondary)] mt-8">
            New here?{' '}
            <Link href="/signup" className="text-[var(--accent-purple-light)] hover:underline">
              Create an account
            </Link>
          </p>

          <p className="text-center text-xs text-[var(--text-muted)] mt-10">
            By signing in, you agree to our{' '}
            <Link href="/terms" className="text-[var(--accent-purple-light)] hover:underline">
              Terms of Service
            </Link>{' '}
            and{' '}
            <Link href="/privacy" className="text-[var(--accent-purple-light)] hover:underline">
              Privacy Policy
            </Link>
          </p>
        </div>
      </div>

      {/* Showcase — what signing in actually gets you */}
      <div className="hidden md:flex flex-col justify-center bg-[var(--card-background)] border-l border-[var(--border)] px-16">
        <p className="font-[family-name:var(--font-display)] text-2xl font-medium mb-8 max-w-xs">
          Everything from the app, right in your browser.
        </p>
        <div className="space-y-6 max-w-xs">
          {STUDY_FORMATS.map((f) => (
            <div key={f.name}>
              <h3 className="font-semibold text-sm">{f.name}</h3>
              <p className="text-sm text-[var(--text-secondary)] mt-0.5">{f.body}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
