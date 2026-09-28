"use client";

import { useEffect, useState } from "react";

import { API_URL, getApiHealth } from "../lib/api";

const STATUS_STYLES = {
  checking: "bg-slate-200 text-slate-600",
  online: "bg-emerald-100 text-emerald-700",
  offline: "bg-rose-100 text-rose-700",
};

const STATUS_LABELS = {
  checking: "Checking API...",
  online: "API online",
  offline: "API unreachable",
};

/**
 * Placeholder status card: proves the frontend can talk to the backend.
 * Real dashboard metrics replace this once the ride features land.
 */
export function ApiStatusCard() {
  const [status, setStatus] = useState("checking");
  const [details, setDetails] = useState(null);

  useEffect(() => {
    let active = true;

    getApiHealth()
      .then((payload) => {
        if (!active) return;
        setStatus("online");
        setDetails(payload);
      })
      .catch(() => {
        if (active) setStatus("offline");
      });

    return () => {
      active = false;
    };
  }, []);

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold tracking-wide text-slate-500 uppercase">
          System status
        </h2>
        <span
          className={`rounded-full px-3 py-1 text-xs font-medium ${STATUS_STYLES[status]}`}
        >
          {STATUS_LABELS[status]}
        </span>
      </div>

      <p className="mt-4 font-mono text-sm text-slate-700">{API_URL}</p>

      {details?.data ? (
        <dl className="mt-4 grid grid-cols-2 gap-4 text-sm">
          <div>
            <dt className="text-slate-500">Uptime</dt>
            <dd className="font-mono">{details.data.uptimeSeconds}s</dd>
          </div>
          <div>
            <dt className="text-slate-500">Checked at</dt>
            <dd className="font-mono">
              {new Date(details.data.timestamp).toLocaleTimeString()}
            </dd>
          </div>
        </dl>
      ) : (
        <p className="mt-4 text-sm text-slate-500">
          Start the API with <code className="font-mono">docker compose up</code> to
          see live data here.
        </p>
      )}
    </section>
  );
}
