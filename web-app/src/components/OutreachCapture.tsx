'use client';

import { useEffect } from 'react';
import { captureOutreachTouch } from '@/lib/outreachUtm';

/** Mounted once in the root layout. Renders nothing. Keeps the outreach campaign params from the landing URL (first touch only). */
export default function OutreachCapture() {
  useEffect(() => {
    captureOutreachTouch(window.location.search);
  }, []);
  return null;
}
