'use client';

import { useState } from 'react';
import Link from 'next/link';
import { creatorsApi } from '@/lib/api';
import { Loader2, CheckCircle, Copy, Check } from 'lucide-react';

const SOCIAL_PLATFORMS = [
  { value: 'youtube', label: 'YouTube' },
  { value: 'tiktok', label: 'TikTok' },
  { value: 'instagram', label: 'Instagram' },
  { value: 'twitter', label: 'Twitter/X' },
  { value: 'other', label: 'Other' },
];

export default function CreatorRegisterPage() {
  const [formData, setFormData] = useState({
    email: '',
    name: '',
    username: '',
    socialPlatform: '',
    socialUrl: '',
    socialFollowers: '',
  });
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState<{
    promoCode: string;
    creatorName: string;
  } | null>(null);
  const [copied, setCopied] = useState(false);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
    setError('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    try {
      const response = await creatorsApi.register({
        email: formData.email,
        name: formData.name,
        username: formData.username,
        socialPlatform: formData.socialPlatform || undefined,
        socialUrl: formData.socialUrl || undefined,
        socialFollowers: formData.socialFollowers ? parseInt(formData.socialFollowers) : undefined,
      });

      setSuccess({
        promoCode: response.data.promoCode,
        creatorName: response.data.creator.name,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Registration failed. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const copyPromoCode = async () => {
    if (success?.promoCode) {
      await navigator.clipboard.writeText(success.promoCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  // Success state
  if (success) {
    return (
      <section className="py-20">
        <div className="max-w-[500px] mx-auto px-6">
          <div className="bg-[var(--card-background)] border border-[var(--border)] rounded-2xl p-8 text-center">
            <div className="w-16 h-16 bg-green-500/20 rounded-full flex items-center justify-center mx-auto mb-6">
              <CheckCircle className="w-8 h-8 text-green-500" />
            </div>

            <h1 className="text-2xl font-bold mb-2">Welcome to the Creator Program!</h1>
            <p className="text-[var(--text-muted)] mb-8">
              Hi {success.creatorName}, your creator account is now active.
            </p>

            <div className="bg-[var(--background)] border border-[var(--border)] rounded-xl p-6 mb-6">
              <p className="text-sm text-[var(--text-muted)] mb-2">Your Promo Code</p>
              <div className="flex items-center justify-center gap-3">
                <code className="text-2xl font-bold text-[var(--accent-purple-light)]">
                  {success.promoCode}
                </code>
                <button
                  onClick={copyPromoCode}
                  className="p-2 hover:bg-[var(--card-background)] rounded-lg transition"
                  title="Copy code"
                >
                  {copied ? (
                    <Check className="w-5 h-5 text-green-500" />
                  ) : (
                    <Copy className="w-5 h-5 text-[var(--text-muted)]" />
                  )}
                </button>
              </div>
            </div>

            <div className="space-y-4 text-left mb-8">
              <h3 className="font-semibold text-center">What&apos;s Next?</h3>
              <div className="space-y-3 text-sm">
                <div className="flex gap-3">
                  <span className="text-[var(--accent-purple-light)]">1.</span>
                  <p className="text-[var(--text-muted)]">
                    Share your promo code with your audience
                  </p>
                </div>
                <div className="flex gap-3">
                  <span className="text-[var(--accent-purple-light)]">2.</span>
                  <p className="text-[var(--text-muted)]">
                    Download Scribe AI and sign in to get free premium access
                  </p>
                </div>
                <div className="flex gap-3">
                  <span className="text-[var(--accent-purple-light)]">3.</span>
                  <p className="text-[var(--text-muted)]">
                    Earn 25% of revenue from every subscription you refer
                  </p>
                </div>
              </div>
            </div>

            <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-4 mb-6">
              <p className="text-sm text-amber-200">
                <strong>Note:</strong> You have 30 days of free premium access. After that, you&apos;ll need at least 1 conversion to maintain your premium status.
              </p>
            </div>

            <div className="flex gap-3">
              <a
                href="https://apps.apple.com/app/scribe-ai-study-assistant/id6744385829"
                target="_blank"
                rel="noopener noreferrer"
                className="flex-1 btn-secondary text-center"
              >
                iOS App
              </a>
              <a
                href="https://play.google.com/store/apps/details?id=com.kreativekoala.scribeai"
                target="_blank"
                rel="noopener noreferrer"
                className="flex-1 btn-secondary text-center"
              >
                Android App
              </a>
            </div>

            <p className="text-xs text-[var(--text-muted)] mt-6">
              Questions? Contact us at{' '}
              <a href="mailto:creators@scribeai.online" className="text-[var(--accent-purple-light)] hover:underline">
                creators@scribeai.online
              </a>
            </p>
          </div>
        </div>
      </section>
    );
  }

  return (
    <>
      {/* Hero */}
      <section className="text-center py-16">
        <div className="max-w-[900px] mx-auto px-6">
          <h1 className="text-3xl md:text-4xl font-bold mb-4">Join the Creator Program</h1>
          <p className="text-lg text-[var(--text-muted)] max-w-[500px] mx-auto">
            Get your unique promo code and start earning today.
          </p>
        </div>
      </section>

      {/* Registration Form */}
      <section className="pb-20">
        <div className="max-w-[500px] mx-auto px-6">
          <div className="bg-[var(--card-background)] border border-[var(--border)] rounded-2xl p-8">
            <form onSubmit={handleSubmit} className="space-y-5">
              {/* Name */}
              <div>
                <label htmlFor="name" className="block text-sm font-medium mb-2">
                  Full Name *
                </label>
                <input
                  type="text"
                  id="name"
                  name="name"
                  value={formData.name}
                  onChange={handleChange}
                  required
                  placeholder="John Smith"
                  className="w-full px-4 py-3 bg-[var(--background)] border border-[var(--border)] rounded-lg focus:outline-none focus:border-[var(--accent-purple)]"
                />
              </div>

              {/* Email */}
              <div>
                <label htmlFor="email" className="block text-sm font-medium mb-2">
                  Email Address *
                </label>
                <input
                  type="email"
                  id="email"
                  name="email"
                  value={formData.email}
                  onChange={handleChange}
                  required
                  placeholder="john@example.com"
                  className="w-full px-4 py-3 bg-[var(--background)] border border-[var(--border)] rounded-lg focus:outline-none focus:border-[var(--accent-purple)]"
                />
              </div>

              {/* Username */}
              <div>
                <label htmlFor="username" className="block text-sm font-medium mb-2">
                  Username *
                </label>
                <input
                  type="text"
                  id="username"
                  name="username"
                  value={formData.username}
                  onChange={handleChange}
                  required
                  placeholder="johnsmith"
                  pattern="^[a-zA-Z0-9_]{3,20}$"
                  title="3-20 characters, letters, numbers, and underscores only"
                  className="w-full px-4 py-3 bg-[var(--background)] border border-[var(--border)] rounded-lg focus:outline-none focus:border-[var(--accent-purple)]"
                />
                <p className="text-xs text-[var(--text-muted)] mt-1">
                  Used for your promo code (e.g., SCRIBEAI-JOH)
                </p>
              </div>

              {/* Social Platform */}
              <div>
                <label htmlFor="socialPlatform" className="block text-sm font-medium mb-2">
                  Primary Platform
                </label>
                <select
                  id="socialPlatform"
                  name="socialPlatform"
                  value={formData.socialPlatform}
                  onChange={handleChange}
                  className="w-full px-4 py-3 bg-[var(--background)] border border-[var(--border)] rounded-lg focus:outline-none focus:border-[var(--accent-purple)]"
                >
                  <option value="">Select a platform</option>
                  {SOCIAL_PLATFORMS.map(p => (
                    <option key={p.value} value={p.value}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </div>

              {/* Social URL */}
              <div>
                <label htmlFor="socialUrl" className="block text-sm font-medium mb-2">
                  Profile URL
                </label>
                <input
                  type="url"
                  id="socialUrl"
                  name="socialUrl"
                  value={formData.socialUrl}
                  onChange={handleChange}
                  placeholder="https://youtube.com/@yourchannel"
                  className="w-full px-4 py-3 bg-[var(--background)] border border-[var(--border)] rounded-lg focus:outline-none focus:border-[var(--accent-purple)]"
                />
              </div>

              {/* Followers */}
              <div>
                <label htmlFor="socialFollowers" className="block text-sm font-medium mb-2">
                  Approximate Followers
                </label>
                <input
                  type="number"
                  id="socialFollowers"
                  name="socialFollowers"
                  value={formData.socialFollowers}
                  onChange={handleChange}
                  placeholder="10000"
                  min="0"
                  className="w-full px-4 py-3 bg-[var(--background)] border border-[var(--border)] rounded-lg focus:outline-none focus:border-[var(--accent-purple)]"
                />
              </div>

              {error && (
                <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4">
                  <p className="text-sm text-red-400">{error}</p>
                </div>
              )}

              <button
                type="submit"
                disabled={isLoading}
                className="w-full btn-primary flex items-center justify-center gap-2"
              >
                {isLoading ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    Creating Account...
                  </>
                ) : (
                  'Get My Promo Code'
                )}
              </button>
            </form>

            <p className="text-xs text-[var(--text-muted)] text-center mt-6">
              By registering, you agree to the{' '}
              <Link href="/referral-terms" className="text-[var(--accent-purple-light)] hover:underline">
                Creator Program Terms
              </Link>
            </p>
          </div>

          {/* Benefits reminder */}
          <div className="mt-8 grid grid-cols-2 gap-4">
            <div className="bg-[var(--card-background)] border border-[var(--border)] rounded-xl p-4 text-center">
              <div className="text-2xl mb-2">25%</div>
              <p className="text-xs text-[var(--text-muted)]">Revenue Share</p>
            </div>
            <div className="bg-[var(--card-background)] border border-[var(--border)] rounded-xl p-4 text-center">
              <div className="text-2xl mb-2">$50</div>
              <p className="text-xs text-[var(--text-muted)]">Min. Payout</p>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
