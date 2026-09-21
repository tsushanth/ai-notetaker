'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/store/authStore';
import Link from 'next/link';
import MarketingHeader from '@/components/marketing/MarketingHeader';
import MarketingFooter from '@/components/marketing/MarketingFooter';
import { Mic, Youtube, FileText, ChevronDown } from 'lucide-react';
import { STUDY_FORMATS } from '@/lib/studyFormats';

const PIPELINE = [
  {
    title: 'Capture',
    body: 'Record a lecture, paste a YouTube link, or upload a PDF or slide deck.',
  },
  {
    title: 'Process',
    body: 'Scribe AI transcribes it and organizes the content into an outline.',
  },
  {
    title: 'Study',
    body: 'Review the notes, drill the flashcards, take the quiz, or just listen.',
  },
];

const FAQ = [
  {
    q: 'What can I turn into notes?',
    a: 'A recorded lecture or conversation, a YouTube link, or an uploaded PDF, slide deck, or document.',
  },
  {
    q: 'Do I need the app to use it?',
    a: 'No — Scribe AI works in the browser. iOS and Android apps are there if you’d rather record from your phone.',
  },
  {
    q: 'Is there a free plan?',
    a: 'Yes. You can start taking notes for free, then upgrade if you need more.',
  },
  {
    q: 'Who owns what I upload?',
    a: 'You do. Recordings and documents are yours — see the privacy policy for details on how they’re handled.',
  },
];

export default function Home() {
  const router = useRouter();
  const { isAuthenticated, isLoading } = useAuthStore();
  const [openFaq, setOpenFaq] = useState<number | null>(0);

  // Render the real landing page content immediately instead of gating it
  // behind an auth check — the raw HTML AI crawlers (GPTBot, ClaudeBot, etc.)
  // fetch never executes JS, so a loading-spinner-first render meant they saw
  // "Loading..." instead of the actual marketing copy. Signed-in users still
  // get redirected client-side once the auth check resolves; that's a brief
  // flash of the landing page for them, which is the standard trade-off for
  // keeping the initial HTML crawlable.
  useEffect(() => {
    if (!isLoading && isAuthenticated) {
      router.replace('/notes');
    }
  }, [isAuthenticated, isLoading, router]);

  return (
    <div className="site-marketing min-h-screen flex flex-col bg-[var(--background)] text-[var(--foreground)] font-[family-name:var(--font-inter)]">
      <MarketingHeader />
      <main className="flex-1">
        {/* Hero */}
        <section className="pt-20 pb-16 md:pt-28 md:pb-20">
          <div className="max-w-[1000px] mx-auto px-6 grid md:grid-cols-[1.1fr_1fr] gap-14 items-center">
            <div>
              <h1 className="font-[family-name:var(--font-display)] text-4xl md:text-5xl font-medium leading-[1.1] tracking-tight mb-5">
                Turn lectures into notes you&apos;ll actually study.
              </h1>
              <p className="text-lg text-[var(--text-secondary)] max-w-[440px] mb-8 leading-relaxed">
                Record a class, paste a YouTube link, or drop in a PDF. Scribe AI turns it into
                notes, flashcards, a quiz, and a podcast you can listen to on the way to the next one.
              </p>
              <div className="flex flex-wrap items-center gap-4 mb-6">
                <Link
                  href="/login"
                  className="inline-block bg-[var(--accent-purple)] text-[#14110a] px-7 py-3.5 rounded-full font-semibold hover:bg-[var(--accent-purple-hover)] transition"
                >
                  Start studying free
                </Link>
                <a
                  href="#pipeline"
                  className="text-sm font-medium text-[var(--foreground)] underline decoration-[var(--border)] underline-offset-4 hover:decoration-[var(--text-secondary)]"
                >
                  See how it works
                </a>
              </div>
              <div className="flex items-center gap-3 flex-wrap">
                <a
                  href="https://apps.apple.com/us/app/scribe-ai-learn/id6755475602"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <img
                    src="https://tools.applemediaservices.com/api/badges/download-on-the-app-store/black/en-us?size=250x83"
                    alt="Download on the App Store"
                    className="h-10"
                  />
                </a>
                <a
                  href="https://play.google.com/store/apps/details?id=com.kreativekoala.scribeai"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <img
                    src="https://play.google.com/intl/en_us/badges/static/images/badges/en_badge_web_generic.png"
                    alt="Get it on Google Play"
                    className="h-10"
                  />
                </a>
              </div>
            </div>

            {/* The mechanism: what goes in, what comes out */}
            <div className="relative">
              <div className="rounded-2xl border border-[var(--border)] bg-[var(--card-background)] p-6">
                <p className="text-sm text-[var(--text-muted)] mb-4">Drop in anything</p>
                <div className="flex gap-3">
                  <SourceChip icon={Mic} label="Lecture" />
                  <SourceChip icon={Youtube} label="YouTube" />
                  <SourceChip icon={FileText} label="PDF" />
                </div>

                <div className="my-6 flex items-center gap-3 text-[var(--text-muted)]">
                  <span className="h-px flex-1 bg-[var(--border)]" />
                  <span className="text-xs">becomes</span>
                  <span className="h-px flex-1 bg-[var(--border)]" />
                </div>

                <p className="text-sm text-[var(--text-muted)] mb-3">Get study material back</p>
                <div className="rounded-xl border border-[var(--border)] bg-[var(--background)] p-4 space-y-2">
                  <div className="h-2.5 w-4/5 rounded-full bg-[var(--surface-variant)]" />
                  <div className="h-2.5 w-3/5 rounded-full bg-[var(--surface-variant)]" />
                  <div className="h-2.5 w-2/3 rounded-full bg-[var(--surface-variant)]" />
                </div>
              </div>
              {/* Flashcard peeking out — one deliberate flourish, not repeated elsewhere */}
              <div className="absolute -bottom-5 -right-4 hidden sm:block w-32 rotate-6 rounded-lg border border-[var(--border)] bg-[var(--card-background)] p-3 shadow-lg">
                <p className="text-[10px] text-[var(--text-muted)] mb-1">Card 3 of 24</p>
                <p className="text-xs font-medium">What is the citric acid cycle?</p>
              </div>
            </div>
          </div>
        </section>

        {/* Pipeline */}
        <section id="pipeline" className="py-16 border-t border-[var(--border)]">
          <div className="max-w-[1000px] mx-auto px-6">
            <h2 className="font-[family-name:var(--font-display)] text-2xl md:text-3xl font-medium mb-10">
              Three steps, no rereading.
            </h2>
            <div className="grid sm:grid-cols-3 gap-10">
              {PIPELINE.map((step, i) => (
                <div key={step.title}>
                  <span className="font-[family-name:var(--font-display)] text-3xl text-[var(--text-muted)]">
                    {i + 1}
                  </span>
                  <h3 className="font-semibold mt-2 mb-1.5">{step.title}</h3>
                  <p className="text-sm text-[var(--text-secondary)] leading-relaxed">{step.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Formats */}
        <section className="py-16 border-t border-[var(--border)]">
          <div className="max-w-[1000px] mx-auto px-6">
            <h2 className="font-[family-name:var(--font-display)] text-2xl md:text-3xl font-medium mb-10">
              Four ways to study the same material.
            </h2>
            <div className="divide-y divide-[var(--border)] border-y border-[var(--border)]">
              {STUDY_FORMATS.map((f) => (
                <div key={f.name} className="py-5 flex flex-col sm:flex-row sm:items-baseline gap-1 sm:gap-8">
                  <h3 className="font-semibold sm:w-40 flex-shrink-0">{f.name}</h3>
                  <p className="text-sm text-[var(--text-secondary)]">{f.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Who it's for */}
        <section className="py-16 border-t border-[var(--border)]">
          <div className="max-w-[1000px] mx-auto px-6">
            <p className="text-lg leading-relaxed max-w-[640px]">
              Built for pre-med students memorizing anatomy, MBAs prepping for a case, researchers
              working through interviews, and anyone else who&apos;d rather listen back than
              retype their notes.
            </p>
          </div>
        </section>

        {/* FAQ */}
        <section className="py-16 border-t border-[var(--border)]">
          <div className="max-w-[700px] mx-auto px-6">
            <h2 className="font-[family-name:var(--font-display)] text-2xl md:text-3xl font-medium mb-8">
              Questions
            </h2>
            <div className="divide-y divide-[var(--border)] border-y border-[var(--border)]">
              {FAQ.map((item, i) => {
                const open = openFaq === i;
                return (
                  <div key={item.q}>
                    <button
                      onClick={() => setOpenFaq(open ? null : i)}
                      className="w-full flex items-center justify-between gap-4 py-4 text-left"
                      aria-expanded={open}
                    >
                      <span className="font-medium">{item.q}</span>
                      <ChevronDown
                        className={`h-4 w-4 flex-shrink-0 text-[var(--text-muted)] transition-transform ${open ? 'rotate-180' : ''}`}
                      />
                    </button>
                    {open && (
                      <p className="pb-4 text-sm text-[var(--text-secondary)] leading-relaxed">{item.a}</p>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        {/* CTA */}
        <section className="py-20 text-center border-t border-[var(--border)]">
          <div className="max-w-[700px] mx-auto px-6">
            <h2 className="font-[family-name:var(--font-display)] text-2xl md:text-3xl font-medium mb-3">
              Stop rereading. Start remembering.
            </h2>
            <p className="text-[var(--text-secondary)] mb-8">Free to start. Web, iOS, and Android.</p>
            <Link
              href="/login"
              className="inline-block bg-[var(--accent-purple)] text-[#14110a] px-8 py-3.5 rounded-full font-semibold hover:bg-[var(--accent-purple-hover)] transition"
            >
              Start studying free
            </Link>
          </div>
        </section>
      </main>
      <MarketingFooter />
    </div>
  );
}

function SourceChip({ icon: Icon, label }: { icon: typeof Mic; label: string }) {
  return (
    <div className="flex-1 flex flex-col items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--background)] py-4">
      <Icon className="h-5 w-5 text-[var(--accent-purple)]" strokeWidth={1.75} />
      <span className="text-xs text-[var(--text-secondary)]">{label}</span>
    </div>
  );
}
