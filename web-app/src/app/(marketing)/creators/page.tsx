import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Creator Program - Scribe AI',
  description: 'Join the Scribe AI Creator Program. Earn 25% revenue sharing by promoting Scribe AI to your audience.',
};

export default function CreatorsPage() {
  return (
    <>
      {/* Hero */}
      <section className="text-center py-20">
        <div className="max-w-[900px] mx-auto px-6">
          <h1 className="text-3xl md:text-4xl font-bold mb-4">Partner With Scribe AI</h1>
          <p className="text-lg text-[var(--text-muted)] max-w-[500px] mx-auto">
            Earn 25% of every subscription you refer while helping your audience learn smarter.
          </p>
        </div>
      </section>

      {/* Benefits */}
      <section className="py-16 border-t border-[var(--border)]">
        <div className="max-w-[900px] mx-auto px-6">
          <h2 className="text-2xl font-bold text-center mb-10">Why Join?</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
            <div className="bg-[var(--card-background)] border border-[var(--border)] rounded-xl p-6 text-center">
              <div className="text-4xl mb-3">💰</div>
              <h3 className="font-semibold mb-2">25% Revenue Share</h3>
              <p className="text-sm text-[var(--text-muted)]">
                Earn 25% of every subscription you refer, paid monthly.
              </p>
            </div>
            <div className="bg-[var(--card-background)] border border-[var(--border)] rounded-xl p-6 text-center">
              <div className="text-4xl mb-3">🔗</div>
              <h3 className="font-semibold mb-2">Custom Promo Code</h3>
              <p className="text-sm text-[var(--text-muted)]">
                Get your personalized SCRIBEAI-XXX code with tracking.
              </p>
            </div>
            <div className="bg-[var(--card-background)] border border-[var(--border)] rounded-xl p-6 text-center">
              <div className="text-4xl mb-3">🎁</div>
              <h3 className="font-semibold mb-2">Free Premium</h3>
              <p className="text-sm text-[var(--text-muted)]">
                Complimentary premium access while you&apos;re an active creator.
              </p>
            </div>
            <div className="bg-[var(--card-background)] border border-[var(--border)] rounded-xl p-6 text-center">
              <div className="text-4xl mb-3">🤝</div>
              <h3 className="font-semibold mb-2">Monthly Payouts</h3>
              <p className="text-sm text-[var(--text-muted)]">
                Automatic payments via Stripe on the 1st of each month.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section className="py-16 border-t border-[var(--border)]">
        <div className="max-w-[900px] mx-auto px-6">
          <h2 className="text-2xl font-bold text-center mb-10">How It Works</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="text-center">
              <div className="w-12 h-12 rounded-full bg-[var(--accent-purple)] text-white flex items-center justify-center text-xl font-bold mx-auto mb-4">1</div>
              <h3 className="font-semibold mb-2">Register</h3>
              <p className="text-sm text-[var(--text-muted)]">
                Sign up instantly and get your personalized promo code. No approval wait time.
              </p>
            </div>
            <div className="text-center">
              <div className="w-12 h-12 rounded-full bg-[var(--accent-purple)] text-white flex items-center justify-center text-xl font-bold mx-auto mb-4">2</div>
              <h3 className="font-semibold mb-2">Share</h3>
              <p className="text-sm text-[var(--text-muted)]">
                Promote Scribe AI to your audience. When they subscribe using your code, you earn.
              </p>
            </div>
            <div className="text-center">
              <div className="w-12 h-12 rounded-full bg-[var(--accent-purple)] text-white flex items-center justify-center text-xl font-bold mx-auto mb-4">3</div>
              <h3 className="font-semibold mb-2">Earn</h3>
              <p className="text-sm text-[var(--text-muted)]">
                Receive 25% of net revenue monthly via Stripe once you reach $50 in earnings.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Program Details */}
      <section className="py-16 border-t border-[var(--border)]">
        <div className="max-w-[900px] mx-auto px-6">
          <h2 className="text-2xl font-bold text-center mb-10">Program Details</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="bg-[var(--card-background)] border border-[var(--border)] rounded-xl p-6">
              <h3 className="font-semibold mb-4">Earnings</h3>
              <ul className="space-y-3 text-sm text-[var(--text-muted)]">
                <li className="flex items-start gap-2">
                  <span className="text-green-500 mt-0.5">✓</span>
                  <span>25% of net revenue (after app store fees)</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-green-500 mt-0.5">✓</span>
                  <span>$50 minimum payout threshold</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-green-500 mt-0.5">✓</span>
                  <span>Monthly payouts on the 1st via Stripe</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-green-500 mt-0.5">✓</span>
                  <span>45-day holding period for quality assurance</span>
                </li>
              </ul>
            </div>
            <div className="bg-[var(--card-background)] border border-[var(--border)] rounded-xl p-6">
              <h3 className="font-semibold mb-4">Requirements</h3>
              <ul className="space-y-3 text-sm text-[var(--text-muted)]">
                <li className="flex items-start gap-2">
                  <span className="text-green-500 mt-0.5">✓</span>
                  <span>Stay active with referrals or content creation</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-green-500 mt-0.5">✓</span>
                  <span>Complete Stripe onboarding to receive payouts</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-green-500 mt-0.5">✓</span>
                  <span>Authentic promotion only (no self-referrals)</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-green-500 mt-0.5">✓</span>
                  <span>Comply with our Creator Program Terms</span>
                </li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* Who We're Looking For */}
      <section className="py-16 border-t border-[var(--border)]">
        <div className="max-w-[900px] mx-auto px-6">
          <h2 className="text-2xl font-bold text-center mb-10">Who We&apos;re Looking For</h2>
          <div className="flex justify-center gap-4 flex-wrap">
            <span className="bg-[var(--card-background)] border border-[var(--border)] px-5 py-3 rounded-full text-sm">
              📚 Study Tips
            </span>
            <span className="bg-[var(--card-background)] border border-[var(--border)] px-5 py-3 rounded-full text-sm">
              🎓 Education
            </span>
            <span className="bg-[var(--card-background)] border border-[var(--border)] px-5 py-3 rounded-full text-sm">
              💡 Productivity
            </span>
            <span className="bg-[var(--card-background)] border border-[var(--border)] px-5 py-3 rounded-full text-sm">
              📱 Tech Reviews
            </span>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="py-16 border-t border-[var(--border)]">
        <div className="max-w-[900px] mx-auto px-6">
          <h2 className="text-2xl font-bold text-center mb-10">Frequently Asked Questions</h2>
          <div className="space-y-4 max-w-[700px] mx-auto">
            <details className="bg-[var(--card-background)] border border-[var(--border)] rounded-xl p-4">
              <summary className="font-semibold cursor-pointer">How do I get paid?</summary>
              <p className="text-sm text-[var(--text-muted)] mt-3">
                Payouts are processed monthly on the 1st via Stripe Connect. You&apos;ll need to complete Stripe onboarding and have at least $50 in approved earnings.
              </p>
            </details>
            <details className="bg-[var(--card-background)] border border-[var(--border)] rounded-xl p-4">
              <summary className="font-semibold cursor-pointer">Why is there a 45-day holding period?</summary>
              <p className="text-sm text-[var(--text-muted)] mt-3">
                Earnings are held for 45 days to account for refund windows and ensure subscription quality. This protects both creators and the program from fraudulent activity.
              </p>
            </details>
            <details className="bg-[var(--card-background)] border border-[var(--border)] rounded-xl p-4">
              <summary className="font-semibold cursor-pointer">How do I keep my free premium access?</summary>
              <p className="text-sm text-[var(--text-muted)] mt-3">
                Stay active by having at least 1 paid referral, 2 content submissions, or 10 signups (trial or paid) within any 90-day period. We&apos;ll send you a warning before any changes.
              </p>
            </details>
            <details className="bg-[var(--card-background)] border border-[var(--border)] rounded-xl p-4">
              <summary className="font-semibold cursor-pointer">Can I offer discounts with my code?</summary>
              <p className="text-sm text-[var(--text-muted)] mt-3">
                Currently, promo codes are for attribution tracking. Contact us if you&apos;d like to offer special promotions to your audience.
              </p>
            </details>
          </div>
        </div>
      </section>

      {/* Apply */}
      <section className="py-16 border-t border-[var(--border)]">
        <div className="max-w-[900px] mx-auto px-6">
          <h2 className="text-2xl font-bold text-center mb-10">Join Now</h2>
          <div className="max-w-[500px] mx-auto bg-[var(--card-background)] border border-[var(--border)] rounded-2xl p-8 text-center">
            <p className="text-[var(--text-muted)] mb-6">
              Register to get your unique promo code instantly and start earning.
            </p>
            <Link
              href="/creators/register"
              className="btn-primary inline-block mb-4"
            >
              Get Your Promo Code
            </Link>
            <p className="text-sm text-[var(--text-muted)]">
              Instant approval - no waiting required.
            </p>
            <p className="text-xs text-[var(--text-muted)] mt-4">
              By registering, you agree to the{' '}
              <Link href="/referral-terms" className="text-[var(--accent-purple-light)] hover:underline">
                Creator Program Terms
              </Link>
            </p>
          </div>
        </div>
      </section>
    </>
  );
}
