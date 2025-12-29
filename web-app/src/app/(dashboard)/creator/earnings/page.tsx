'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/store/authStore';
import { creatorsApi } from '@/lib/api';
import { Loader2, DollarSign, TrendingUp, AlertCircle } from 'lucide-react';

interface Earning {
  id: string;
  transactionType: string;
  grossAmount: number;
  platformFeePercent: number;
  platformFeeAmount: number;
  netRevenue: number;
  revenueSharePercent: number;
  creatorEarning: number;
  currency: string;
  status: string;
  createdAt: string;
}

interface EarningsSummary {
  totalEarnings: number;
  pendingEarnings: number;
  thisMonthEarnings: number;
  totalConversions: number;
}

export default function EarningsPage() {
  const router = useRouter();
  const { token, isAuthenticated } = useAuthStore();
  const [earnings, setEarnings] = useState<Earning[]>([]);
  const [summary, setSummary] = useState<EarningsSummary | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!isAuthenticated) {
      router.push('/login');
      return;
    }
    loadEarnings();
  }, [isAuthenticated, router, token]);

  const loadEarnings = async () => {
    if (!token) return;

    try {
      setIsLoading(true);
      const [earningsRes, dashboardRes] = await Promise.all([
        creatorsApi.getEarnings(token),
        creatorsApi.getDashboard(token),
      ]);
      setEarnings(earningsRes.data as Earning[]);
      setSummary({
        totalEarnings: dashboardRes.data.totalEarnings,
        pendingEarnings: dashboardRes.data.pendingEarnings,
        thisMonthEarnings: dashboardRes.data.thisMonthEarnings,
        totalConversions: dashboardRes.data.conversions,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load earnings');
    } finally {
      setIsLoading(false);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'paid':
        return 'bg-green-500/20 text-green-500';
      case 'approved':
        return 'bg-blue-500/20 text-blue-500';
      case 'pending':
        return 'bg-yellow-500/20 text-yellow-500';
      case 'cancelled':
        return 'bg-red-500/20 text-red-500';
      default:
        return 'bg-gray-500/20 text-gray-500';
    }
  };

  const formatTransactionType = (type: string) => {
    switch (type) {
      case 'subscription_new':
        return 'New Subscription';
      case 'subscription_renewal':
        return 'Renewal';
      case 'adjustment':
        return 'Adjustment';
      case 'clawback':
        return 'Refund/Clawback';
      default:
        return type;
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-[var(--accent-purple)]" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Earnings</h1>
        <p className="text-[var(--text-muted)]">Track your revenue and commissions</p>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4 flex items-center gap-3">
          <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0" />
          <p className="text-sm text-red-400">{error}</p>
        </div>
      )}

      {/* Summary Cards */}
      {summary && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-[var(--card-background)] border border-[var(--border)] rounded-xl p-5">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-lg bg-green-500/20 flex items-center justify-center">
                <DollarSign className="w-5 h-5 text-green-500" />
              </div>
              <span className="text-sm text-[var(--text-muted)]">Total Earned</span>
            </div>
            <p className="text-2xl font-bold">${summary.totalEarnings.toFixed(2)}</p>
          </div>

          <div className="bg-[var(--card-background)] border border-[var(--border)] rounded-xl p-5">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-lg bg-yellow-500/20 flex items-center justify-center">
                <TrendingUp className="w-5 h-5 text-yellow-500" />
              </div>
              <span className="text-sm text-[var(--text-muted)]">This Month</span>
            </div>
            <p className="text-2xl font-bold">${summary.thisMonthEarnings.toFixed(2)}</p>
          </div>

          <div className="bg-[var(--card-background)] border border-[var(--border)] rounded-xl p-5">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-lg bg-purple-500/20 flex items-center justify-center">
                <DollarSign className="w-5 h-5 text-purple-500" />
              </div>
              <span className="text-sm text-[var(--text-muted)]">Pending</span>
            </div>
            <p className="text-2xl font-bold">${summary.pendingEarnings.toFixed(2)}</p>
          </div>

          <div className="bg-[var(--card-background)] border border-[var(--border)] rounded-xl p-5">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-lg bg-blue-500/20 flex items-center justify-center">
                <TrendingUp className="w-5 h-5 text-blue-500" />
              </div>
              <span className="text-sm text-[var(--text-muted)]">Conversions</span>
            </div>
            <p className="text-2xl font-bold">{summary.totalConversions}</p>
          </div>
        </div>
      )}

      {/* How It Works */}
      <div className="bg-[var(--card-background)] border border-[var(--border)] rounded-xl p-6">
        <h3 className="font-semibold mb-3">How Earnings Work</h3>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 text-sm text-[var(--text-muted)]">
          <div>
            <span className="text-[var(--accent-purple-light)] font-medium">1. Subscription</span>
            <p>User subscribes using your promo code</p>
          </div>
          <div>
            <span className="text-[var(--accent-purple-light)] font-medium">2. App Store</span>
            <p>Apple/Google takes their cut (15-30%)</p>
          </div>
          <div>
            <span className="text-[var(--accent-purple-light)] font-medium">3. Your Share</span>
            <p>You get 25% of net after our platform fee (15%)</p>
          </div>
          <div>
            <span className="text-[var(--accent-purple-light)] font-medium">4. Payout</span>
            <p>Monthly when balance exceeds $50</p>
          </div>
        </div>
        <p className="text-xs text-[var(--text-muted)] mt-4 border-t border-[var(--border)] pt-3">
          Note: If you offer a discount, it&apos;s deducted from your share (your earnings are calculated on the discounted amount).
        </p>
      </div>

      {/* Earnings Table */}
      <div className="bg-[var(--card-background)] border border-[var(--border)] rounded-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-[var(--border)]">
          <h3 className="font-semibold">Transaction History</h3>
        </div>
        {earnings.length === 0 ? (
          <div className="p-12 text-center">
            <DollarSign className="w-12 h-12 text-[var(--text-muted)] mx-auto mb-4" />
            <h3 className="text-lg font-semibold mb-2">No Earnings Yet</h3>
            <p className="text-[var(--text-muted)]">
              Earnings will appear here when users subscribe with your promo codes.
            </p>
          </div>
        ) : (
          <table className="w-full">
            <thead className="bg-[var(--background)] border-b border-[var(--border)]">
              <tr>
                <th className="text-left px-6 py-3 text-sm font-medium text-[var(--text-muted)]">Date</th>
                <th className="text-left px-6 py-3 text-sm font-medium text-[var(--text-muted)]">Type</th>
                <th className="text-left px-6 py-3 text-sm font-medium text-[var(--text-muted)]">Gross</th>
                <th className="text-left px-6 py-3 text-sm font-medium text-[var(--text-muted)]">Your Share</th>
                <th className="text-left px-6 py-3 text-sm font-medium text-[var(--text-muted)]">Status</th>
              </tr>
            </thead>
            <tbody>
              {earnings.map(earning => (
                <tr key={earning.id} className="border-b border-[var(--border)] last:border-0">
                  <td className="px-6 py-4 text-sm">
                    {new Date(earning.createdAt).toLocaleDateString()}
                  </td>
                  <td className="px-6 py-4 text-sm">
                    {formatTransactionType(earning.transactionType)}
                  </td>
                  <td className="px-6 py-4 text-sm">
                    ${earning.grossAmount.toFixed(2)}
                  </td>
                  <td className="px-6 py-4 text-sm font-medium text-green-500">
                    ${earning.creatorEarning.toFixed(2)}
                  </td>
                  <td className="px-6 py-4">
                    <span className={`text-xs px-2 py-1 rounded-full ${getStatusColor(earning.status)}`}>
                      {earning.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
