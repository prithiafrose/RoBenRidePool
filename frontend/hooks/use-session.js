"use client";

import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

import { getCurrentUser } from "../lib/api";
import { clearSession, getToken, saveSession } from "../lib/auth-storage";

/**
 * The signed-in account, shared by the whole dashboard.
 *
 * There is no server-side session to read: the token is in `localStorage` (see
 * `auth-storage.js` for why), which does not exist during prerender. So the
 * states are explicit - `loading` until the token has been read and verified,
 * then `anonymous` or `authenticated` - and `Protected` renders its children
 * only in the last one.
 *
 * Deciding this in a component rather than in middleware is deliberate. Middleware
 * runs on the server, where `localStorage` is not readable, so a middleware that
 * checked the token could not work at all.
 *
 * The token is verified rather than trusted. The stored user is a cache for
 * display, but `GET /api/auth/me` is what decides `authenticated`, and a token
 * the API rejects clears the session instead of leaving a stale identity on
 * screen. One provider rather than a hook per component, so the verification is a
 * single request no matter how many parts of a page read the session.
 */

const SessionContext = createContext(null);

export function SessionProvider({ children }) {
  const router = useRouter();
  const [state, setState] = useState({ status: "loading", user: null, token: null });

  useEffect(() => {
    let active = true;

    const stored = getToken();

    if (!stored) {
      setState({ status: "anonymous", user: null, token: null });
      return undefined;
    }

    getCurrentUser(stored)
      .then(({ user }) => {
        if (!active) return;

        // Refresh the cached copy, so a name or role changed elsewhere is picked
        // up rather than being pinned by the cache.
        saveSession({ token: stored, user });
        setState({ status: "authenticated", user, token: stored });
      })
      .catch(() => {
        if (!active) return;

        clearSession();
        setState({ status: "anonymous", user: null, token: null });
      });

    return () => {
      active = false;
    };
  }, []);

  const signOut = useCallback(() => {
    clearSession();
    setState({ status: "anonymous", user: null, token: null });
    router.push("/login");
  }, [router]);

  const value = useMemo(() => ({ ...state, signOut }), [state, signOut]);

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

/** The current session. Must be used below a `SessionProvider`. */
export function useSession() {
  const session = useContext(SessionContext);

  if (!session) {
    throw new Error("useSession must be used within a SessionProvider");
  }

  return session;
}

/**
 * A route that only renders for a signed-in account.
 *
 * Sends anonymous visitors to the login page rather than rendering an empty
 * dashboard, and keeps a signed-in visitor out of the other role's pages so a
 * stale link lands somewhere useful.
 *
 * `role` is a convenience, not the security boundary. The API re-checks the role
 * on every endpoint, so a passenger who reaches the driver page by typing the
 * URL still sees nothing but failed requests. This only decides what is rendered.
 */
export function Protected({ role, children }) {
  const { status, user } = useSession();
  const router = useRouter();

  const wrongRole = status === "authenticated" && role && user.role !== role;

  useEffect(() => {
    if (status === "anonymous") {
      router.replace("/login");
    } else if (wrongRole) {
      router.replace(`/dashboard/${user.role.toLowerCase()}`);
    }
  }, [status, wrongRole, user, role, router]);

  if (status === "loading" || status === "anonymous" || wrongRole) {
    return (
      <p className="py-16 text-center text-sm text-slate-500" role="status">
        {status === "anonymous"
          ? "Taking you to the sign-in page..."
          : wrongRole
            ? "Taking you to your dashboard..."
            : "Checking your session..."}
      </p>
    );
  }

  return children;
}