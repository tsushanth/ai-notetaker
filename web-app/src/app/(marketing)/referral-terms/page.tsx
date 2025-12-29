import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Creator Program Terms - Scribe AI',
  description: 'Scribe AI Creator Program Terms - Terms and conditions for the creator referral program.',
};

export default function ReferralTermsPage() {
  return (
    <div className="py-16">
      <div className="max-w-[900px] mx-auto px-6">
        <h1 className="text-3xl md:text-4xl font-bold mb-2">Creator Program Terms</h1>
        <p className="text-[var(--text-muted)] text-sm mb-12">Last updated: December 28, 2025</p>

        <section className="mb-10">
          <h2 className="text-xl font-semibold mb-4">1. Program Overview</h2>
          <p className="text-[var(--text-secondary)] leading-relaxed">
            The Scribe AI Creator Program (&quot;Program&quot;) allows approved content creators to earn revenue
            by promoting Scribe AI. By participating, you agree to these terms.
          </p>
        </section>

        <section className="mb-10">
          <h2 className="text-xl font-semibold mb-4">2. Eligibility</h2>
          <p className="text-[var(--text-secondary)] mb-3">To participate, you must:</p>
          <ul className="list-disc list-inside text-[var(--text-secondary)] space-y-2">
            <li>Be at least 18 years of age</li>
            <li>Have an active social media presence or content platform</li>
            <li>Submit an application and be approved by Scribe AI</li>
            <li>Comply with all applicable laws and regulations</li>
            <li>Have a PayPal account or other approved payment method</li>
          </ul>
        </section>

        <section className="mb-10">
          <h2 className="text-xl font-semibold mb-4">3. How It Works</h2>

          <h3 className="text-lg font-medium text-[var(--text-secondary)] mb-3">Referral Links</h3>
          <p className="text-[var(--text-secondary)] mb-4">
            Upon approval, you will receive a unique referral link. When users subscribe using your link,
            you earn a commission.
          </p>

          <h3 className="text-lg font-medium text-[var(--text-secondary)] mb-3">Attribution</h3>
          <p className="text-[var(--text-secondary)] mb-4">
            Referrals are tracked using cookies that last 30 days. If a user clicks your link and subscribes
            within 30 days, the referral is attributed to you.
          </p>

          <h3 className="text-lg font-medium text-[var(--text-secondary)] mb-3">Qualifying Actions</h3>
          <p className="text-[var(--text-secondary)]">
            You earn commission when a referred user downloads the app, creates an account, and converts
            to a paid subscription.
          </p>
        </section>

        <section className="mb-10">
          <h2 className="text-xl font-semibold mb-4">4. Commission Structure</h2>
          <p className="text-[var(--text-secondary)] leading-relaxed">
            Commission rates will be communicated upon program acceptance. Rates may vary based on audience size,
            content quality, and historical performance. We reserve the right to modify rates with 30 days notice.
          </p>
        </section>

        <section className="mb-10">
          <h2 className="text-xl font-semibold mb-4">5. Payment Terms</h2>
          <ul className="list-disc list-inside text-[var(--text-secondary)] space-y-2">
            <li><strong className="text-[var(--text-secondary)]">Minimum Payout:</strong> $50 USD minimum before payment is processed</li>
            <li><strong className="text-[var(--text-secondary)]">Payment Schedule:</strong> Monthly, within 30 days of month end</li>
            <li><strong className="text-[var(--text-secondary)]">Payment Methods:</strong> PayPal or bank transfer</li>
            <li><strong className="text-[var(--text-secondary)]">Currency:</strong> All payments in USD</li>
            <li><strong className="text-[var(--text-secondary)]">Taxes:</strong> You are responsible for any taxes on earnings</li>
          </ul>
        </section>

        <section className="mb-10">
          <h2 className="text-xl font-semibold mb-4">6. Promotional Guidelines</h2>
          <p className="text-[var(--text-secondary)] mb-3">When promoting Scribe AI, you must:</p>
          <ul className="list-disc list-inside text-[var(--text-secondary)] space-y-2 mb-6">
            <li>Clearly disclose your affiliate relationship (#ad or similar)</li>
            <li>Provide honest and accurate information</li>
            <li>Not make false or misleading claims</li>
            <li>Follow FTC guidelines and local advertising regulations</li>
          </ul>

          <h3 className="text-lg font-medium text-[var(--text-secondary)] mb-3">Prohibited Activities</h3>
          <ul className="list-disc list-inside text-[var(--text-secondary)] space-y-2">
            <li>Bidding on Scribe AI brand terms in paid ads</li>
            <li>Creating fake reviews or testimonials</li>
            <li>Making income claims or guarantees</li>
            <li>Using your own referral link for personal subscriptions</li>
            <li>Generating fake clicks, downloads, or subscriptions</li>
          </ul>
        </section>

        <section className="mb-10">
          <h2 className="text-xl font-semibold mb-4">7. Intellectual Property</h2>
          <p className="text-[var(--text-secondary)] leading-relaxed">
            You may use Scribe AI logos and promotional materials we provide. You may not modify our branding,
            register similar domain names, or create services that impersonate Scribe AI.
          </p>
        </section>

        <section className="mb-10">
          <h2 className="text-xl font-semibold mb-4">8. Termination</h2>
          <p className="text-[var(--text-secondary)] leading-relaxed">
            Either party may terminate at any time. We may immediately terminate for violation of terms,
            fraudulent activity, or damage to our reputation. Upon termination, unpaid commissions above
            the minimum will be paid within 60 days.
          </p>
        </section>

        <section className="mb-10">
          <h2 className="text-xl font-semibold mb-4">9. Limitation of Liability</h2>
          <p className="text-[var(--text-secondary)] leading-relaxed">
            We are not responsible for lost commissions due to technical issues, user cancellations, or refunds.
            Maximum liability is limited to unpaid commissions owed.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-4">10. Contact</h2>
          <p className="text-[var(--text-secondary)]">
            Questions? Email us at{' '}
            <a href="mailto:creators@scribeai.online" className="text-[var(--accent-purple-light)] hover:underline">
              creators@scribeai.online
            </a>
          </p>
        </section>
      </div>
    </div>
  );
}
