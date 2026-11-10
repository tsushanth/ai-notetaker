'use client';

import { useEffect, useState } from 'react';
import { featuresApi } from '@/lib/api';
import { ALL_FEATURES_OFF, parseFeatureFlags, type FeatureFlags } from '@/lib/features';

let cached: Promise<FeatureFlags> | null = null;

function load(): Promise<FeatureFlags> {
  if (!cached) {
    cached = featuresApi.get().then(parseFeatureFlags).catch(() => {
      cached = null; // try again on the next mount
      return { ...ALL_FEATURES_OFF };
    });
  }
  return cached;
}

/** Which optional features the server has switched on. All off until the answer arrives; `loaded` says whether it has. */
export function useFeatureFlags(): { flags: FeatureFlags; loaded: boolean } {
  const [state, setState] = useState<{ flags: FeatureFlags; loaded: boolean }>({ flags: ALL_FEATURES_OFF, loaded: false });
  useEffect(() => {
    let alive = true;
    load().then((flags) => {
      if (alive) setState({ flags, loaded: true });
    });
    return () => {
      alive = false;
    };
  }, []);
  return state;
}
