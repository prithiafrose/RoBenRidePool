"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

import { useSession } from "../hooks/use-session";
import { Icon } from "./icons";
import { Button } from "./ui";

/**
 * The navigation bar for a signed-in account.
 *
 * The links are chosen from the account's role, so a passenger is never offered
 * the driver's matching queue. This mirrors the API's role checks rather than
 * replacing them: hiding a link is a way of not offering a confusing action, not
 * a way of preventing it.
 */

const NAVIGATION = {
  PASSENGER: [{ href: "/dashboard/passenger", label: "My rides", icon: "user" }],
  DRIVER: [
    { href: "/dashboard/driver", label: "Overview", icon: "overview" },
    { href: "/dashboard/driver/rides", label: "Ride queue", icon: "queue" },
  ],
};

const initialsOf = (name) =>
  (name ?? "")
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();

/**
 * Which link is current.
 *
 * Matched longest-first, because `/dashboard/driver` is a prefix of
 * `/dashboard/driver/rides` and a plain `startsWith` would light up "Overview"
 * while the driver is looking at the queue. The deepest match is the one that is
 * actually on screen.
 */
function currentHref(pathname, links) {
  const matches = links
    .filter((link) => pathname === link.href || pathname.startsWith(`${link.href}/`))
    .sort((a, b) => b.href.length - a.href.length);

  return matches[0]?.href ?? null;
}

function NavLink({ link, isCurrent, onNavigate }) {
  return (
    <Link
      href={link.href}
      onClick={onNavigate}
      aria-current={isCurrent ? "page" : undefined}
      className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition ${
        isCurrent
          ? "bg-slate-900 text-white"
          : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
      }`}
    >
      <Icon name={link.icon} className="h-4 w-4" />
      {link.label}
    </Link>
  );
}

export function AppShell({ children }) {
  const { user, signOut } = useSession();
  const pathname = usePathname();
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  if (!user) return children;

  const links = NAVIGATION[user.role] ?? [];
  const activeHref = currentHref(pathname, links);
  const closeMenu = () => setIsMenuOpen(false);

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/85 backdrop-blur">
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center gap-4 px-4 sm:px-6">
          <Link
            href="/dashboard"
            onClick={closeMenu}
            className="flex items-center gap-2.5 rounded-lg"
          >
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-900 text-white">
              <Icon name="car" className="h-4.5 w-4.5" />
            </span>
            <span className="text-sm font-semibold tracking-tight text-slate-900">
              RoBen<span className="text-slate-400">RidePool</span>
            </span>
          </Link>

          <nav className="ml-4 hidden items-center gap-1 md:flex" aria-label="Main">
            {links.map((link) => (
              <NavLink
                key={link.href}
                link={link}
                isCurrent={link.href === activeHref}
              />
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-2">
            <span className="hidden items-center gap-2.5 sm:flex">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-200 text-xs font-semibold text-slate-700">
                {initialsOf(user.name) || "?"}
              </span>
              <span className="hidden text-sm leading-tight lg:flex">
                <span className="block font-medium text-slate-900">{user.name}</span>
                <span className="block text-xs text-slate-500">
                  {user.role === "DRIVER" ? "Driver" : "Passenger"}
                </span>
              </span>
            </span>

            <Button
              variant="ghost"
              size="sm"
              icon="logout"
              onClick={signOut}
              className="hidden sm:inline-flex"
            >
              Sign out
            </Button>

            <button
              type="button"
              onClick={() => setIsMenuOpen((open) => !open)}
              aria-expanded={isMenuOpen}
              aria-label={isMenuOpen ? "Close menu" : "Open menu"}
              className="rounded-lg p-2 text-slate-600 transition hover:bg-slate-100 hover:text-slate-900 md:hidden"
            >
              <Icon name={isMenuOpen ? "close" : "menu"} className="h-5 w-5" />
            </button>
          </div>
        </div>

        {isMenuOpen ? (
          <nav
            className="border-t border-slate-200 bg-white px-4 py-3 md:hidden"
            aria-label="Main"
          >
            <div className="mx-auto flex w-full max-w-6xl flex-col gap-1">
              {links.map((link) => (
                <NavLink
                  key={link.href}
                  link={link}
                  isCurrent={link.href === activeHref}
                  onNavigate={closeMenu}
                />
              ))}

              <div className="mt-2 flex items-center justify-between border-t border-slate-200 pt-3">
                <span className="text-sm text-slate-600">
                  {user.name} &middot; {user.role === "DRIVER" ? "Driver" : "Passenger"}
                </span>
                <Button variant="secondary" size="sm" icon="logout" onClick={signOut}>
                  Sign out
                </Button>
              </div>
            </div>
          </nav>
        ) : null}
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6">{children}</main>
    </div>
  );
}