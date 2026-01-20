'use client';

import { Inter } from 'next/font/google';
import '../globals.css';

const inter = Inter({ subsets: ['latin'] });

export default function CheckoutLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className={`${inter.className} min-h-screen bg-gray-50`}>
      {/* Simple header for checkout pages */}
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-lg mx-auto px-4 py-3 flex items-center justify-center">
          <a href="https://scribeai.online" className="flex items-center gap-2">
            <span className="text-xl font-bold text-purple-600">ScribeAI</span>
          </a>
        </div>
      </header>

      <main className="min-h-[calc(100vh-60px)]">
        {children}
      </main>
    </div>
  );
}
