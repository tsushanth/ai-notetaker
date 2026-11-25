// Which handled errors are worth telling the owner about. A wrong password or a daily limit is the product working.
const statusOf = (err: unknown): number | null => {
  const s = (err as { status?: unknown } | null)?.status;
  return typeof s === 'number' ? s : null;
};

export function isUnexpectedSignInFailure(err: unknown): boolean {
  const s = statusOf(err);
  return s !== 400 && s !== 401 && s !== 409 && s !== 429;
}

/** AI, audio, chat and checkout failures: everything except limits, paywalls and an expired session. */
export function isUnexpectedFeatureFailure(err: unknown): boolean {
  const s = statusOf(err);
  return s !== 401 && s !== 402 && s !== 403 && s !== 429;
}
