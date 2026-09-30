"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { useSession } from "../hooks/use-session";

/**
 * The navigation bar for a signed-in account.
 *
 * The links are chosen from the account's role, so a passenger is never offered
 * the driver's matching queue. This mirrors the API's role checks rather than
 * replacing them: hiding a link is a way of not offering a confusing action, not
 * a way of preventing it.
 */

const NAVIGATION = {
  PASSENGER: [
    { href: "/dashboard/passenger", label: "My rides" },
  ],
  DRIVER: [
    { href: "/dashboard/driver", label: "Overview" },
    { href: "/dashboard/driver/rides", label: "Ride queue" },
  ],
};

export function AppShell({ children }) {
  const { user, signOut } = useSession();
  const pathname = usePathname();

  if (!user) return children;

  const links = NAVIGATION[user.role] ?? [];

  return (
    <div className="min-h-screen">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center gap-4 px-6 py-4">
          <Link href="/dashboard" className="font-semibold tracking-tight">
            RoBen RidePool
          </Link>

          <nav className="flex flex-wrap gap-1" aria-label="Main">
            {links.map((link) => {
              const isCurrent = pathname === link.href;

              return (
                <Link
                  key={link.href}
                  href={link.href}
                  aria-current={isCurrent ? "page" : undefined}
                  className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                    isCurrent
                      ? "bg-slate-900 text-white"
                      : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                  }`}
                >
                  {link.label}
                </Link>
              );
            })}
          </nav>

          <div className="ml-auto flex items-center gap-3">
            <span className="hidden text-sm text-slate-600 sm:inline">{user.name}</span>
            <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-700">
              {user.role === "DRIVER" ? "Driver" : "Passenger"}
            </span>
            <button
              type="button"
              onClick={signOut}
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 transition hover:border-slate-400"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl px-6 py-8">{children}</main>
    </div>
  );
}