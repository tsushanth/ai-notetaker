'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuthStore } from '@/store/authStore';
import { authApi } from '@/lib/api';
import { Loader2 } from 'lucide-react';
import { STUDY_FORMATS } from '@/lib/studyFormats';

// Google Client ID - hardcoded for reliability
const GOOGLE_CLIENT_ID = '655434901651-u6bjf9lr0no2e4ust6pok76s0aeusnv6.apps.googleusercontent.com';

export default function SignupPage() {
  const router = useRouter();
  const { login, isAuthenticated } = useAuthStore();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (isAuthenticated) {
      router.push('/notes');
    }
  }, [isAuthenticated, router]);

  const handleGoogleLogin = async () => {
    setError('');
    setIsLoading(true);

    try {
      const { google } = window as any;
      if (!google) {
        throw new Error('Google Sign-In not available. Please refresh the page.');
      }

      google.accounts.id.initialize({
        client_id: GOOGLE_CLIENT_ID,
        callback: async (response: any) => {
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

      google.accounts.id.prompt();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Google login failed');
      setIsLoading(false);
    }
  };

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
            Start studying free
          </h1>
          <p className="text-[var(--text-secondary)] text-sm mb-8">
            No card required to try it.
          </p>

          <button
            onClick={handleGoogleLogin}
            disabled={isLoading}
            className="w-full flex items-center justify-center gap-3 px-4 py-3 bg-white text-gray-800 rounded-lg font-medium hover:bg-gray-100 transition disabled:opacity-50"
          >
            {isLoading ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : (
              <>
                <svg className="w-5 h-5" viewBox="0 0 24 24">
                  <path
                    fill="currentColor"
                    d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                  />
                  <path
                    fill="#34A853"
                    d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                  />
                  <path
                    fill="#FBBC05"
                    d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                  />
                  <path
                    fill="#EA4335"
                    d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                  />
                </svg>
                Continue with Google
              </>
            )}
          </button>

          {error && (
            <p className="text-sm text-[var(--accent-red)] mt-4 text-center">{error}</p>
          )}

          <p className="text-center text-sm text-[var(--text-secondary)] mt-8">
            Already have an account?{' '}
            <Link href="/login" className="text-[var(--accent-purple-light)] hover:underline">
              Sign in
            </Link>
          </p>

          <p className="text-center text-xs text-[var(--text-muted)] mt-10">
            By signing up, you agree to our{' '}
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

      {/* Showcase — what signing up actually gets you */}
      <div className="hidden md:flex flex-col justify-center bg-[var(--card-background)] border-l border-[var(--border)] px-16">
        <p className="font-[family-name:var(--font-display)] text-2xl font-medium mb-8 max-w-xs">
          Turn your first lecture into notes in a couple of minutes.
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
