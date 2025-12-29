'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/store/authStore';
import { creatorsApi } from '@/lib/api';
import { Loader2, CreditCard, AlertCircle, Calendar, DollarSign } from 'lucide-react';

interface Payout {
  id: string;
  amount: number;
  currency: string;
  status: string;
  periodStart: string;
  periodEnd: string;
  initiatedAt: string | null;
  completedAt: string | null;
  createdAt: string;
}

export default function PayoutsPage() {
  const router = useRouter();
  const { token, isAuthenticated } = useAuthStore();
  const [payouts, setPayouts] = useState<Payout[]>([]);
  const [pendingBalance, setPendingBalance] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!isAuthenticated) {
      router.push('/login');
      return;
    }
    loadPayouts();
  }, [isAuthenticated, router, token]);

  const loadPayouts = async () => {
    if (!token) return;

    try {
      setIsLoading(true);
      const [payoutsRes, dashboardRes] = await Promise.all([
        creatorsApi.getPayouts(token),
        creatorsApi.getDashboard(token),
      ]);
      setPayouts(payoutsRes.data as Payout[]);
      setPendingBalance(dashboardRes.data.pendingEarnings);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load payouts');
    } finally {
      setIsLoading(false);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'completed':
        return 'bg-green-500/20 text-green-500';
      case 'processing':
        return 'bg-blue-500/20 text-blue-500';
      case 'pending':
        return 'bg-yellow-500/20 text-yellow-500';
      case 'failed':
        return 'bg-red-500/20 text-red-500';
      default:
        return 'bg-gray-500/20 text-gray-500';
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
        <h1 className="text-2xl font-bold">Payouts</h1>
        <p className="text-[var(--text-muted)]">Track your payout history</p>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4 flex items-center gap-3">
          <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0" />
          <p className="text-sm text-red-400">{error}</p>
        </div>
      )}

      {/* Pending Balance */}
      <div className="bg-[var(--card-background)] border border-[var(--border)] rounded-xl p-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-[var(--text-muted)] mb-1">Pending Balance</p>
            <p className="text-3xl font-bold">${pendingBalance.toFixed(2)}</p>
            <p className="text-xs text-[var(--text-muted)] mt-2">
              Minimum payout: $50.00
            </p>
          </div>
          <div className="w-16 h-16 rounded-xl bg-[var(--accent-purple)]/20 flex items-center justify-center">
            <DollarSign className="w-8 h-8 text-[var(--accent-purple)]" />
          </div>
        </div>
        {pendingBalance >= 50 ? (
          <div className="mt-4 bg-green-500/10 border border-green-500/30 rounded-lg p-3">
            <p className="text-sm text-green-400">
              Your balance exceeds $50. You will receive a payout in the next monthly cycle.
            </p>
          </div>
        ) : (
          <div className="mt-4 bg-[var(--background)] border border-[var(--border)] rounded-lg p-3">
            <p className="text-sm text-[var(--text-muted)]">
              ${(50 - pendingBalance).toFixed(2)} more needed to reach minimum payout threshold.
            </p>
          </div>
        )}
      </div>

      {/* Payout Schedule Info */}
      <div className="bg-[var(--card-background)] border border-[var(--border)] rounded-xl p-6">
        <h3 className="font-semibold mb-3 flex items-center gap-2">
          <Calendar size={18} />
          Payout Schedule
        </h3>
        <div className="space-y-3 text-sm text-[var(--text-muted)]">
          <p>Payouts are processed monthly on the 1st of each month for earnings from the previous month.</p>
          <p>Payouts are sent via Stripe Connect to your connected bank account or debit card.</p>
        </div>
      </div>

      {/* Payouts Table */}
      <div className="bg-[var(--card-background)] border border-[var(--border)] rounded-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-[var(--border)]">
          <h3 className="font-semibold">Payout History</h3>
        </div>
        {payouts.length === 0 ? (
          <div className="p-12 text-center">
            <CreditCard className="w-12 h-12 text-[var(--text-muted)] mx-auto mb-4" />
            <h3 className="text-lg font-semibold mb-2">No Payouts Yet</h3>
            <p className="text-[var(--text-muted)]">
              Your payout history will appear here once you receive your first payment.
            </p>
          </div>
        ) : (
          <table className="w-full">
            <thead className="bg-[var(--background)] border-b border-[var(--border)]">
              <tr>
                <th className="text-left px-6 py-3 text-sm font-medium text-[var(--text-muted)]">Period</th>
                <th className="text-left px-6 py-3 text-sm font-medium text-[var(--text-muted)]">Amount</th>
                <th className="text-left px-6 py-3 text-sm font-medium text-[var(--text-muted)]">Status</th>
                <th className="text-left px-6 py-3 text-sm font-medium text-[var(--text-muted)]">Completed</th>
              </tr>
            </thead>
            <tbody>
              {payouts.map(payout => (
                <tr key={payout.id} className="border-b border-[var(--border)] last:border-0">
                  <td className="px-6 py-4 text-sm">
                    {new Date(payout.periodStart).toLocaleDateString()} - {new Date(payout.periodEnd).toLocaleDateString()}
                  </td>
                  <td className="px-6 py-4 text-sm font-medium">
                    ${payout.amount.toFixed(2)} {payout.currency}
                  </td>
                  <td className="px-6 py-4">
                    <span className={`text-xs px-2 py-1 rounded-full ${getStatusColor(payout.status)}`}>
                      {payout.status}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-sm text-[var(--text-muted)]">
                    {payout.completedAt
                      ? new Date(payout.completedAt).toLocaleDateString()
                      : '-'
                    }
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
