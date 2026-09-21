import type { Metadata } from 'next';
import { Inter, Space_Grotesk } from 'next/font/google';
import Script from 'next/script';
import './globals.css';

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
});
// Display face for the homepage only — the rest of the app stays on Inter alone.
const spaceGrotesk = Space_Grotesk({
  subsets: ['latin'],
  variable: '--font-display',
});

export const metadata: Metadata = {
  title: 'Scribe AI - Smart Note Taking',
  description: 'Transform your learning with AI-powered notes, quizzes, flashcards, and podcasts. Record, upload, or paste content and let AI help you study smarter.',
  keywords: ['note taking', 'AI', 'study', 'flashcards', 'quiz', 'learning', 'transcription'],
  authors: [{ name: 'Kreative Koala' }],
  openGraph: {
    title: 'Scribe AI - Smart Note Taking',
    description: 'Transform your learning with AI-powered notes, quizzes, flashcards, and podcasts.',
    type: 'website',
    locale: 'en_US',
    siteName: 'Scribe AI',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Scribe AI - Smart Note Taking',
    description: 'Transform your learning with AI-powered notes, quizzes, flashcards, and podcasts.',
  },
  robots: {
    index: true,
    follow: true,
  },
  icons: {
    icon: '/favicon.ico',
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        {/* Google Sign-In Client Library */}
        <Script
          src="https://accounts.google.com/gsi/client"
          strategy="beforeInteractive"
        />
      </head>
      <body className={`${inter.variable} ${spaceGrotesk.variable} antialiased`}>
        {children}
      </body>
    </html>
  );
}
