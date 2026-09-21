// Shared shell for /login and /signup — matches the homepage's palette
// without touching the dashboard, which reads the same variable names
// at their original (unscoped) values.
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="auth-theme min-h-screen bg-[var(--background)] text-[var(--foreground)] font-[family-name:var(--font-inter)]">
      {children}
    </div>
  );
}
