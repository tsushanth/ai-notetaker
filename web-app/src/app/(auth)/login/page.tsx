'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuthStore } from '@/store/authStore';
import { authApi } from '@/lib/api';
import { Loader2 } from 'lucide-react';

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
    <div className="min-h-screen flex items-center justify-center bg-[var(--background)] px-4">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-8">
          <Link href="/" className="inline-flex items-center gap-2">
            <span className="bg-[var(--accent-purple)] px-3 py-1.5 rounded-lg text-white font-bold text-xl">
              S
            </span>
            <span className="font-bold text-2xl">Scribe AI</span>
          </Link>
          <p className="text-[var(--text-secondary)] mt-4">
            Sign in to your account
          </p>
        </div>

        {/* Login Card */}
        <div className="card">
          <div ref={googleButtonRef} className="flex justify-center" />

          {isLoading && (
            <div className="flex justify-center mt-4">
              <Loader2 className="w-5 h-5 animate-spin text-[var(--text-secondary)]" />
            </div>
          )}

          {error && (
            <p className="text-sm text-[var(--accent-red)] mt-4 text-center">{error}</p>
          )}
        </div>

        {/* Terms */}
        <p className="text-center text-xs text-[var(--text-muted)] mt-6">
          By signing in, you agree to our{' '}
          <a href="https://scribeai.online/terms.html" className="text-[var(--accent-purple-light)] hover:underline">
            Terms of Service
          </a>{' '}
          and{' '}
          <a href="https://scribeai.online/privacy.html" className="text-[var(--accent-purple-light)] hover:underline">
            Privacy Policy
          </a>
        </p>
      </div>
    </div>
  );
}
