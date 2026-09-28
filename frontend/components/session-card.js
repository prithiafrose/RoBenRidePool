"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { clearSession, getToken, getStoredUser } from "../lib/auth-storage";
import { getCurrentUser } from "../lib/api";

/**
 * Proves the protected endpoint works: with a token in storage it calls
 * GET /api/auth/me, without one it shows the sign-in links. The role-aware
 * dashboard replaces this once the ride features exist.
 */
export function SessionCard() {
  const [state, setState] = useState({ status: "loading", user: null });

  useEffect(() => {
    const token = getToken();

    if (!token) {
      setState({ status: "anonymous", user: null });
      return;
    }

    getCurrentUser(token)
      .then((data) => setState({ status: "authenticated", user: data.user }))
      .catch(() => {
        // Expired or tampered token: drop the unusable session.
        clearSession();
        setState({ status: "anonymous", user: null });
      });
  }, []);

  const signOut = () => {
    clearSession();
    setState({ status: "anonymous", user: null });
  };

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <h2 className="text-sm font-semibold tracking-wide text-slate-500 uppercase">
        Your session
      </h2>

      {state.status === "loading" ? (
        <p className="mt-4 text-sm text-slate-500">Checking your session...</p>
      ) : null}

      {state.status === "anonymous" ? (
        <div className="mt-4 space-y-3">
          <p className="text-sm text-slate-600">
            You are not signed in. Register as a passenger or driver to get a token.
          </p>
          <div className="flex gap-3">
            <Link
              href="/login"
              className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-700"
            >
              Sign in
            </Link>
            <Link
              href="/register"
              className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition hover:border-slate-400"
            >
              Register
            </Link>
          </div>
        </div>
      ) : null}

      {state.status === "authenticated" ? (
        <div className="mt-4 space-y-3">
          <div className="rounded-lg bg-emerald-50 px-4 py-3">
            <p className="text-sm font-semibold text-emerald-800">{state.user.name}</p>
            <p className="text-xs text-emerald-700">{state.user.email}</p>
            <span className="mt-2 inline-block rounded-full bg-emerald-600 px-2.5 py-0.5 text-xs font-medium text-white">
              {state.user.role}
            </span>
          </div>
          <button
            type="button"
            onClick={signOut}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition hover:border-slate-400"
          >
            Sign out
          </button>
        </div>
      ) : null}
    </section>
  );
}
