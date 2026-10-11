// When the API says the session has expired (401 on a request that carried a token), stop showing a dead-end error: clear the
// stored session and send the user to the login page, which brings them back to the page they were on afterwards.
import { useAuthStore } from '@/store/authStore';
import { hasBearer, isExpiredSession, loginUrl } from './session';

const API_BASE = 'https://ai-notetaker-backend.fly.dev';
let redirecting = false;

/** Clears the session and goes to login. Safe to call many times (several requests can fail at once). */
export function handleSessionExpired() {
  if (redirecting || typeof window === 'undefined') return;
  redirecting = true;
  useAuthStore.getState().logout();
  const here = `${window.location.pathname}${window.location.search}`;
  window.location.assign(loginUrl(here, true));
}

let installed = false;

/** Wraps window.fetch once so every authenticated call to the API gets the same treatment. */
export function installSessionExpiryWatcher() {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  const original = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const res = await original(input, init);
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (isExpiredSession({ url, apiBase: API_BASE, hadBearer: hasBearer(init, input), status: res.status })) handleSessionExpired();
    return res;
  };
}
