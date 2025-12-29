'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuthStore } from '@/store/authStore';
import { creatorsApi } from '@/lib/api';
import { Loader2, TrendingUp, Users, DollarSign, Tag, Copy, Check, AlertCircle } from 'lucide-react';

interface DashboardData {
  totalEarnings: number;
  pendingEarnings: number;
  thisMonthEarnings: number;
  conversions: number;
  clicks: number;
  conversionRate: number;
  promoCodes: Array<{
    id: string;
    code: string;
    isActive: boolean;
    currentRedemptions: number;
  }>;
}

export default function CreatorDashboardPage() {
  const router = useRouter();
  const { token, isAuthenticated } = useAuthStore();
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [copiedCode, setCopiedCode] = useState<string | null>(null);

  useEffect(() => {
    if (!isAuthenticated) {
      router.push('/login');
      return;
    }

    loadDashboard();
  }, [isAuthenticated, router, token]);

  const loadDashboard = async () => {
    if (!token) return;

    try {
      setIsLoading(true);
      setError('');

      // First try to login as creator (links account if needed)
      await creatorsApi.login(token);

      // Then get dashboard data
      const response = await creatorsApi.getDashboard(token);
      setDashboard(response.data as DashboardData);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load dashboard';
      if (message.includes('not registered') || message.includes('No creator account')) {
        // User is not a creator, redirect to registration
        router.push('/creators/register');
        return;
      }
      setError(message);
    } finally {
      setIsLoading(false);
    }
  };

  const copyCode = async (code: string) => {
    await navigator.clipboard.writeText(code);
    setCopiedCode(code);
    setTimeout(() => setCopiedCode(null), 2000);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-[var(--accent-purple)]" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-6 text-center">
        <AlertCircle className="w-8 h-8 text-red-500 mx-auto mb-3" />
        <p className="text-red-400 mb-4">{error}</p>
        <button onClick={loadDashboard} className="btn-secondary">
          Try Again
        </button>
      </div>
    );
  }

  if (!dashboard) {
    return null;
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <p className="text-[var(--text-muted)]">Track your performance and earnings</p>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-[var(--card-background)] border border-[var(--border)] rounded-xl p-5">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-lg bg-green-500/20 flex items-center justify-center">
              <DollarSign className="w-5 h-5 text-green-500" />
            </div>
            <span className="text-sm text-[var(--text-muted)]">Total Earnings</span>
          </div>
          <p className="text-2xl font-bold">${dashboard.totalEarnings.toFixed(2)}</p>
        </div>

        <div className="bg-[var(--card-background)] border border-[var(--border)] rounded-xl p-5">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-lg bg-yellow-500/20 flex items-center justify-center">
              <TrendingUp className="w-5 h-5 text-yellow-500" />
            </div>
            <span className="text-sm text-[var(--text-muted)]">This Month</span>
          </div>
          <p className="text-2xl font-bold">${dashboard.thisMonthEarnings.toFixed(2)}</p>
        </div>

        <div className="bg-[var(--card-background)] border border-[var(--border)] rounded-xl p-5">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-lg bg-blue-500/20 flex items-center justify-center">
              <Users className="w-5 h-5 text-blue-500" />
            </div>
            <span className="text-sm text-[var(--text-muted)]">Conversions</span>
          </div>
          <p className="text-2xl font-bold">{dashboard.conversions}</p>
        </div>

        <div className="bg-[var(--card-background)] border border-[var(--border)] rounded-xl p-5">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-lg bg-purple-500/20 flex items-center justify-center">
              <DollarSign className="w-5 h-5 text-purple-500" />
            </div>
            <span className="text-sm text-[var(--text-muted)]">Pending</span>
          </div>
          <p className="text-2xl font-bold">${dashboard.pendingEarnings.toFixed(2)}</p>
        </div>
      </div>

      {/* Promo Codes Section */}
      <div className="bg-[var(--card-background)] border border-[var(--border)] rounded-xl p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Tag size={20} />
            Your Promo Codes
          </h2>
          <Link href="/creator/codes" className="text-sm text-[var(--accent-purple-light)] hover:underline">
            Manage Codes
          </Link>
        </div>

        {dashboard.promoCodes.length === 0 ? (
          <p className="text-[var(--text-muted)] text-sm">No promo codes yet.</p>
        ) : (
          <div className="space-y-3">
            {dashboard.promoCodes.slice(0, 3).map(code => (
              <div
                key={code.id}
                className="flex items-center justify-between bg-[var(--background)] border border-[var(--border)] rounded-lg p-4"
              >
                <div className="flex items-center gap-3">
                  <code className="text-lg font-mono text-[var(--accent-purple-light)]">
                    {code.code}
                  </code>
                  <span className={`text-xs px-2 py-1 rounded-full ${
                    code.isActive
                      ? 'bg-green-500/20 text-green-500'
                      : 'bg-gray-500/20 text-gray-500'
                  }`}>
                    {code.isActive ? 'Active' : 'Inactive'}
                  </span>
                </div>
                <div className="flex items-center gap-4">
                  <span className="text-sm text-[var(--text-muted)]">
                    {code.currentRedemptions} uses
                  </span>
                  <button
                    onClick={() => copyCode(code.code)}
                    className="p-2 hover:bg-[var(--card-background)] rounded-lg transition"
                    title="Copy code"
                  >
                    {copiedCode === code.code ? (
                      <Check className="w-4 h-4 text-green-500" />
                    ) : (
                      <Copy className="w-4 h-4 text-[var(--text-muted)]" />
                    )}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Quick Links */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Link
          href="/creator/earnings"
          className="bg-[var(--card-background)] border border-[var(--border)] rounded-xl p-5 hover:border-[var(--accent-purple)] transition"
        >
          <h3 className="font-semibold mb-2">Earnings History</h3>
          <p className="text-sm text-[var(--text-muted)]">View detailed earnings breakdown and maturity status</p>
        </Link>
        <Link
          href="/creator/payouts"
          className="bg-[var(--card-background)] border border-[var(--border)] rounded-xl p-5 hover:border-[var(--accent-purple)] transition"
        >
          <h3 className="font-semibold mb-2">Payouts</h3>
          <p className="text-sm text-[var(--text-muted)]">View payout history and next payout estimate</p>
        </Link>
      </div>

      {/* Program Info Card */}
      <div className="bg-[var(--card-background)] border border-[var(--border)] rounded-xl p-6">
        <h3 className="font-semibold mb-4">Program Details</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-sm">
          <div>
            <h4 className="text-[var(--text-muted)] mb-2">How Earnings Work</h4>
            <ul className="space-y-1.5 text-[var(--text-muted)]">
              <li className="flex items-start gap-2">
                <span className="text-green-500 mt-0.5">•</span>
                <span>25% of net revenue (after app store fees)</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-green-500 mt-0.5">•</span>
                <span>45-day holding period before payout eligibility</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-green-500 mt-0.5">•</span>
                <span>$50 minimum threshold for payouts</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-green-500 mt-0.5">•</span>
                <span>Monthly payouts on the 1st via Stripe</span>
              </li>
            </ul>
          </div>
          <div>
            <h4 className="text-[var(--text-muted)] mb-2">Stay Active</h4>
            <ul className="space-y-1.5 text-[var(--text-muted)]">
              <li className="flex items-start gap-2">
                <span className="text-green-500 mt-0.5">•</span>
                <span>Keep free premium with 1+ paid referral per 90 days</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-green-500 mt-0.5">•</span>
                <span>Or submit 2+ content pieces per 90 days</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-green-500 mt-0.5">•</span>
                <span>Or generate 10+ signups per 90 days</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-green-500 mt-0.5">•</span>
                <span>We&apos;ll warn you before any changes</span>
              </li>
            </ul>
          </div>
        </div>
      </div>

      {/* Quick Tips */}
      <div className="bg-[var(--accent-purple)]/10 border border-[var(--accent-purple)]/30 rounded-xl p-6">
        <h3 className="font-semibold mb-3">Tips for Success</h3>
        <ul className="space-y-2 text-sm text-[var(--text-muted)]">
          <li>Share your promo code in your video descriptions and social media bios</li>
          <li>Create honest reviews showing how Scribe AI helps with studying</li>
          <li>Remind your audience about the code when discussing learning or productivity</li>
          <li>Complete Stripe onboarding in Settings to enable payouts</li>
        </ul>
      </div>
    </div>
  );
}
