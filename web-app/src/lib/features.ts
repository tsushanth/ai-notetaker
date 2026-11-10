// Server-driven feature flags. The backend (GET /api/config/features) says which optional features are switched on;
// every flag is off until it says so, and also while the request is loading or has failed. Pure, no React.
export interface FeatureFlags {
  phone_calls: boolean;
  learn: boolean;
  create: boolean;
  compete: boolean;
}

export const ALL_FEATURES_OFF: FeatureFlags = Object.freeze({
  phone_calls: false,
  learn: false,
  create: false,
  compete: false,
});

/** Only a literal `true` switches a flag on; anything else (missing, "true", 1, a broken response) leaves it off. */
export function parseFeatureFlags(payload: unknown): FeatureFlags {
  const data = (payload as { data?: Record<string, unknown> } | null | undefined)?.data;
  if (!data || typeof data !== 'object') return { ...ALL_FEATURES_OFF };
  return {
    phone_calls: data.phone_calls === true,
    learn: data.learn === true,
    create: data.create === true,
    compete: data.compete === true,
  };
}
