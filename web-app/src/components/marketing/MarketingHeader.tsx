'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

export default function MarketingHeader() {
  const pathname = usePathname();

  return (
    <header className="border-b border-[var(--border)] py-5">
      <div className="max-w-[900px] mx-auto px-6 flex justify-between items-center">
        <Link href="/" className="flex items-center gap-2 font-bold text-xl">
          <span className="bg-[var(--accent-purple)] px-2.5 py-1.5 rounded-lg">S</span>
          Scribe AI
        </Link>
        <nav className="hidden md:flex items-center">
          <Link
            href="/creators"
            className={`ml-6 text-sm ${pathname === '/creators' ? 'text-white' : 'text-[var(--text-muted)] hover:text-white'} transition`}
          >
            Creators
          </Link>
          <Link
            href="/privacy"
            className={`ml-6 text-sm ${pathname === '/privacy' ? 'text-white' : 'text-[var(--text-muted)] hover:text-white'} transition`}
          >
            Privacy
          </Link>
          <Link
            href="/contact"
            className={`ml-6 text-sm ${pathname === '/contact' ? 'text-white' : 'text-[var(--text-muted)] hover:text-white'} transition`}
          >
            Contact
          </Link>
          <Link
            href="/login"
            className="ml-6 bg-[var(--accent-purple)] text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-[var(--accent-purple-hover)] transition"
          >
            Login
          </Link>
        </nav>
      </div>
    </header>
  );
}
