'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuthStore } from '@/store/authStore';
import { authApi } from '@/lib/api';
import { Loader2 } from 'lucide-react';
import { STUDY_FORMATS } from '@/lib/studyFormats';
import GoogleSignInButton, { GOOGLE_UNAVAILABLE_MESSAGE } from '@/components/GoogleSignInButton';


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

  const handleCredential = async (idToken: string) => {
    setError('');
    setIsLoading(true);
    try {
      const result = await authApi.loginWithGoogle(idToken);
      login(result.user as any, result.token);
      router.push('/notes');
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

          <GoogleSignInButton onCredential={handleCredential} onUnavailable={() => setError(GOOGLE_UNAVAILABLE_MESSAGE)} />

          {isLoading && (
            <div className="flex justify-center mt-4">
              <Loader2 className="w-5 h-5 animate-spin text-[var(--text-secondary)]" />
            </div>
          )}

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
