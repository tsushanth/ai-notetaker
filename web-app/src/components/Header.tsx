'use client';

import Link from 'next/link';
import { useAuthStore } from '@/store/authStore';
import { LogOut, User, Menu } from 'lucide-react';
import { useState } from 'react';

export default function Header() {
  const { user, isAuthenticated, logout } = useAuthStore();
  const [showMenu, setShowMenu] = useState(false);

  return (
    <header className="border-b border-[var(--border)] bg-[var(--background)] sticky top-0 z-50">
      <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
        {/* Logo */}
        <Link href={isAuthenticated ? '/notes' : '/'} className="flex items-center gap-2">
          <span className="bg-[var(--accent-purple)] px-2.5 py-1 rounded-lg text-white font-bold">
            S
          </span>
          <span className="font-bold text-lg">Scribe AI</span>
        </Link>

        {/* Navigation */}
        {isAuthenticated ? (
          <div className="relative">
            <button
              onClick={() => setShowMenu(!showMenu)}
              className="flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-[var(--card-background)] transition"
            >
              <div className="w-8 h-8 rounded-full bg-[var(--accent-purple)] flex items-center justify-center">
                {user?.name?.charAt(0) || user?.email?.charAt(0) || <User size={16} />}
              </div>
              <span className="hidden sm:block text-sm text-[var(--text-secondary)]">
                {user?.name || user?.email?.split('@')[0]}
              </span>
            </button>

            {showMenu && (
              <>
                <div
                  className="fixed inset-0 z-40"
                  onClick={() => setShowMenu(false)}
                />
                <div className="absolute right-0 top-full mt-2 w-48 bg-[var(--card-background)] border border-[var(--border)] rounded-lg shadow-lg z-50">
                  <div className="p-3 border-b border-[var(--border)]">
                    <p className="text-sm font-medium truncate">{user?.name || 'User'}</p>
                    <p className="text-xs text-[var(--text-muted)] truncate">{user?.email}</p>
                  </div>
                  <button
                    onClick={() => {
                      logout();
                      setShowMenu(false);
                    }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-[var(--accent-red)] hover:bg-[var(--surface-variant)] transition"
                  >
                    <LogOut size={16} />
                    Sign Out
                  </button>
                </div>
              </>
            )}
          </div>
        ) : (
          <div className="flex items-center gap-4">
            <Link
              href="/login"
              className="text-sm text-[var(--text-secondary)] hover:text-white transition"
            >
              Sign In
            </Link>
            <Link
              href="/signup"
              className="btn-primary text-sm px-4 py-2"
            >
              Get Started
            </Link>
          </div>
        )}
      </div>
    </header>
  );
}
