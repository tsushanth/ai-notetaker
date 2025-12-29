'use client';

import { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuthStore } from '@/store/authStore';
import { creatorsApi } from '@/lib/api';
import { Loader2, AlertCircle, CheckCircle, ExternalLink, User, Link as LinkIcon } from 'lucide-react';

interface CreatorProfile {
  id: string;
  email: string;
  name: string;
  username: string;
  socialPlatform: string;
  socialUrl: string;
  socialFollowers: number;
  status: string;
  hasPremiumAccess: boolean;
  revenueSharePercent: number;
  minimumPayoutAmount: number;
  stripeConnectStatus: string;
  stripeOnboardingComplete: boolean;
  createdAt: string;
}

export default function CreatorSettingsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { token, isAuthenticated } = useAuthStore();
  const [profile, setProfile] = useState<CreatorProfile | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [isConnectingStripe, setIsConnectingStripe] = useState(false);

  useEffect(() => {
    if (!isAuthenticated) {
      router.push('/login');
      return;
    }
    loadProfile();

    // Check for Stripe return
    const stripeParam = searchParams.get('stripe');
    if (stripeParam === 'success') {
      // Refresh profile to get updated Stripe status
      setTimeout(() => loadProfile(), 1000);
    }
  }, [isAuthenticated, router, token, searchParams]);

  const handleConnectStripe = async () => {
    if (!token) return;

    try {
      setIsConnectingStripe(true);
      const response = await creatorsApi.connectStripe(token);

      if (response.data.onboardingUrl) {
        // Redirect to Stripe onboarding
        window.location.href = response.data.onboardingUrl;
      } else if (response.data.status === 'already_connected') {
        // Already connected, refresh profile
        loadProfile();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to connect Stripe');
    } finally {
      setIsConnectingStripe(false);
    }
  };

  const handleStripeDashboard = async () => {
    if (!token) return;

    try {
      const response = await creatorsApi.getStripeDashboard(token);
      if (response.data.dashboardUrl) {
        window.open(response.data.dashboardUrl, '_blank');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to open Stripe dashboard');
    }
  };

  const loadProfile = async () => {
    if (!token) return;

    try {
      setIsLoading(true);
      const response = await creatorsApi.getProfile(token);
      setProfile(response.data as CreatorProfile);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load profile');
    } finally {
      setIsLoading(false);
    }
  };

  const getStripeStatusInfo = (status: string) => {
    switch (status) {
      case 'active':
        return { color: 'text-green-500', bg: 'bg-green-500/20', label: 'Connected' };
      case 'onboarding':
        return { color: 'text-yellow-500', bg: 'bg-yellow-500/20', label: 'Setup In Progress' };
      case 'restricted':
        return { color: 'text-orange-500', bg: 'bg-orange-500/20', label: 'Needs Attention' };
      case 'disabled':
        return { color: 'text-red-500', bg: 'bg-red-500/20', label: 'Disabled' };
      default:
        return { color: 'text-gray-500', bg: 'bg-gray-500/20', label: 'Not Connected' };
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-[var(--accent-purple)]" />
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-6 text-center">
        <AlertCircle className="w-8 h-8 text-red-500 mx-auto mb-3" />
        <p className="text-red-400 mb-4">{error || 'Failed to load profile'}</p>
        <button onClick={loadProfile} className="btn-secondary">
          Try Again
        </button>
      </div>
    );
  }

  const stripeStatus = getStripeStatusInfo(profile.stripeConnectStatus);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Settings</h1>
        <p className="text-[var(--text-muted)]">Manage your creator profile and payout settings</p>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4 flex items-center gap-3">
          <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0" />
          <p className="text-sm text-red-400">{error}</p>
        </div>
      )}

      {/* Profile Section */}
      <div className="bg-[var(--card-background)] border border-[var(--border)] rounded-xl p-6">
        <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <User size={20} />
          Profile Information
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <label className="block text-sm text-[var(--text-muted)] mb-1">Name</label>
            <p className="font-medium">{profile.name}</p>
          </div>
          <div>
            <label className="block text-sm text-[var(--text-muted)] mb-1">Email</label>
            <p className="font-medium">{profile.email}</p>
          </div>
          <div>
            <label className="block text-sm text-[var(--text-muted)] mb-1">Username</label>
            <p className="font-medium">@{profile.username}</p>
          </div>
          <div>
            <label className="block text-sm text-[var(--text-muted)] mb-1">Status</label>
            <span className={`text-xs px-2 py-1 rounded-full ${
              profile.status === 'active'
                ? 'bg-green-500/20 text-green-500'
                : 'bg-gray-500/20 text-gray-500'
            }`}>
              {profile.status}
            </span>
          </div>
          <div>
            <label className="block text-sm text-[var(--text-muted)] mb-1">Platform</label>
            <p className="font-medium capitalize">{profile.socialPlatform || 'Not specified'}</p>
          </div>
          <div>
            <label className="block text-sm text-[var(--text-muted)] mb-1">Followers</label>
            <p className="font-medium">
              {profile.socialFollowers
                ? profile.socialFollowers.toLocaleString()
                : 'Not specified'
              }
            </p>
          </div>
        </div>
        {profile.socialUrl && (
          <div className="mt-4 pt-4 border-t border-[var(--border)]">
            <a
              href={profile.socialUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 text-sm text-[var(--accent-purple-light)] hover:underline"
            >
              <LinkIcon size={14} />
              {profile.socialUrl}
              <ExternalLink size={14} />
            </a>
          </div>
        )}
      </div>

      {/* Revenue Settings */}
      <div className="bg-[var(--card-background)] border border-[var(--border)] rounded-xl p-6">
        <h2 className="text-lg font-semibold mb-4">Revenue Settings</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <label className="block text-sm text-[var(--text-muted)] mb-1">Revenue Share</label>
            <p className="text-2xl font-bold text-[var(--accent-purple-light)]">
              {profile.revenueSharePercent}%
            </p>
            <p className="text-xs text-[var(--text-muted)] mt-1">
              Of net revenue after platform fees
            </p>
          </div>
          <div>
            <label className="block text-sm text-[var(--text-muted)] mb-1">Minimum Payout</label>
            <p className="text-2xl font-bold">
              ${profile.minimumPayoutAmount.toFixed(2)}
            </p>
            <p className="text-xs text-[var(--text-muted)] mt-1">
              Required balance for monthly payout
            </p>
          </div>
        </div>
      </div>

      {/* Premium Access */}
      <div className="bg-[var(--card-background)] border border-[var(--border)] rounded-xl p-6">
        <h2 className="text-lg font-semibold mb-4">Premium Access</h2>
        <div className="flex items-center gap-3">
          {profile.hasPremiumAccess ? (
            <>
              <div className="w-10 h-10 rounded-full bg-green-500/20 flex items-center justify-center">
                <CheckCircle className="w-5 h-5 text-green-500" />
              </div>
              <div>
                <p className="font-medium">Premium Access Active</p>
                <p className="text-sm text-[var(--text-muted)]">
                  You have full access to all premium features
                </p>
              </div>
            </>
          ) : (
            <>
              <div className="w-10 h-10 rounded-full bg-yellow-500/20 flex items-center justify-center">
                <AlertCircle className="w-5 h-5 text-yellow-500" />
              </div>
              <div>
                <p className="font-medium">Premium Access Inactive</p>
                <p className="text-sm text-[var(--text-muted)]">
                  Get at least 1 conversion to restore premium access
                </p>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Stripe Connect */}
      <div className="bg-[var(--card-background)] border border-[var(--border)] rounded-xl p-6">
        <h2 className="text-lg font-semibold mb-4">Payout Method</h2>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-full ${stripeStatus.bg} flex items-center justify-center`}>
              <svg className={`w-5 h-5 ${stripeStatus.color}`} viewBox="0 0 24 24" fill="currentColor">
                <path d="M13.976 9.15c-2.172-.806-3.356-1.426-3.356-2.409 0-.831.683-1.305 1.901-1.305 2.227 0 4.515.858 6.09 1.631l.89-5.494C18.252.975 15.697 0 12.165 0 9.667 0 7.589.654 6.104 1.872 4.56 3.147 3.757 4.992 3.757 7.218c0 4.039 2.467 5.76 6.476 7.219 2.585.92 3.445 1.574 3.445 2.583 0 .98-.84 1.545-2.354 1.545-1.875 0-4.965-.921-6.99-2.109l-.9 5.555C5.175 22.99 8.385 24 11.714 24c2.641 0 4.843-.624 6.328-1.813 1.664-1.305 2.525-3.236 2.525-5.732 0-4.128-2.524-5.851-6.591-7.305z"/>
              </svg>
            </div>
            <div>
              <p className="font-medium">Stripe Connect</p>
              <span className={`text-xs px-2 py-1 rounded-full ${stripeStatus.bg} ${stripeStatus.color}`}>
                {stripeStatus.label}
              </span>
            </div>
          </div>
          {(profile.stripeConnectStatus === 'pending' || profile.stripeConnectStatus === 'onboarding' || profile.stripeConnectStatus === 'restricted') && (
            <button
              onClick={handleConnectStripe}
              disabled={isConnectingStripe}
              className="btn-primary flex items-center gap-2"
            >
              {isConnectingStripe ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Connecting...
                </>
              ) : (
                profile.stripeConnectStatus === 'pending' ? 'Connect Stripe' : 'Complete Setup'
              )}
            </button>
          )}
          {profile.stripeConnectStatus === 'active' && (
            <button
              onClick={handleStripeDashboard}
              className="btn-secondary flex items-center gap-2"
            >
              <ExternalLink size={16} />
              Stripe Dashboard
            </button>
          )}
        </div>
        {profile.stripeConnectStatus === 'pending' && (
          <p className="text-sm text-[var(--text-muted)] mt-4">
            Connect your Stripe account to receive payouts. You&apos;ll need to provide basic information to Stripe for compliance.
          </p>
        )}
      </div>

      {/* Member Since */}
      <div className="text-center text-sm text-[var(--text-muted)]">
        Creator since {new Date(profile.createdAt).toLocaleDateString('en-US', {
          month: 'long',
          year: 'numeric',
        })}
      </div>
    </div>
  );
}
