import Header from '@/components/Header';
import AuthGuard from '@/components/AuthGuard';

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <AuthGuard>
      <div className="min-h-screen bg-[var(--background)]">
        <Header />
        <main>{children}</main>
      </div>
    </AuthGuard>
  );
}
