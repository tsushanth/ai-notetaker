'use client';

import { useEffect, useRef } from 'react';

const GOOGLE_CLIENT_ID =
  process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ||
  '655434901651-u6bjf9lr0no2e4ust6pok76s0aeusnv6.apps.googleusercontent.com';

/** Shown when Google's sign-in script never loads (usually an ad or tracking blocker, or no connection). */
export const GOOGLE_UNAVAILABLE_MESSAGE =
  'Google sign-in did not load. Turn off any ad or tracking blocker for this site, then refresh the page.';

interface GoogleIdentity {
  accounts?: { id?: { initialize: (config: object) => void; renderButton: (el: HTMLElement, options: object) => void } };
}

const POLL_MS = 100;
const GIVE_UP_AFTER_MS = 10_000;

/**
 * The official "Continue with Google" button. Unlike google.accounts.id.prompt() (One Tap), the rendered button always
 * opens the account chooser when clicked: One Tap is silently skipped after the user has dismissed it once, which left
 * the old sign-up button spinning with nothing happening.
 */
export default function GoogleSignInButton({
  onCredential,
  onUnavailable,
}: {
  onCredential: (idToken: string) => void;
  onUnavailable?: () => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const credentialRef = useRef(onCredential);
  const unavailableRef = useRef(onUnavailable);
  useEffect(() => {
    credentialRef.current = onCredential;
    unavailableRef.current = onUnavailable;
  });

  useEffect(() => {
    let cancelled = false;
    let waited = 0;

    const init = () => {
      if (cancelled) return;
      const { google } = window as unknown as { google?: GoogleIdentity };
      const host = hostRef.current;
      if (!google?.accounts?.id || !host) {
        waited += POLL_MS;
        if (waited >= GIVE_UP_AFTER_MS) {
          unavailableRef.current?.();
          return;
        }
        setTimeout(init, POLL_MS);
        return;
      }
      google.accounts.id.initialize({
        client_id: GOOGLE_CLIENT_ID,
        ux_mode: 'popup',
        auto_select: false,
        callback: (response: { credential: string }) => credentialRef.current(response.credential),
      });
      google.accounts.id.renderButton(host, {
        type: 'standard',
        theme: 'outline',
        size: 'large',
        text: 'continue_with',
        shape: 'rectangular',
        logo_alignment: 'left',
        width: Math.min(host.clientWidth || 360, 400),
      });
    };

    init();
    return () => {
      cancelled = true;
    };
  }, []);

  return <div ref={hostRef} className="flex justify-center min-h-[44px]" />;
}
