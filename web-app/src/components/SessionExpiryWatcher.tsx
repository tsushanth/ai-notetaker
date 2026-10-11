'use client';

import { useEffect } from 'react';
import { installSessionExpiryWatcher } from '@/lib/sessionExpiry';

/** Mounted once in the root layout. Renders nothing. */
export default function SessionExpiryWatcher() {
  useEffect(() => { installSessionExpiryWatcher(); }, []);
  return null;
}
