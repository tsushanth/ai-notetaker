// Display plans for the /subscription checkout page. Pure data and helpers so the copy can be tested.
// The amount actually charged is the Stripe price the backend picks (STRIPE_PRICE_MONTHLY / STRIPE_PRICE_YEARLY);
// these strings are display text only, and `appStorePrice` is the comparison price shown struck through.

export interface CheckoutPlan {
  id: string;
  name: string;
  price: string;
  appStorePrice: string;
  period?: string;
  perWeek?: string;
  perMonth?: string | null;
  badge?: string | null;
  trial?: string | null;
}

export const CHECKOUT_PLANS: CheckoutPlan[] = [
  {
    id: 'yearly',
    name: 'Annual',
    price: '$48.99',
    period: '/year',
    perWeek: '$0.94/week',
    perMonth: '$4.08/month',
    appStorePrice: '$69.99',
    badge: 'Best Value',
    trial: '7-day free trial',
  },
  {
    id: 'monthly',
    name: 'Monthly',
    price: '$6.99',
    period: '/month',
    perWeek: '$1.75/week',
    perMonth: null,
    appStorePrice: '$9.99',
    badge: null,
    trial: null,
  },
];

function dollars(text: string): number | null {
  const n = Number.parseFloat(text.replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Whole-percent saving of `price` against `appStorePrice`, or null when either is not a price. */
export function savingsPercent(price: string, appStorePrice: string): number | null {
  const p = dollars(price);
  const a = dollars(appStorePrice);
  if (p === null || a === null) return null;
  return Math.round((1 - p / a) * 100);
}

/** "Save N% compared to App Store prices" using the smallest saving across the plans, or null if there is none. */
export function savingsHeadline(plans: Array<Pick<CheckoutPlan, 'price' | 'appStorePrice'>>): string | null {
  const all = plans.map((p) => savingsPercent(p.price, p.appStorePrice));
  if (all.some((v) => v === null)) return null;
  const min = Math.min(...(all as number[]));
  return min > 0 ? `Save ${min}% compared to App Store prices` : null;
}
