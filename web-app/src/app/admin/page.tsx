'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useAuthStore } from '@/store/authStore';
import AdminDashboard from '@/components/AdminDashboard';

// Session is a bearer token in localStorage, so the gate is the API route (404 for non-admins).
// This page only avoids rendering the shell until the store has hydrated.
export default function AdminPage() {
  const { token, isLoading } = useAuthStore();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  if (!mounted || isLoading) return null;
  if (!token) {
    return <p style={{ padding: 24 }}>Sign in first: <Link href="/login" style={{ textDecoration: 'underline' }}>Log in</Link></p>;
  }
  return <AdminDashboard token={token} />;
}
