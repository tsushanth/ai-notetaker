'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/store/authStore';
import Link from 'next/link';
import { Loader2 } from 'lucide-react';
import MarketingHeader from '@/components/marketing/MarketingHeader';
import MarketingFooter from '@/components/marketing/MarketingFooter';

export default function Home() {
  const router = useRouter();
  const { isAuthenticated, isLoading } = useAuthStore();
  const [showLanding, setShowLanding] = useState(false);

  useEffect(() => {
    // Wait for hydration to complete
    if (!isLoading) {
      if (isAuthenticated) {
        router.replace('/notes');
      } else {
        setShowLanding(true);
      }
    }
  }, [isAuthenticated, isLoading, router]);

  // Show loading while checking auth
  if (isLoading || (isAuthenticated && !showLanding)) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="w-8 h-8 animate-spin text-[var(--accent-purple)] mx-auto mb-4" />
          <p className="text-[var(--text-secondary)]">Loading...</p>
        </div>
      </div>
    );
  }

  // Show landing page for unauthenticated users
  return (
    <div className="min-h-screen flex flex-col">
      <MarketingHeader />
      <main className="flex-1">
        {/* Hero */}
        <section className="text-center py-20 md:py-24">
          <div className="max-w-[900px] mx-auto px-6">
            <h1 className="text-4xl md:text-5xl font-bold mb-4 leading-tight">
              Learn Smarter,<br />Not Harder
            </h1>
            <p className="text-lg text-[var(--text-muted)] max-w-[500px] mx-auto mb-8">
              Turn any content into study notes, flashcards, quizzes, and podcasts.
            </p>
            {/* Try Web App Button */}
            <div className="mb-8">
              <Link
                href="/login"
                className="inline-block bg-[var(--accent-purple)] text-white px-8 py-3 rounded-lg font-semibold text-lg hover:bg-[var(--accent-purple-hover)] transition"
              >
                Try Web App Free
              </Link>
            </div>
            <p className="text-sm text-[var(--text-muted)] mb-4">Or download the mobile app:</p>
            <div className="flex justify-center gap-3 flex-wrap">
              <a
                href="https://apps.apple.com/us/app/scribe-ai-learn/id6755475602"
                target="_blank"
                rel="noopener noreferrer"
              >
                <img
                  src="https://tools.applemediaservices.com/api/badges/download-on-the-app-store/black/en-us?size=250x83"
                  alt="Download on the App Store"
                  className="h-11"
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
                  className="h-11"
                />
              </a>
            </div>
          </div>
        </section>

        {/* How It Works */}
        <section className="py-16 border-t border-[var(--border)]">
          <div className="max-w-[900px] mx-auto px-6">
            <h2 className="text-2xl md:text-3xl font-bold text-center mb-10">How It Works</h2>
            <div className="flex justify-center gap-12 flex-wrap">
              <div className="text-center max-w-[220px]">
                <div className="w-10 h-10 bg-[var(--accent-purple)] rounded-full flex items-center justify-center mx-auto mb-3 font-bold">
                  1
                </div>
                <h3 className="font-semibold mb-2">Capture</h3>
                <p className="text-sm text-[var(--text-muted)]">
                  Record lectures, paste YouTube links, or upload PDFs.
                </p>
              </div>
              <div className="text-center max-w-[220px]">
                <div className="w-10 h-10 bg-[var(--accent-purple)] rounded-full flex items-center justify-center mx-auto mb-3 font-bold">
                  2
                </div>
                <h3 className="font-semibold mb-2">Process</h3>
                <p className="text-sm text-[var(--text-muted)]">
                  AI transcribes and organizes your content.
                </p>
              </div>
              <div className="text-center max-w-[220px]">
                <div className="w-10 h-10 bg-[var(--accent-purple)] rounded-full flex items-center justify-center mx-auto mb-3 font-bold">
                  3
                </div>
                <h3 className="font-semibold mb-2">Study</h3>
                <p className="text-sm text-[var(--text-muted)]">
                  Review notes, flashcards, quizzes, or podcasts.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Features */}
        <section className="py-16 border-t border-[var(--border)]">
          <div className="max-w-[900px] mx-auto px-6">
            <h2 className="text-2xl md:text-3xl font-bold text-center mb-10">Features</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
              <FeatureCard icon="📝" title="Smart Notes" description="AI-generated summaries and outlines" />
              <FeatureCard icon="🗂️" title="Flashcards" description="Auto-generated for spaced repetition" />
              <FeatureCard icon="❓" title="Quizzes" description="Test yourself with AI questions" />
              <FeatureCard icon="🎧" title="AI Podcasts" description="Listen to your notes on the go" />
              <FeatureCard icon="📺" title="YouTube Import" description="Paste any URL for instant notes" />
              <FeatureCard icon="🎙️" title="Recording" description="Record and transcribe lectures" />
            </div>
          </div>
        </section>

        {/* Who It's For */}
        <section className="py-16 border-t border-[var(--border)]">
          <div className="max-w-[900px] mx-auto px-6">
            <h2 className="text-2xl md:text-3xl font-bold text-center mb-10">Who It&apos;s For</h2>
            <div className="flex justify-center gap-4 flex-wrap">
              <span className="bg-[var(--card-background)] border border-[var(--border)] px-5 py-2.5 rounded-full text-sm">
                🎓 Students
              </span>
              <span className="bg-[var(--card-background)] border border-[var(--border)] px-5 py-2.5 rounded-full text-sm">
                💼 Professionals
              </span>
              <span className="bg-[var(--card-background)] border border-[var(--border)] px-5 py-2.5 rounded-full text-sm">
                🧠 Learners
              </span>
              <span className="bg-[var(--card-background)] border border-[var(--border)] px-5 py-2.5 rounded-full text-sm">
                📚 Researchers
              </span>
            </div>
          </div>
        </section>

        {/* Testimonial */}
        <section className="py-16 border-t border-[var(--border)]">
          <div className="max-w-[900px] mx-auto px-6">
            <h2 className="text-2xl md:text-3xl font-bold text-center mb-10">What Users Say</h2>
            <div className="max-w-[500px] mx-auto bg-[var(--card-background)] border border-[var(--border)] rounded-2xl p-8 text-center">
              <div className="text-amber-400 text-xl mb-3">★★★★★</div>
              <blockquote className="italic mb-3">
                &quot;Game changer for my med school studies. Perfect notes in minutes.&quot;
              </blockquote>
              <cite className="text-sm text-[var(--text-muted)]">— Medical Student</cite>
            </div>
          </div>
        </section>

        {/* CTA */}
        <section className="py-16 text-center">
          <div className="max-w-[900px] mx-auto px-6">
            <h2 className="text-2xl md:text-3xl font-bold mb-3">Ready to Learn Smarter?</h2>
            <p className="text-[var(--text-muted)] mb-6">Free to start. Available on web, iOS, and Android.</p>
            <div className="mb-6">
              <Link
                href="/login"
                className="inline-block bg-[var(--accent-purple)] text-white px-8 py-3 rounded-lg font-semibold text-lg hover:bg-[var(--accent-purple-hover)] transition"
              >
                Try Web App Free
              </Link>
            </div>
            <p className="text-sm text-[var(--text-muted)] mb-4">Or download the mobile app:</p>
            <div className="flex justify-center gap-3 flex-wrap">
              <a
                href="https://apps.apple.com/us/app/scribe-ai-learn/id6755475602"
                target="_blank"
                rel="noopener noreferrer"
              >
                <img
                  src="https://tools.applemediaservices.com/api/badges/download-on-the-app-store/black/en-us?size=250x83"
                  alt="Download on the App Store"
                  className="h-11"
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
                  className="h-11"
                />
              </a>
            </div>
          </div>
        </section>
      </main>
      <MarketingFooter />
    </div>
  );
}

function FeatureCard({ icon, title, description }: { icon: string; title: string; description: string }) {
  return (
    <div className="bg-[var(--card-background)] border border-[var(--border)] rounded-xl p-5">
      <div className="text-3xl mb-2">{icon}</div>
      <h3 className="font-semibold mb-1">{title}</h3>
      <p className="text-sm text-[var(--text-muted)]">{description}</p>
    </div>
  );
}
