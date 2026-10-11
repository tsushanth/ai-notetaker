'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { loginUrl } from '@/lib/session';
import { useAuthStore } from '@/store/authStore';
import AdminDashboard from '@/components/AdminDashboard';

// Session is a bearer token in localStorage, so the gate is the API route (404 for non-admins).
// This page only avoids rendering the shell until the store has hydrated.
export default function AdminPage() {
  const { token, isLoading } = useAuthStore();
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  useEffect(() => { if (mounted && !isLoading && !token) router.replace(loginUrl('/admin')); }, [mounted, isLoading, token, router]);

  if (!mounted || isLoading || !token) return null;
  return <AdminDashboard token={token} />;
}
