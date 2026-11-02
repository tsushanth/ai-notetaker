// Pure helpers for the Settings "Your data" section (data export and account deletion).

export const DELETE_CONFIRM_WORD = 'DELETE';

/** Same keys as the Android `DeletionReason` enum, so reasons line up across clients. */
export const DELETE_REASONS = [
  { id: 'NOT_USEFUL', label: "App isn't useful for me" },
  { id: 'TOO_EXPENSIVE', label: 'Too expensive' },
  { id: 'FOUND_ALTERNATIVE', label: 'Found a better alternative' },
  { id: 'PRIVACY_CONCERNS', label: 'Privacy concerns' },
  { id: 'TOO_COMPLICATED', label: 'Too complicated to use' },
  { id: 'BUGS_ISSUES', label: 'Too many bugs or issues' },
  { id: 'OTHER', label: 'Other reason' },
] as const;

export type DeleteReasonId = (typeof DELETE_REASONS)[number]['id'];

/** The user must type DELETE (case and surrounding spaces ignored) before the button enables. */
export function isDeleteConfirmed(typed: string): boolean {
  return typed.trim().toUpperCase() === DELETE_CONFIRM_WORD;
}

/**
 * Deleting the account removes our data but does NOT cancel a subscription billed elsewhere. A web (Stripe)
 * subscription must be cancelled first, so it blocks; store subscriptions are managed in the store, so they only warn.
 */
export function deletionBlocker(access: { isSubscribed: boolean; platform?: string } | null | undefined): { blocking: boolean; message: string } | null {
  if (!access || !access.isSubscribed) return null;
  if (access.platform === 'ios') {
    return { blocking: false, message: 'Deleting your account does not cancel your subscription. Cancel it in the App Store first, or you may keep being billed.' };
  }
  if (access.platform === 'android') {
    return { blocking: false, message: 'Deleting your account does not cancel your subscription. Cancel it in the Play Store first, or you may keep being billed.' };
  }
  return {
    blocking: true,
    message: 'Please cancel your subscription first (use Manage Subscription above). Deleting your account does not cancel billing.',
  };
}

export function exportFilename(date: Date = new Date()): string {
  return `scribeai-data-${date.toISOString().slice(0, 10)}.json`;
}

export function serializeExport(data: unknown): string {
  return JSON.stringify(data, null, 2);
}
