import Header from '@/components/Header';
import AuthGuard from '@/components/AuthGuard';

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    // .dashboard-theme wraps AuthGuard itself, not just its children, so the
    // vars are in scope for AuthGuard's own loading-state markup too (it
    // renders that in place of {children} while auth resolves).
    <div className="dashboard-theme">
      <AuthGuard>
        <div className="min-h-screen bg-[var(--background)]">
          <Header />
          <main>{children}</main>
        </div>
      </AuthGuard>
    </div>
  );
}
