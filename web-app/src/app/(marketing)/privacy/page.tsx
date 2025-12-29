import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Privacy Policy - Scribe AI',
  description: 'Scribe AI Privacy Policy - How we collect, use, and protect your information.',
};

export default function PrivacyPage() {
  return (
    <div className="py-16">
      <div className="max-w-[900px] mx-auto px-6">
        <h1 className="text-3xl md:text-4xl font-bold mb-2">Privacy Policy</h1>
        <p className="text-[var(--text-muted)] text-sm mb-12">Last updated: December 28, 2025</p>

        <section className="mb-10">
          <h2 className="text-xl font-semibold mb-4">Introduction</h2>
          <p className="text-[var(--text-secondary)] leading-relaxed">
            Kreative Koala (&quot;we,&quot; &quot;our,&quot; or &quot;us&quot;) operates the Scribe AI mobile application.
            This Privacy Policy explains how we collect, use, and protect your information.
          </p>
        </section>

        <section className="mb-10">
          <h2 className="text-xl font-semibold mb-4">Information We Collect</h2>

          <h3 className="text-lg font-medium text-[var(--text-secondary)] mb-3">Information You Provide</h3>
          <ul className="list-disc list-inside text-[var(--text-secondary)] mb-4 space-y-2">
            <li><strong className="text-[var(--text-secondary)]">Account Information:</strong> Email address and password (stored securely via Supabase authentication)</li>
            <li><strong className="text-[var(--text-secondary)]">Content:</strong> Notes, audio recordings, uploaded documents, and any content you create</li>
            <li><strong className="text-[var(--text-secondary)]">Preferences:</strong> Your app settings and customization choices</li>
          </ul>

          <h3 className="text-lg font-medium text-[var(--text-secondary)] mb-3">Information Collected Automatically</h3>
          <ul className="list-disc list-inside text-[var(--text-secondary)] space-y-2">
            <li><strong className="text-[var(--text-secondary)]">Usage Data:</strong> Features accessed, time spent, and interaction patterns</li>
            <li><strong className="text-[var(--text-secondary)]">Device Information:</strong> Device type, operating system, and unique identifiers</li>
            <li><strong className="text-[var(--text-secondary)]">Analytics:</strong> App performance and user experience data</li>
          </ul>
        </section>

        <section className="mb-10">
          <h2 className="text-xl font-semibold mb-4">How We Use Your Information</h2>
          <ul className="list-disc list-inside text-[var(--text-secondary)] space-y-2">
            <li>Provide and improve the App&apos;s functionality</li>
            <li>Process your content through AI services (transcription, summarization, quiz generation)</li>
            <li>Personalize your experience</li>
            <li>Send updates, security alerts, and support messages</li>
            <li>Analyze usage patterns to improve the App</li>
          </ul>
        </section>

        <section className="mb-10">
          <h2 className="text-xl font-semibold mb-4">AI Processing</h2>
          <p className="text-[var(--text-secondary)] leading-relaxed">
            Your content is processed using third-party AI services to provide transcription, summarization,
            flashcard generation, and podcast creation. Your content is not used to train AI models.
          </p>
        </section>

        <section className="mb-10">
          <h2 className="text-xl font-semibold mb-4">Data Storage and Security</h2>
          <ul className="list-disc list-inside text-[var(--text-secondary)] space-y-2">
            <li>User authentication via Supabase with encryption at rest and in transit</li>
            <li>Audio and document files stored securely in cloud storage</li>
            <li>All data transmission encrypted using HTTPS/TLS</li>
          </ul>
        </section>

        <section className="mb-10">
          <h2 className="text-xl font-semibold mb-4">Data Sharing</h2>
          <p className="text-[var(--text-secondary)] mb-3">We do not sell your personal information. We may share information with:</p>
          <ul className="list-disc list-inside text-[var(--text-secondary)] space-y-2">
            <li><strong className="text-[var(--text-secondary)]">Service Providers:</strong> Third-party services that help us operate the App</li>
            <li><strong className="text-[var(--text-secondary)]">Legal Requirements:</strong> When required by law</li>
            <li><strong className="text-[var(--text-secondary)]">Business Transfers:</strong> In connection with a merger or acquisition</li>
          </ul>
        </section>

        <section className="mb-10">
          <h2 className="text-xl font-semibold mb-4">Your Rights</h2>
          <ul className="list-disc list-inside text-[var(--text-secondary)] space-y-2">
            <li><strong className="text-[var(--text-secondary)]">Access:</strong> Request a copy of your personal data</li>
            <li><strong className="text-[var(--text-secondary)]">Delete:</strong> Request deletion of your account and data</li>
            <li><strong className="text-[var(--text-secondary)]">Export:</strong> Export your notes and content</li>
            <li><strong className="text-[var(--text-secondary)]">Opt-out:</strong> Disable analytics and non-essential data collection</li>
          </ul>
          <p className="text-[var(--text-secondary)] mt-4">
            To exercise these rights, contact us at{' '}
            <a href="mailto:privacy@scribeai.online" className="text-[var(--accent-purple-light)] hover:underline">
              privacy@scribeai.online
            </a>
          </p>
        </section>

        <section className="mb-10">
          <h2 className="text-xl font-semibold mb-4">Data Retention</h2>
          <p className="text-[var(--text-secondary)] leading-relaxed">
            We retain your data while your account is active. When you delete your account,
            we delete your data within 30 days, except where retention is required by law.
          </p>
        </section>

        <section className="mb-10">
          <h2 className="text-xl font-semibold mb-4">Children&apos;s Privacy</h2>
          <p className="text-[var(--text-secondary)] leading-relaxed">
            The App is not intended for children under 13. We do not knowingly collect information from children under 13.
          </p>
        </section>

        <section className="mb-10">
          <h2 className="text-xl font-semibold mb-4">Changes to This Policy</h2>
          <p className="text-[var(--text-secondary)] leading-relaxed">
            We may update this Privacy Policy from time to time. Changes will be posted on this page with an updated date.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-4">Contact Us</h2>
          <p className="text-[var(--text-secondary)]">
            Questions? Email us at{' '}
            <a href="mailto:privacy@scribeai.online" className="text-[var(--accent-purple-light)] hover:underline">
              privacy@scribeai.online
            </a>
          </p>
        </section>
      </div>
    </div>
  );
}
