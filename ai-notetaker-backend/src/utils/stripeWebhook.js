/**
 * Stripe webhook signature check that FAILS CLOSED.
 *
 * Before 2026-11-01 the route accepted any request when the Stripe-Signature header was absent
 * (`if (webhookSecret && sig) verify else parse the body as trusted`), so anyone could POST a forged
 * subscription event and grant themselves a plan. Stripe always sends the header, so refusing a request
 * without it can never reject a genuine event.
 *
 * Returns { ok: true, event } or { ok: false, status, code, message }.
 */
function verifyStripeWebhook({ stripe, rawBody, signature, secret }) {
  if (!secret) {
    return { ok: false, status: 503, code: 'NO_WEBHOOK_SECRET', message: 'Stripe webhook secret is not configured' };
  }
  if (!signature) {
    return { ok: false, status: 400, code: 'MISSING_SIGNATURE', message: 'Missing Stripe-Signature header' };
  }
  try {
    return { ok: true, event: stripe.webhooks.constructEvent(rawBody, signature, secret) };
  } catch (err) {
    return { ok: false, status: 400, code: 'BAD_SIGNATURE', message: err.message };
  }
}

module.exports = { verifyStripeWebhook };
