"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { getToken } from "../lib/auth-storage";

/**
 * Sends a signed-in account from the landing page to its dashboard.
 *
 * `/dashboard` is the only entry point and it resolves the role from the API, so
 * this points there rather than choosing a page. Reading the stored token is
 * enough to decide: an expired or tampered token is caught by `SessionProvider`
 * on the next page, which clears it and redirects to sign-in, so this never has
 * to verify anything itself.
 *
 * Deliberately no loading state. The landing page is a static, prerendered
 * document, and gating it behind a session check would make every visitor wait on
 * JavaScript to read content that does not depend on it.
 */
export function HomeRedirect() {
  const router = useRouter();

  useEffect(() => {
    if (getToken()) {
      router.replace("/dashboard");
    }
  }, [router]);

  return null;
}
