import Link from "next/link";

import { Icon } from "./icons";

/**
 * The frame both auth pages sit in.
 *
 * Shared because the two pages were otherwise a copy of each other's card, and
 * any change to the framing had to be made twice. `wide` gives the register form
 * room for the two-column fields; `children` is the form itself, so the pages
 * only describe their own fields.
 */
export function AuthShell({ title, description, children, footer, wide = false }) {
  return (
    <main className="flex min-h-screen w-full flex-col justify-center px-4 py-14">
      <div className={`mx-auto w-full ${wide ? "max-w-lg" : "max-w-md"}`}>
        <Link
          href="/"
          className="mb-8 flex items-center justify-center gap-2.5 rounded-lg"
        >
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-900 text-white">
            <Icon name="car" className="h-5 w-5" />
          </span>
          <span className="text-base font-semibold tracking-tight text-slate-900">
            RoBen<span className="text-slate-400">RidePool</span>
          </span>
        </Link>

        <div className="rounded-2xl border border-slate-200 bg-white p-7 shadow-raised sm:p-8">
          <h1 className="text-xl font-semibold tracking-tight text-slate-900">{title}</h1>
          {description ? (
            <p className="mt-1.5 text-sm text-slate-600">{description}</p>
          ) : null}

          <div className="mt-7">{children}</div>
        </div>

        {footer ? (
          <p className="mt-6 text-center text-sm text-slate-600">{footer}</p>
        ) : null}
      </div>
    </main>
  );
}