'use client';

import { useState, useEffect, Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { ArrowLeft, Globe, Check, Crown, Loader2, AlertCircle, CheckCircle, CreditCard, Tag } from 'lucide-react';
import { useSettingsStore, SUPPORTED_LANGUAGES, type LanguageCode } from '@/store/settingsStore';
import { useAuthStore } from '@/store/authStore';
import { subscriptionApi, creatorsApi } from '@/lib/api';

interface SubscriptionAccess {
  hasAccess: boolean;
  isSubscribed: boolean;
  isInTrial: boolean;
  reason: string;
  trialDaysRemaining: number;
  trialExpiresAt: string | null;
  trialExpired: boolean;
  productId: string | null;
  expiresAt: string | null;
  platform?: string;
  features: {
    canCreateNotes: boolean;
    canUseAI: boolean;
    canGeneratePodcasts: boolean;
    unlimitedAccess: boolean;
  };
}

interface Plan {
  id: string;
  name: string;
  description: string;
  amount: number;
  currency: string;
  interval: string;
}

// Fallback plans when Stripe prices can't be fetched
const FALLBACK_PLANS: Plan[] = [
  {
    id: 'price_1Sjv7yKFBTQTkmzt9HufgzeR',
    name: 'Monthly',
    description: 'Billed monthly',
    amount: 999,
    currency: 'usd',
    interval: 'month',
  },
  {
    id: 'price_1Sjv8UKFBTQTkmztT2AC3ae9',
    name: 'Yearly',
    description: 'Save 50% - Billed yearly',
    amount: 2999,
    currency: 'usd',
    interval: 'year',
  },
];

// Wrapper component to handle useSearchParams
function SettingsContent() {
  const searchParams = useSearchParams();
  const { language, setLanguage } = useSettingsStore();
  const { token } = useAuthStore();
  const [searchQuery, setSearchQuery] = useState('');

  // Subscription state
  const [subscription, setSubscription] = useState<SubscriptionAccess | null>(null);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [isLoadingSubscription, setIsLoadingSubscription] = useState(true);
  const [isLoadingCheckout, setIsLoadingCheckout] = useState(false);
  const [subscriptionMessage, setSubscriptionMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Promo code state
  const [promoCode, setPromoCode] = useState('');
  const [isApplyingPromo, setIsApplyingPromo] = useState(false);
  const [appliedPromo, setAppliedPromo] = useState<{
    code: string;
    creatorName: string;
    trialExtensionDays: number;
  } | null>(null);
  const [promoError, setPromoError] = useState('');

  // Check for subscription result from URL
  useEffect(() => {
    const result = searchParams.get('subscription');
    if (result === 'success') {
      setSubscriptionMessage({ type: 'success', text: 'Subscription activated successfully!' });
      // Clear the URL param
      window.history.replaceState({}, '', '/settings');
    } else if (result === 'cancelled') {
      setSubscriptionMessage({ type: 'error', text: 'Checkout was cancelled.' });
      window.history.replaceState({}, '', '/settings');
    }
  }, [searchParams]);

  // Fetch subscription status and any existing promo code
  useEffect(() => {
    const fetchSubscription = async () => {
      if (!token) {
        setIsLoadingSubscription(false);
        return;
      }

      try {
        console.log('[Settings] Fetching subscription status...');
        const [accessResponse, pricesResponse, currentCodeResponse] = await Promise.all([
          subscriptionApi.getAccess(token),
          subscriptionApi.getPrices(),
          creatorsApi.getCurrentCode(token),
        ]);

        console.log('[Settings] Access response:', accessResponse);
        console.log('[Settings] Prices response:', pricesResponse);
        console.log('[Settings] Current code response:', currentCodeResponse);

        if (accessResponse.success) {
          setSubscription(accessResponse.data);
        }

        if (pricesResponse.success && pricesResponse.data.length > 0) {
          setPlans(pricesResponse.data);
        } else {
          // Use fallback plans if Stripe prices couldn't be fetched
          console.log('[Settings] Using fallback plans');
          setPlans(FALLBACK_PLANS);
        }

        // If user has an existing promo code applied, show it
        if (currentCodeResponse.success && currentCodeResponse.data) {
          const codeData = currentCodeResponse.data;
          setAppliedPromo({
            code: codeData.code,
            creatorName: codeData.creatorName,
            trialExtensionDays: codeData.trialExtensionDays || 0,
          });
        }
      } catch (error) {
        console.error('[Settings] Failed to fetch subscription:', error);
        // Use fallback plans on error
        setPlans(FALLBACK_PLANS);
      } finally {
        setIsLoadingSubscription(false);
      }
    };

    fetchSubscription();
  }, [token]);

  const handleSubscribe = async (priceId: string) => {
    if (!token) return;

    setIsLoadingCheckout(true);
    try {
      const response = await subscriptionApi.createCheckout(token, 'monthly', priceId);
      if (response.success && response.data.url) {
        window.location.href = response.data.url;
      }
    } catch (error) {
      console.error('Failed to create checkout:', error);
      setSubscriptionMessage({ type: 'error', text: 'Failed to start checkout. Please try again.' });
    } finally {
      setIsLoadingCheckout(false);
    }
  };

  const handleManageSubscription = async () => {
    if (!token) return;

    setIsLoadingCheckout(true);
    try {
      const response = await subscriptionApi.openPortal(token);
      if (response.success && response.data.url) {
        window.location.href = response.data.url;
      }
    } catch (error) {
      console.error('Failed to open portal:', error);
      setSubscriptionMessage({ type: 'error', text: 'Failed to open subscription management. Please try again.' });
    } finally {
      setIsLoadingCheckout(false);
    }
  };

  const handleApplyPromoCode = async () => {
    if (!token || !promoCode.trim()) return;

    setIsApplyingPromo(true);
    setPromoError('');

    try {
      // First validate the code
      const validateResponse = await creatorsApi.validatePromoCode(promoCode.trim(), token);

      if (!validateResponse.success || !validateResponse.data.valid) {
        setPromoError('Invalid promo code');
        return;
      }

      // Then apply it
      const applyResponse = await creatorsApi.applyPromoCode(token, promoCode.trim(), 'web');

      if (applyResponse.success) {
        setAppliedPromo({
          code: validateResponse.data.code,
          creatorName: validateResponse.data.creatorName,
          trialExtensionDays: validateResponse.data.trialExtensionDays,
        });
        setPromoCode('');
        setSubscriptionMessage({
          type: 'success',
          text: validateResponse.data.trialExtensionDays > 0
            ? `Promo code applied! Your trial has been extended by ${validateResponse.data.trialExtensionDays} days.`
            : 'Promo code applied!'
        });
      }
    } catch (error) {
      console.error('Failed to apply promo code:', error);
      setPromoError(error instanceof Error ? error.message : 'Failed to apply promo code');
    } finally {
      setIsApplyingPromo(false);
    }
  };

  // Filter languages based on search
  const filteredLanguages = SUPPORTED_LANGUAGES.filter(
    (lang) =>
      lang.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      lang.nativeName.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // Group languages by category
  const languageGroups = [
    {
      name: 'Major World Languages',
      languages: filteredLanguages.filter((l) =>
        ['english', 'spanish', 'french', 'german', 'portuguese', 'italian', 'chinese', 'chinese_traditional', 'japanese', 'korean'].includes(l.code)
      ),
    },
    {
      name: 'South Asian Languages',
      languages: filteredLanguages.filter((l) =>
        ['hindi', 'bengali', 'tamil', 'telugu', 'urdu', 'marathi', 'gujarati', 'punjabi'].includes(l.code)
      ),
    },
    {
      name: 'European Languages',
      languages: filteredLanguages.filter((l) =>
        ['dutch', 'polish', 'russian', 'ukrainian', 'swedish', 'norwegian', 'danish', 'finnish', 'greek', 'czech', 'romanian', 'hungarian'].includes(l.code)
      ),
    },
    {
      name: 'Middle Eastern & African Languages',
      languages: filteredLanguages.filter((l) =>
        ['arabic', 'hebrew', 'turkish', 'persian', 'swahili'].includes(l.code)
      ),
    },
    {
      name: 'Southeast Asian Languages',
      languages: filteredLanguages.filter((l) =>
        ['thai', 'vietnamese', 'indonesian', 'malay', 'tagalog'].includes(l.code)
      ),
    },
  ].filter((group) => group.languages.length > 0);

  const handleLanguageSelect = (langCode: LanguageCode) => {
    setLanguage(langCode);
  };

  const selectedLanguage = SUPPORTED_LANGUAGES.find((l) => l.code === language);

  const formatPrice = (amount: number, currency: string) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency.toUpperCase(),
    }).format(amount / 100);
  };

  return (
    <div className="max-w-2xl mx-auto px-6 py-8">
      {/* Header */}
      <div className="flex items-center gap-4 mb-8">
        <Link
          href="/notes"
          className="p-2 rounded-lg hover:bg-[var(--card-background)] transition"
        >
          <ArrowLeft size={20} />
        </Link>
        <h1 className="text-2xl font-bold">Settings</h1>
      </div>

      {/* Subscription Message */}
      {subscriptionMessage && (
        <div
          className={`mb-6 p-4 rounded-lg flex items-center gap-3 ${
            subscriptionMessage.type === 'success'
              ? 'bg-green-500/10 text-green-400 border border-green-500/20'
              : 'bg-red-500/10 text-red-400 border border-red-500/20'
          }`}
        >
          {subscriptionMessage.type === 'success' ? (
            <CheckCircle size={20} />
          ) : (
            <AlertCircle size={20} />
          )}
          <span>{subscriptionMessage.text}</span>
          <button
            onClick={() => setSubscriptionMessage(null)}
            className="ml-auto text-sm opacity-70 hover:opacity-100"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Subscription Section */}
      <div className="bg-[var(--card-background)] rounded-xl p-6 border border-[var(--border)] mb-6">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-full bg-[var(--accent-purple)]/20 flex items-center justify-center">
            <Crown className="text-[var(--accent-purple)]" size={20} />
          </div>
          <div>
            <h2 className="text-lg font-semibold">Subscription</h2>
            <p className="text-sm text-[var(--text-muted)]">
              Manage your Scribe AI subscription
            </p>
          </div>
        </div>

        {isLoadingSubscription ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-6 h-6 animate-spin text-[var(--accent-purple)]" />
          </div>
        ) : subscription ? (
          <div>
            {/* Current Status */}
            <div className="mb-6 p-4 bg-[var(--surface-variant)] rounded-lg">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm text-[var(--text-muted)]">Status</span>
                <span
                  className={`px-2 py-1 rounded text-xs font-medium ${
                    subscription.isSubscribed
                      ? 'bg-green-500/20 text-green-400'
                      : subscription.isInTrial
                      ? 'bg-blue-500/20 text-blue-400'
                      : 'bg-orange-500/20 text-orange-400'
                  }`}
                >
                  {subscription.isSubscribed
                    ? 'Premium'
                    : subscription.isInTrial
                    ? `Trial (${subscription.trialDaysRemaining} days left)`
                    : subscription.trialExpired
                    ? 'Trial Expired'
                    : 'Free'}
                </span>
              </div>

              {subscription.isSubscribed && subscription.expiresAt && (
                <div className="flex items-center justify-between">
                  <span className="text-sm text-[var(--text-muted)]">Renews</span>
                  <span className="text-sm">
                    {new Date(subscription.expiresAt).toLocaleDateString()}
                  </span>
                </div>
              )}

              {subscription.isInTrial && subscription.trialExpiresAt && (
                <div className="flex items-center justify-between">
                  <span className="text-sm text-[var(--text-muted)]">Trial ends</span>
                  <span className="text-sm">
                    {new Date(subscription.trialExpiresAt).toLocaleDateString()}
                  </span>
                </div>
              )}
            </div>

            {/* Features */}
            <div className="mb-6">
              <h3 className="text-sm font-medium text-[var(--text-muted)] mb-3">Your Features</h3>
              <div className="grid grid-cols-2 gap-3">
                <div className="flex items-center gap-2">
                  <div className={`w-5 h-5 rounded-full flex items-center justify-center ${
                    subscription.features.canCreateNotes ? 'bg-green-500/20' : 'bg-gray-500/20'
                  }`}>
                    <Check size={12} className={subscription.features.canCreateNotes ? 'text-green-400' : 'text-gray-400'} />
                  </div>
                  <span className="text-sm">Create Notes</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className={`w-5 h-5 rounded-full flex items-center justify-center ${
                    subscription.features.canUseAI ? 'bg-green-500/20' : 'bg-gray-500/20'
                  }`}>
                    <Check size={12} className={subscription.features.canUseAI ? 'text-green-400' : 'text-gray-400'} />
                  </div>
                  <span className="text-sm">AI Features</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className={`w-5 h-5 rounded-full flex items-center justify-center ${
                    subscription.features.canGeneratePodcasts ? 'bg-green-500/20' : 'bg-gray-500/20'
                  }`}>
                    <Check size={12} className={subscription.features.canGeneratePodcasts ? 'text-green-400' : 'text-gray-400'} />
                  </div>
                  <span className="text-sm">Podcasts</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className={`w-5 h-5 rounded-full flex items-center justify-center ${
                    subscription.features.unlimitedAccess ? 'bg-green-500/20' : 'bg-gray-500/20'
                  }`}>
                    <Check size={12} className={subscription.features.unlimitedAccess ? 'text-green-400' : 'text-gray-400'} />
                  </div>
                  <span className="text-sm">Unlimited</span>
                </div>
              </div>
            </div>

            {/* Promo Code Section - Only show if not subscribed */}
            {!subscription.isSubscribed && (
              <div className="mb-6">
                {appliedPromo ? (
                  <div className="p-4 bg-green-500/10 border border-green-500/30 rounded-lg">
                    <div className="flex items-center gap-2 mb-2">
                      <Tag size={16} className="text-green-500" />
                      <span className="font-medium text-green-400">Promo Code Applied</span>
                    </div>
                    <p className="text-sm text-[var(--text-muted)]">
                      Code: <span className="font-mono">{appliedPromo.code}</span>
                      {appliedPromo.creatorName && ` from ${appliedPromo.creatorName}`}
                    </p>
                    {appliedPromo.trialExtensionDays > 0 && (
                      <p className="text-sm text-green-400 mt-1">
                        Trial extended by {appliedPromo.trialExtensionDays} days!
                      </p>
                    )}
                  </div>
                ) : (
                  <div>
                    <div className="flex items-center gap-2 mb-3">
                      <Tag size={16} className="text-[var(--text-muted)]" />
                      <span className="text-sm font-medium text-[var(--text-muted)]">Have a promo code?</span>
                    </div>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        placeholder="Enter promo code"
                        value={promoCode}
                        onChange={(e) => {
                          setPromoCode(e.target.value.toUpperCase());
                          setPromoError('');
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            handleApplyPromoCode();
                          }
                        }}
                        className="flex-1 px-4 py-2 bg-[var(--surface-variant)] border border-[var(--border)] rounded-lg focus:outline-none focus:ring-2 focus:ring-[var(--accent-purple)] focus:border-transparent font-mono text-sm"
                      />
                      <button
                        onClick={handleApplyPromoCode}
                        disabled={isApplyingPromo || !promoCode.trim()}
                        className="px-4 py-2 bg-[var(--accent-purple)] text-white rounded-lg hover:bg-[var(--accent-purple-dark)] disabled:opacity-50 disabled:cursor-not-allowed transition flex items-center gap-2"
                      >
                        {isApplyingPromo ? (
                          <Loader2 size={16} className="animate-spin" />
                        ) : (
                          'Apply'
                        )}
                      </button>
                    </div>
                    {promoError && (
                      <p className="text-sm text-red-400 mt-2">{promoError}</p>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Subscribe or Manage */}
            {subscription.isSubscribed && subscription.platform === 'web' ? (
              <button
                onClick={handleManageSubscription}
                disabled={isLoadingCheckout}
                className="w-full flex items-center justify-center gap-2 py-3 px-4 rounded-lg border border-[var(--border)] hover:bg-[var(--surface-variant)] transition"
              >
                {isLoadingCheckout ? (
                  <Loader2 size={18} className="animate-spin" />
                ) : (
                  <CreditCard size={18} />
                )}
                Manage Subscription
              </button>
            ) : subscription.isSubscribed ? (
              <div className="text-center py-4 p-4 bg-[var(--surface-variant)] rounded-lg">
                <p className="text-sm text-[var(--text-muted)]">
                  Manage your subscription in the {subscription.platform === 'ios' ? 'App Store' : subscription.platform === 'android' ? 'Play Store' : 'app'} where you subscribed
                </p>
              </div>
            ) : (
              <div>
                {plans.length > 0 ? (
                  <div className="space-y-3">
                    <h3 className="text-sm font-medium text-[var(--text-muted)]">Upgrade to Premium</h3>
                    {plans.map((plan) => (
                      <button
                        key={plan.id}
                        onClick={() => handleSubscribe(plan.id)}
                        disabled={isLoadingCheckout}
                        className="w-full flex items-center justify-between p-4 rounded-lg border border-[var(--accent-purple)] bg-[var(--accent-purple)]/10 hover:bg-[var(--accent-purple)]/20 transition"
                      >
                        <div className="text-left">
                          <p className="font-medium">{plan.name}</p>
                          <p className="text-sm text-[var(--text-muted)]">
                            {formatPrice(plan.amount, plan.currency)}/{plan.interval}
                          </p>
                        </div>
                        {isLoadingCheckout ? (
                          <Loader2 size={18} className="animate-spin" />
                        ) : (
                          <Crown size={20} className="text-[var(--accent-purple)]" />
                        )}
                      </button>
                    ))}
                    <p className="text-xs text-[var(--text-muted)] text-center">
                      7-day free trial included
                    </p>
                  </div>
                ) : (
                  <div className="text-center py-4">
                    <p className="text-sm text-[var(--text-muted)] mb-3">
                      Subscribe on iOS or Android to unlock all features
                    </p>
                    <p className="text-xs text-[var(--text-muted)]">
                      Your subscription will sync automatically
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>
        ) : (
          <div className="text-center py-4 text-[var(--text-muted)]">
            Unable to load subscription status
          </div>
        )}
      </div>

      {/* Language Section */}
      <div className="bg-[var(--card-background)] rounded-xl p-6 border border-[var(--border)]">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-full bg-[var(--accent-purple)]/20 flex items-center justify-center">
            <Globe className="text-[var(--accent-purple)]" size={20} />
          </div>
          <div>
            <h2 className="text-lg font-semibold">AI Content Language</h2>
            <p className="text-sm text-[var(--text-muted)]">
              Choose the language for generated quizzes, flashcards, and chat responses
            </p>
          </div>
        </div>

        {/* Current Selection */}
        <div className="mb-6 p-4 bg-[var(--surface-variant)] rounded-lg">
          <p className="text-sm text-[var(--text-muted)] mb-1">Currently selected</p>
          <p className="font-medium">
            {selectedLanguage?.name} ({selectedLanguage?.nativeName})
          </p>
        </div>

        {/* Search */}
        <div className="mb-6">
          <input
            type="text"
            placeholder="Search languages..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full px-4 py-3 bg-[var(--surface-variant)] border border-[var(--border)] rounded-lg focus:outline-none focus:ring-2 focus:ring-[var(--accent-purple)] focus:border-transparent"
          />
        </div>

        {/* Language Groups */}
        <div className="space-y-6">
          {languageGroups.map((group) => (
            <div key={group.name}>
              <h3 className="text-sm font-medium text-[var(--text-muted)] mb-3">
                {group.name}
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {group.languages.map((lang) => (
                  <button
                    key={lang.code}
                    onClick={() => handleLanguageSelect(lang.code as LanguageCode)}
                    className={`flex items-center justify-between p-3 rounded-lg border transition ${
                      language === lang.code
                        ? 'border-[var(--accent-purple)] bg-[var(--accent-purple)]/10'
                        : 'border-[var(--border)] hover:border-[var(--accent-purple)]/50 hover:bg-[var(--surface-variant)]'
                    }`}
                  >
                    <div className="text-left">
                      <p className="font-medium">{lang.name}</p>
                      <p className="text-sm text-[var(--text-muted)]">{lang.nativeName}</p>
                    </div>
                    {language === lang.code && (
                      <Check className="text-[var(--accent-purple)]" size={20} />
                    )}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>

        {filteredLanguages.length === 0 && (
          <p className="text-center text-[var(--text-muted)] py-8">
            No languages found matching &quot;{searchQuery}&quot;
          </p>
        )}
      </div>
    </div>
  );
}

// Loading fallback for Suspense
function SettingsLoading() {
  return (
    <div className="max-w-2xl mx-auto px-6 py-8">
      <div className="flex items-center gap-4 mb-8">
        <div className="w-10 h-10 rounded-lg bg-[var(--card-background)] animate-pulse" />
        <div className="h-8 w-32 bg-[var(--card-background)] rounded animate-pulse" />
      </div>
      <div className="bg-[var(--card-background)] rounded-xl p-6 border border-[var(--border)] mb-6">
        <div className="flex items-center justify-center py-8">
          <Loader2 className="w-6 h-6 animate-spin text-[var(--accent-purple)]" />
        </div>
      </div>
    </div>
  );
}

// Main page component with Suspense boundary for useSearchParams
export default function SettingsPage() {
  return (
    <Suspense fallback={<SettingsLoading />}>
      <SettingsContent />
    </Suspense>
  );
}
