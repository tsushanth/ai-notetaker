import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Contact - Scribe AI',
  description: 'Contact Scribe AI - Get in touch for support, feedback, or partnership inquiries.',
};

export default function ContactPage() {
  return (
    <>
      {/* Hero */}
      <section className="text-center py-20">
        <div className="max-w-[900px] mx-auto px-6">
          <h1 className="text-3xl md:text-4xl font-bold mb-4">Get in Touch</h1>
          <p className="text-lg text-[var(--text-muted)]">
            Have a question or feedback? We&apos;d love to hear from you.
          </p>
        </div>
      </section>

      {/* Contact Methods */}
      <section className="pb-16">
        <div className="max-w-[900px] mx-auto px-6">
          <div className="flex justify-center gap-6 flex-wrap mb-16">
            <div className="bg-[var(--card-background)] border border-[var(--border)] rounded-xl px-8 py-6 text-center min-w-[200px]">
              <div className="text-3xl mb-3">📧</div>
              <h3 className="font-semibold mb-2">General</h3>
              <a
                href="mailto:hello@scribeai.online"
                className="text-[var(--accent-purple-light)] text-sm hover:underline"
              >
                hello@scribeai.online
              </a>
            </div>
            <div className="bg-[var(--card-background)] border border-[var(--border)] rounded-xl px-8 py-6 text-center min-w-[200px]">
              <div className="text-3xl mb-3">🛠️</div>
              <h3 className="font-semibold mb-2">Support</h3>
              <a
                href="mailto:support@scribeai.online"
                className="text-[var(--accent-purple-light)] text-sm hover:underline"
              >
                support@scribeai.online
              </a>
            </div>
            <div className="bg-[var(--card-background)] border border-[var(--border)] rounded-xl px-8 py-6 text-center min-w-[200px]">
              <div className="text-3xl mb-3">⏱️</div>
              <h3 className="font-semibold mb-2">Response</h3>
              <p className="text-[var(--text-muted)] text-sm">Within 24-48 hours</p>
            </div>
          </div>

          {/* Contact Form CTA */}
          <div className="max-w-[500px] mx-auto bg-[var(--card-background)] border border-[var(--border)] rounded-2xl p-8 text-center">
            <h2 className="text-xl font-semibold mb-4">Send a Message</h2>
            <p className="text-[var(--text-muted)] mb-6">
              Have a question or feedback? We&apos;d love to hear from you.
            </p>
            <a
              href="https://docs.google.com/forms/d/e/1FAIpQLSfynfCWPr0UlQK0qnBFu4MfmW4mWevpNBfDzseLCNv1xrXenw/viewform"
              target="_blank"
              rel="noopener noreferrer"
              className="btn-primary inline-block"
            >
              Open Contact Form
            </a>
          </div>

          {/* FAQ */}
          <div className="max-w-[600px] mx-auto mt-16">
            <h2 className="text-xl font-semibold text-center mb-8">Common Questions</h2>
            <div className="space-y-0">
              <div className="border-b border-[var(--border)] py-4">
                <h3 className="font-medium mb-2">How do I cancel my subscription?</h3>
                <p className="text-sm text-[var(--text-muted)]">
                  Go to your device&apos;s app store settings to manage subscriptions.
                </p>
              </div>
              <div className="border-b border-[var(--border)] py-4">
                <h3 className="font-medium mb-2">Can I export my notes?</h3>
                <p className="text-sm text-[var(--text-muted)]">
                  Yes! Tap the share button on any note to export.
                </p>
              </div>
              <div className="py-4">
                <h3 className="font-medium mb-2">Is my data secure?</h3>
                <p className="text-sm text-[var(--text-muted)]">
                  Yes, we use industry-standard encryption. See our{' '}
                  <Link href="/privacy" className="text-[var(--accent-purple-light)] hover:underline">
                    Privacy Policy
                  </Link>
                  .
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
