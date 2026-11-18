import type { Metadata } from 'next';
import { Inter, Space_Grotesk } from 'next/font/google';
import Script from 'next/script';
import './globals.css';
import WebFailureReporter from '@/components/WebFailureReporter'
import SessionExpiryWatcher from '@/components/SessionExpiryWatcher'

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
  metadataBase: new URL('https://scribeai.online'),
  alternates: { canonical: './' },
  title: 'Scribe AI: Turn Lectures, YouTube and PDFs into Study Notes',
  description: 'Record a lecture, paste a YouTube link or upload a PDF, and get study notes, flashcards and a practice quiz in minutes. Free to start on the web and Android.',
  keywords: ['study notes', 'lecture notes', 'YouTube to notes', 'PDF to flashcards', 'flashcards', 'quiz', 'note taking app', 'transcription'],
  authors: [{ name: 'Kreative Koala' }],
  openGraph: {
    title: 'Scribe AI: Turn Lectures, YouTube and PDFs into Study Notes',
    description: 'Study notes, flashcards and a practice quiz from a lecture recording, a YouTube link or a PDF.',
    type: 'website',
    locale: 'en_US',
    siteName: 'Scribe AI',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Scribe AI: Turn Lectures, YouTube and PDFs into Study Notes',
    description: 'Study notes, flashcards and a practice quiz from a lecture recording, a YouTube link or a PDF.',
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
        <WebFailureReporter />
        <SessionExpiryWatcher />
        {children}
      </body>
    </html>
  );
}
