'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/store/authStore';
import { creatorsApi } from '@/lib/api';
import { Loader2, Plus, Copy, Check, AlertCircle, Tag } from 'lucide-react';

interface PromoCode {
  id: string;
  code: string;
  isActive: boolean;
  discountType: string;
  discountValue: number;
  trialExtensionDays: number;
  validFrom: string;
  validUntil: string | null;
  maxRedemptions: number | null;
  currentRedemptions: number;
  createdAt: string;
}

export default function PromoCodesPage() {
  const router = useRouter();
  const { token, isAuthenticated } = useAuthStore();
  const [codes, setCodes] = useState<PromoCode[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [copiedCode, setCopiedCode] = useState<string | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [createForm, setCreateForm] = useState({
    discountType: 'none',
    discountValue: '',
    trialExtensionDays: '',
    maxRedemptions: '',
  });

  useEffect(() => {
    if (!isAuthenticated) {
      router.push('/login');
      return;
    }
    loadCodes();
  }, [isAuthenticated, router, token]);

  const loadCodes = async () => {
    if (!token) return;

    try {
      setIsLoading(true);
      const response = await creatorsApi.getPromoCodes(token);
      setCodes(response.data as PromoCode[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load promo codes');
    } finally {
      setIsLoading(false);
    }
  };

  const copyCode = async (code: string) => {
    await navigator.clipboard.writeText(code);
    setCopiedCode(code);
    setTimeout(() => setCopiedCode(null), 2000);
  };

  const handleCreateCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) return;

    try {
      setIsCreating(true);
      await creatorsApi.createPromoCode(token, {
        discountType: createForm.discountType,
        discountValue: createForm.discountValue ? parseFloat(createForm.discountValue) : 0,
        trialExtensionDays: createForm.trialExtensionDays ? parseInt(createForm.trialExtensionDays) : 0,
        maxRedemptions: createForm.maxRedemptions ? parseInt(createForm.maxRedemptions) : undefined,
      });
      setShowCreateModal(false);
      setCreateForm({ discountType: 'none', discountValue: '', trialExtensionDays: '', maxRedemptions: '' });
      loadCodes();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create promo code');
    } finally {
      setIsCreating(false);
    }
  };

  const formatDiscount = () => {
    // All promo codes now provide 10% off
    return '10% off first subscription';
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
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Promo Codes</h1>
          <p className="text-[var(--text-muted)]">Create and manage your promotional codes</p>
        </div>
        <button
          onClick={() => setShowCreateModal(true)}
          className="btn-primary flex items-center gap-2"
        >
          <Plus size={18} />
          New Code
        </button>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4 flex items-center gap-3">
          <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0" />
          <p className="text-sm text-red-400">{error}</p>
        </div>
      )}

      {codes.length === 0 ? (
        <div className="bg-[var(--card-background)] border border-[var(--border)] rounded-xl p-12 text-center">
          <Tag className="w-12 h-12 text-[var(--text-muted)] mx-auto mb-4" />
          <h3 className="text-lg font-semibold mb-2">No Promo Codes Yet</h3>
          <p className="text-[var(--text-muted)] mb-6">
            Create your first promo code to start sharing with your audience.
          </p>
          <button
            onClick={() => setShowCreateModal(true)}
            className="btn-primary"
          >
            Create Promo Code
          </button>
        </div>
      ) : (
        <div className="bg-[var(--card-background)] border border-[var(--border)] rounded-xl overflow-hidden">
          <table className="w-full">
            <thead className="bg-[var(--background)] border-b border-[var(--border)]">
              <tr>
                <th className="text-left px-6 py-4 text-sm font-medium text-[var(--text-muted)]">Code</th>
                <th className="text-left px-6 py-4 text-sm font-medium text-[var(--text-muted)]">Discount</th>
                <th className="text-left px-6 py-4 text-sm font-medium text-[var(--text-muted)]">Status</th>
                <th className="text-left px-6 py-4 text-sm font-medium text-[var(--text-muted)]">Uses</th>
                <th className="text-left px-6 py-4 text-sm font-medium text-[var(--text-muted)]">Actions</th>
              </tr>
            </thead>
            <tbody>
              {codes.map(code => (
                <tr key={code.id} className="border-b border-[var(--border)] last:border-0">
                  <td className="px-6 py-4">
                    <code className="text-lg font-mono text-[var(--accent-purple-light)]">
                      {code.code}
                    </code>
                  </td>
                  <td className="px-6 py-4 text-sm">
                    {formatDiscount()}
                    {code.trialExtensionDays > 0 && (
                      <span className="block text-xs text-[var(--text-muted)]">
                        +{code.trialExtensionDays} trial days
                      </span>
                    )}
                  </td>
                  <td className="px-6 py-4">
                    <span className={`text-xs px-2 py-1 rounded-full ${
                      code.isActive
                        ? 'bg-green-500/20 text-green-500'
                        : 'bg-gray-500/20 text-gray-500'
                    }`}>
                      {code.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-sm">
                    {code.currentRedemptions}
                    {code.maxRedemptions && (
                      <span className="text-[var(--text-muted)]"> / {code.maxRedemptions}</span>
                    )}
                  </td>
                  <td className="px-6 py-4">
                    <button
                      onClick={() => copyCode(code.code)}
                      className="p-2 hover:bg-[var(--background)] rounded-lg transition"
                      title="Copy code"
                    >
                      {copiedCode === code.code ? (
                        <Check className="w-4 h-4 text-green-500" />
                      ) : (
                        <Copy className="w-4 h-4 text-[var(--text-muted)]" />
                      )}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Create Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-[var(--card-background)] border border-[var(--border)] rounded-2xl p-6 w-full max-w-md">
            <h2 className="text-xl font-bold mb-6">Create New Promo Code</h2>

            {/* Discount Info Banner */}
            <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-4 mb-6">
              <div className="flex items-start gap-3">
                <Tag className="w-5 h-5 text-green-500 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-green-400">All promo codes include 10% off</p>
                  <p className="text-xs text-[var(--text-muted)] mt-1">
                    Users who apply your code get 10% off their first subscription. This is a one-time discount per user.
                  </p>
                </div>
              </div>
            </div>

            <form onSubmit={handleCreateCode} className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-2">
                  Max Redemptions (optional)
                </label>
                <input
                  type="number"
                  value={createForm.maxRedemptions}
                  onChange={e => {
                    const value = e.target.value;
                    // Validate: only allow positive integers
                    if (value === '' || (parseInt(value) > 0 && parseInt(value) <= 100000)) {
                      setCreateForm(prev => ({ ...prev, maxRedemptions: value }));
                    }
                  }}
                  placeholder="Leave empty for unlimited"
                  min="1"
                  max="100000"
                  className="w-full px-4 py-3 bg-[var(--background)] border border-[var(--border)] rounded-lg"
                />
                <p className="text-xs text-[var(--text-muted)] mt-1">
                  Limit how many users can use this code. Max 100,000.
                </p>
              </div>

              {/* Fraud Prevention Notice */}
              <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-3">
                <p className="text-xs text-yellow-400">
                  <strong>Fraud Protection:</strong> Our system tracks devices, IPs, and payment methods to prevent abuse.
                  Users can only receive the discount once, even with multiple codes.
                </p>
              </div>

              <div className="flex gap-3 pt-4">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="flex-1 btn-secondary"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isCreating}
                  className="flex-1 btn-primary flex items-center justify-center gap-2"
                >
                  {isCreating ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Creating...
                    </>
                  ) : (
                    'Create Code'
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
