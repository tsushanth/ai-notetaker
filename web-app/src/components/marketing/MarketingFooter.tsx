import Link from 'next/link';

export default function MarketingFooter() {
  return (
    <footer className="border-t border-[var(--border)] py-10">
      <div className="max-w-[900px] mx-auto px-6">
        <div className="flex flex-col md:flex-row justify-between gap-8">
          <Link href="/" className="flex items-center gap-2 font-bold text-xl">
            <span className="bg-[var(--accent-purple)] px-2.5 py-1.5 rounded-lg">S</span>
            Scribe AI
          </Link>
          <div className="flex flex-col md:flex-row gap-8 md:gap-12">
            <div>
              <h4 className="text-xs text-[var(--text-muted)] uppercase tracking-wide mb-3">Product</h4>
              <div className="flex flex-col gap-2">
                <a
                  href="https://apps.apple.com/us/app/scribe-ai-learn/id6755475602"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-[var(--text-secondary)] hover:text-white transition"
                >
                  iOS App
                </a>
                <a
                  href="https://play.google.com/store/apps/details?id=com.kreativekoala.scribeai"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-[var(--text-secondary)] hover:text-white transition"
                >
                  Android App
                </a>
                <Link
                  href="/login"
                  className="text-sm text-[var(--text-secondary)] hover:text-white transition"
                >
                  Web App
                </Link>
              </div>
            </div>
            <div>
              <h4 className="text-xs text-[var(--text-muted)] uppercase tracking-wide mb-3">Company</h4>
              <div className="flex flex-col gap-2">
                <Link
                  href="/creators"
                  className="text-sm text-[var(--text-secondary)] hover:text-white transition"
                >
                  Creators
                </Link>
                <Link
                  href="/contact"
                  className="text-sm text-[var(--text-secondary)] hover:text-white transition"
                >
                  Contact
                </Link>
              </div>
            </div>
            <div>
              <h4 className="text-xs text-[var(--text-muted)] uppercase tracking-wide mb-3">Legal</h4>
              <div className="flex flex-col gap-2">
                <Link
                  href="/privacy"
                  className="text-sm text-[var(--text-secondary)] hover:text-white transition"
                >
                  Privacy
                </Link>
                <Link
                  href="/terms"
                  className="text-sm text-[var(--text-secondary)] hover:text-white transition"
                >
                  Terms
                </Link>
              </div>
            </div>
          </div>
        </div>
        <div className="mt-8 pt-6 border-t border-[var(--border)] text-center">
          <p className="text-sm text-[var(--text-muted)]">
            © {new Date().getFullYear()} Kreative Koala. All rights reserved.
          </p>
        </div>
      </div>
    </footer>
  );
}
