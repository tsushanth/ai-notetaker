'use client';

import { useState, useEffect, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { useAuthStore } from '@/store/authStore';
import { subscriptionApi } from '@/lib/api';

const plans = [
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

function SubscriptionContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { user, token, isLoading: authLoading, isAuthenticated } = useAuthStore();

  const [selectedPlan, setSelectedPlan] = useState<string>('yearly');
  const [isCheckingOut, setIsCheckingOut] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Check for plan in URL params
  useEffect(() => {
    const planParam = searchParams.get('plan');
    if (planParam && ['yearly', 'monthly'].includes(planParam)) {
      setSelectedPlan(planParam);
    }
  }, [searchParams]);

  const handleSelectPlan = async (planId: string) => {
    setSelectedPlan(planId);

    // If not logged in, redirect to auth
    if (!isAuthenticated || !token) {
      const returnUrl = `/subscription?plan=${planId}`;
      router.push(`/auth?returnTo=${encodeURIComponent(returnUrl)}`);
      return;
    }

    // Start checkout
    await startCheckout(planId);
  };

  const startCheckout = async (planId: string) => {
    if (!token) return;

    setIsCheckingOut(true);
    setError(null);

    try {
      const response = await subscriptionApi.createCheckout(
        token,
        planId as 'monthly' | 'yearly'
      );

      if (response.success && response.data.url) {
        // Redirect to Stripe checkout
        window.location.href = response.data.url;
      } else {
        throw new Error('Failed to create checkout session');
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to start checkout';
      setError(message);
      setIsCheckingOut(false);
    }
  };

  // Auto-checkout if returning from auth with plan
  useEffect(() => {
    const planParam = searchParams.get('plan');
    if (planParam && isAuthenticated && token && !authLoading && !isCheckingOut) {
      startCheckout(planParam);
    }
  }, [isAuthenticated, token, authLoading, searchParams]);

  return (
    <div className="max-w-lg mx-auto px-4 py-8">
      {/* Header */}
      <div className="text-center mb-8">
        <h1 className="text-2xl font-bold text-gray-900 mb-2">
          Unlock ScribeAI Premium
        </h1>
        <p className="text-gray-600 text-sm">
          Save 30% compared to App Store prices
        </p>
      </div>

      {/* Plans */}
      <div className="space-y-3 mb-8">
        {plans.map((plan) => (
          <button
            key={plan.id}
            onClick={() => handleSelectPlan(plan.id)}
            disabled={isCheckingOut}
            className={`w-full text-left p-4 rounded-xl border-2 transition-all disabled:opacity-50 relative ${
              selectedPlan === plan.id
                ? 'border-purple-500 bg-purple-50'
                : 'border-gray-200 hover:border-purple-300'
            }`}
          >
            {plan.badge && (
              <span className="absolute -top-2.5 left-4 bg-orange-500 text-white text-xs font-bold px-2 py-0.5 rounded">
                {plan.badge}
              </span>
            )}

            <div className="flex items-center justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-gray-900">{plan.name}</span>
                  {plan.trial && (
                    <span className="text-xs text-green-600 font-medium">
                      {plan.trial}
                    </span>
                  )}
                </div>
                <div className="text-xs text-gray-500 mt-0.5">
                  <span className="line-through">{plan.appStorePrice}</span>
                  <span className="text-green-600 ml-1 font-medium">Save 30%</span>
                </div>
              </div>

              <div className="text-right">
                <div className="font-bold text-gray-900">
                  {plan.price}
                  <span className="text-sm font-normal text-gray-500">{plan.period}</span>
                </div>
                <div className="text-xs text-purple-600 font-medium">
                  {plan.perWeek}
                </div>
              </div>
            </div>
          </button>
        ))}
      </div>

      {/* Features */}
      <div className="bg-gray-50 rounded-xl p-4 mb-6">
        <p className="font-medium text-gray-900 text-sm mb-3">All plans include:</p>
        <div className="grid grid-cols-1 gap-2">
          {[
            'Unlimited notebooks',
            'AI summaries & formatting',
            'Quizzes & flashcards',
            'Audio podcasts from notes',
            'AI chat assistant',
            'Cloud sync across devices',
          ].map((feature) => (
            <div key={feature} className="flex items-center gap-2 text-sm text-gray-700">
              <svg className="w-4 h-4 text-green-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              {feature}
            </div>
          ))}
        </div>
      </div>

      {/* Error message */}
      {error && (
        <div className="mb-4 p-3 rounded-lg bg-red-50 text-red-600 text-sm">
          {error}
        </div>
      )}

      {/* Loading indicator */}
      {(isCheckingOut || authLoading) && (
        <div className="flex items-center justify-center gap-2 text-purple-600 mb-4">
          <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
          <span className="text-sm">
            {authLoading ? 'Loading...' : 'Redirecting to checkout...'}
          </span>
        </div>
      )}

      {/* CTA Button */}
      <button
        onClick={() => handleSelectPlan(selectedPlan)}
        disabled={isCheckingOut || authLoading}
        className="w-full py-4 px-6 bg-purple-600 text-white font-semibold rounded-xl hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        {isCheckingOut ? 'Processing...' : `Continue with ${selectedPlan === 'yearly' ? 'Annual' : 'Monthly'}`}
      </button>

      {/* Footer */}
      <div className="text-center text-xs text-gray-500 mt-6 space-y-1">
        <p>Secure payment powered by Stripe</p>
        <p>Cancel anytime. No commitment.</p>
        <div className="flex items-center justify-center gap-3 pt-2">
          <a href="https://scribeai.online/terms" className="hover:text-gray-700">Terms</a>
          <span>·</span>
          <a href="https://scribeai.online/privacy" className="hover:text-gray-700">Privacy</a>
        </div>
      </div>
    </div>
  );
}

export default function SubscriptionPage() {
  return (
    <Suspense fallback={
      <div className="max-w-lg mx-auto px-4 py-8 text-center">
        <div className="animate-pulse">Loading...</div>
      </div>
    }>
      <SubscriptionContent />
    </Suspense>
  );
}
