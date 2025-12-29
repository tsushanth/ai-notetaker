import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Terms of Service - Scribe AI',
  description: 'Scribe AI Terms of Service - Terms and conditions for using the application.',
};

export default function TermsPage() {
  return (
    <div className="py-16">
      <div className="max-w-[900px] mx-auto px-6">
        <h1 className="text-3xl md:text-4xl font-bold mb-2">Terms of Service</h1>
        <p className="text-[var(--text-muted)] text-sm mb-12">Last updated: December 28, 2025</p>

        <section className="mb-10">
          <h2 className="text-xl font-semibold mb-4">1. Agreement to Terms</h2>
          <p className="text-[var(--text-secondary)] leading-relaxed">
            By downloading, installing, or using the Scribe AI mobile application (&quot;App&quot;), you agree to be bound
            by these Terms of Service. If you do not agree, do not use the App.
          </p>
        </section>

        <section className="mb-10">
          <h2 className="text-xl font-semibold mb-4">2. Description of Service</h2>
          <p className="text-[var(--text-secondary)] mb-3">Scribe AI uses artificial intelligence to:</p>
          <ul className="list-disc list-inside text-[var(--text-secondary)] space-y-2">
            <li>Transcribe audio recordings</li>
            <li>Generate notes and summaries from various content sources</li>
            <li>Create flashcards and quizzes</li>
            <li>Generate AI podcast discussions</li>
            <li>Process documents and YouTube videos</li>
          </ul>
        </section>

        <section className="mb-10">
          <h2 className="text-xl font-semibold mb-4">3. Account Registration</h2>
          <p className="text-[var(--text-secondary)] mb-3">To use certain features, you must create an account. You agree to:</p>
          <ul className="list-disc list-inside text-[var(--text-secondary)] space-y-2">
            <li>Provide accurate and complete information</li>
            <li>Maintain the security of your account credentials</li>
            <li>Notify us immediately of any unauthorized use</li>
            <li>Accept responsibility for all activities under your account</li>
          </ul>
        </section>

        <section className="mb-10">
          <h2 className="text-xl font-semibold mb-4">4. Subscriptions and Payments</h2>

          <h3 className="text-lg font-medium text-[var(--text-secondary)] mb-3">Free Trial</h3>
          <p className="text-[var(--text-secondary)] mb-4">
            New users may be eligible for a free trial period. You will not be charged during the trial.
          </p>

          <h3 className="text-lg font-medium text-[var(--text-secondary)] mb-3">Subscription Plans</h3>
          <p className="text-[var(--text-secondary)] mb-4">
            After the trial, continued access to premium features requires a paid subscription. Details are displayed in the App.
          </p>

          <h3 className="text-lg font-medium text-[var(--text-secondary)] mb-3">Billing</h3>
          <ul className="list-disc list-inside text-[var(--text-secondary)] space-y-2 mb-4">
            <li>Subscriptions are billed in advance on a recurring basis</li>
            <li>Payment is processed through Apple App Store or Google Play Store</li>
            <li>Subscriptions automatically renew unless canceled at least 24 hours before the end of the current period</li>
          </ul>

          <h3 className="text-lg font-medium text-[var(--text-secondary)] mb-3">Refunds</h3>
          <p className="text-[var(--text-secondary)]">
            Refunds are handled by Apple or Google according to their respective refund policies.
          </p>
        </section>

        <section className="mb-10">
          <h2 className="text-xl font-semibold mb-4">5. User Content</h2>
          <p className="text-[var(--text-secondary)] leading-relaxed mb-3">
            You retain ownership of all content you upload, record, or create. By using the App, you grant us
            a limited license to process your content as necessary to provide our services.
          </p>
          <p className="text-[var(--text-secondary)] leading-relaxed">
            You agree not to upload content that infringes on intellectual property rights, contains malware,
            is illegal or defamatory, or violates the privacy of others.
          </p>
        </section>

        <section className="mb-10">
          <h2 className="text-xl font-semibold mb-4">6. Acceptable Use</h2>
          <p className="text-[var(--text-secondary)] mb-3">You agree not to:</p>
          <ul className="list-disc list-inside text-[var(--text-secondary)] space-y-2">
            <li>Use the App for any unlawful purpose</li>
            <li>Attempt to gain unauthorized access to the App or its systems</li>
            <li>Interfere with or disrupt the App&apos;s functionality</li>
            <li>Reverse engineer or attempt to extract source code</li>
            <li>Share your account credentials with others</li>
          </ul>
        </section>

        <section className="mb-10">
          <h2 className="text-xl font-semibold mb-4">7. AI-Generated Content</h2>
          <p className="text-[var(--text-secondary)] leading-relaxed">
            Content generated by the App&apos;s AI features is provided &quot;as is.&quot; While we strive for accuracy,
            AI-generated content may contain errors. You should verify important information independently.
          </p>
        </section>

        <section className="mb-10">
          <h2 className="text-xl font-semibold mb-4">8. Disclaimer of Warranties</h2>
          <p className="text-[var(--text-secondary)] leading-relaxed uppercase">
            The App is provided &quot;as is&quot; without warranties of any kind. We do not warrant that the App
            will be uninterrupted, error-free, or secure.
          </p>
        </section>

        <section className="mb-10">
          <h2 className="text-xl font-semibold mb-4">9. Limitation of Liability</h2>
          <p className="text-[var(--text-secondary)] leading-relaxed uppercase">
            To the maximum extent permitted by law, Kreative Koala shall not be liable for any indirect,
            incidental, special, or consequential damages arising from your use of the App.
          </p>
        </section>

        <section className="mb-10">
          <h2 className="text-xl font-semibold mb-4">10. Termination</h2>
          <p className="text-[var(--text-secondary)] leading-relaxed">
            We may suspend or terminate your access to the App at any time for violation of these Terms.
            Upon termination, your right to use the App will cease immediately.
          </p>
        </section>

        <section className="mb-10">
          <h2 className="text-xl font-semibold mb-4">11. Changes to Terms</h2>
          <p className="text-[var(--text-secondary)] leading-relaxed">
            We may update these Terms from time to time. Continued use of the App after changes constitutes
            acceptance of the new Terms.
          </p>
        </section>

        <section className="mb-10">
          <h2 className="text-xl font-semibold mb-4">12. Governing Law</h2>
          <p className="text-[var(--text-secondary)] leading-relaxed">
            These Terms are governed by the laws of the State of California, United States.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-4">13. Contact</h2>
          <p className="text-[var(--text-secondary)]">
            Questions? Email us at{' '}
            <a href="mailto:legal@scribeai.online" className="text-[var(--accent-purple-light)] hover:underline">
              legal@scribeai.online
            </a>
          </p>
        </section>
      </div>
    </div>
  );
}
