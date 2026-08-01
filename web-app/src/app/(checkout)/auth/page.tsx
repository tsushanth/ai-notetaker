'use client';

import { useState, useEffect, useRef, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuthStore } from '@/store/authStore';
import { authApi } from '@/lib/api';

const GOOGLE_CLIENT_ID =
  process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ||
  '655434901651-u6bjf9lr0no2e4ust6pok76s0aeusnv6.apps.googleusercontent.com';

function AuthContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { login, isAuthenticated, isLoading: authLoading } = useAuthStore();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const googleButtonRef = useRef<HTMLDivElement>(null);

  const returnTo = searchParams.get('returnTo') || '/subscription';

  // If already authenticated, redirect to returnTo
  useEffect(() => {
    if (isAuthenticated && !authLoading) {
      router.push(returnTo);
    }
  }, [isAuthenticated, authLoading, router, returnTo]);

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
            router.push(returnTo);
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
  }, [login, router, returnTo]);

  if (authLoading) {
    return (
      <div className="max-w-md mx-auto px-4 py-16 text-center">
        <div className="animate-pulse">Loading...</div>
      </div>
    );
  }

  return (
    <div className="max-w-md mx-auto px-4 py-12">
      {/* Header */}
      <div className="text-center mb-8">
        <h1 className="text-2xl font-bold text-gray-900 mb-2">
          Sign in to continue
        </h1>
        <p className="text-gray-600 text-sm">
          Sign in to complete your subscription purchase
        </p>
      </div>

      {/* Sign-in Options */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <div ref={googleButtonRef} className="flex justify-center" />

        {isLoading && (
          <div className="flex justify-center mt-4">
            <svg className="animate-spin h-5 w-5 text-gray-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
          </div>
        )}

        {/* Error Message */}
        {error && (
          <p className="text-sm text-red-600 mt-4 text-center">{error}</p>
        )}
      </div>

      {/* Terms */}
      <p className="text-center text-xs text-gray-500 mt-6">
        By signing in, you agree to our{' '}
        <a href="https://scribeai.online/terms" className="text-purple-600 hover:underline">
          Terms of Service
        </a>{' '}
        and{' '}
        <a href="https://scribeai.online/privacy" className="text-purple-600 hover:underline">
          Privacy Policy
        </a>
      </p>
    </div>
  );
}

export default function AuthPage() {
  return (
    <Suspense fallback={
      <div className="max-w-md mx-auto px-4 py-16 text-center">
        <div className="animate-pulse">Loading...</div>
      </div>
    }>
      <AuthContent />
    </Suspense>
  );
}
