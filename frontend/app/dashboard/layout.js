"use client";

import { AppShell } from "../../components/app-shell";
import { SessionProvider } from "../../hooks/use-session";

/**
 * The signed-in area.
 *
 * The provider lives here rather than in the root layout because the auth pages
 * sit outside `/dashboard` and have no use for a session check - mounting it at
 * the root would make `/login` and `/register` pay for a `GET /api/auth/me` they
 * do not need, and briefly show "taking you to the sign-in page" while signing
 * in.
 *
 * Protection itself is applied per page with `Protected`, because the required
 * role differs by page and Express owns the real check.
 */
export default function DashboardLayout({ children }) {
  return (
    <SessionProvider>
      <AppShell>{children}</AppShell>
    </SessionProvider>
  );
}