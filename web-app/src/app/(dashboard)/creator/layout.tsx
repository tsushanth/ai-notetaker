'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LayoutDashboard, DollarSign, Tag, CreditCard, Settings, ArrowLeft } from 'lucide-react';

const navItems = [
  { href: '/creator', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/creator/codes', label: 'Promo Codes', icon: Tag },
  { href: '/creator/earnings', label: 'Earnings', icon: DollarSign },
  { href: '/creator/payouts', label: 'Payouts', icon: CreditCard },
  { href: '/creator/settings', label: 'Settings', icon: Settings },
];

export default function CreatorLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();

  return (
    <div className="max-w-6xl mx-auto px-6 py-8">
      {/* Back to Notes */}
      <Link
        href="/notes"
        className="inline-flex items-center gap-2 text-sm text-[var(--text-muted)] hover:text-white mb-6 transition"
      >
        <ArrowLeft size={16} />
        Back to Notes
      </Link>

      <div className="flex gap-8">
        {/* Sidebar */}
        <nav className="w-48 flex-shrink-0">
          <h2 className="text-lg font-semibold mb-4">Creator Portal</h2>
          <ul className="space-y-1">
            {navItems.map(item => {
              const isActive = pathname === item.href ||
                (item.href !== '/creator' && pathname.startsWith(item.href));
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition ${
                      isActive
                        ? 'bg-[var(--accent-purple)] text-white'
                        : 'text-[var(--text-secondary)] hover:bg-[var(--card-background)]'
                    }`}
                  >
                    <item.icon size={18} />
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        {/* Main Content */}
        <main className="flex-1 min-w-0">
          {children}
        </main>
      </div>
    </div>
  );
}
