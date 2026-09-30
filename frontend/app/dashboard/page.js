"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { useSession } from "../../hooks/use-session";

/**
 * Sends each account to the dashboard built for its role.
 *
 * The path is derived from the role the API reports, never from a value in the
 * URL, so the one entry point cannot be used to aim someone at the other role's
 * pages.
 */
export default function DashboardPage() {
  const { status, user } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (status === "anonymous") {
      router.replace("/login");
    } else if (status === "authenticated") {
      router.replace(`/dashboard/${user.role.toLowerCase()}`);
    }
  }, [status, user, router]);

  return (
    <p className="py-16 text-center text-sm text-slate-500" role="status">
      {status === "anonymous"
        ? "Taking you to the sign-in page..."
        : "Opening your dashboard..."}
    </p>
  );
}