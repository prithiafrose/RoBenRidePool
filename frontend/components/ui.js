"use client";

import { STATUS_TONES } from "../lib/format";

/**
 * The presentational pieces both dashboards are built from.
 *
 * They live in one module rather than one file each because they are small,
 * stateless and always used together - a dashboard panel is nearly always a
 * heading, some body, and either a loading line, an empty line or an alert.
 */

/** A titled card. The unit every dashboard section is built in. */
export function Panel({ title, description, action, children, className = "" }) {
  return (
    <section
      className={`rounded-xl border border-slate-200 bg-white p-6 shadow-sm ${className}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold tracking-wide text-slate-500 uppercase">
            {title}
          </h2>
          {description ? (
            <p className="mt-1 text-sm text-slate-600">{description}</p>
          ) : null}
        </div>
        {action}
      </div>

      <div className="mt-5">{children}</div>
    </section>
  );
}

/**
 * A status pill.
 *
 * The colour comes from `STATUS_TONES` by the raw enum value rather than by the
 * label, so a status the map does not know still shows its label and simply
 * falls back to neutral styling instead of rendering as blank.
 */
export function StatusBadge({ value, label }) {
  return (
    <span
      className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${
        STATUS_TONES[value] ?? "bg-slate-100 text-slate-700"
      }`}
    >
      {label ?? value}
    </span>
  );
}

/** A neutral placeholder for a list with nothing in it. */
export function EmptyState({ title, children }) {
  return (
    <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center">
      <p className="text-sm font-medium text-slate-700">{title}</p>
      {children ? <p className="mt-1 text-sm text-slate-500">{children}</p> : null}
    </div>
  );
}

/** A loading line, distinct from a real message. */
export function Pending({ label = "Loading" }) {
  return (
    <p className="py-6 text-center text-sm text-slate-500" role="status">
      {label}...
    </p>
  );
}

/**
 * An alert.
 *
 * `tone` is `error` for a failure and `success` for a confirmed write. Server
 * messages are shown verbatim, because they are the ones written to explain what
 * the API refused and why - "Ride request cannot be added to this pool in its
 * current status" says more than anything invented here.
 */
export function Alert({ tone = "error", children, onDismiss }) {
  if (!children) return null;

  const toneClass =
    tone === "success"
      ? "border-emerald-200 bg-emerald-50 text-emerald-800"
      : "border-rose-200 bg-rose-50 text-rose-700";

  return (
    <div
      role="alert"
      className={`flex items-start justify-between gap-3 rounded-lg border px-4 py-3 text-sm ${toneClass}`}
    >
      <span>{children}</span>
      {onDismiss ? (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss message"
          className="shrink-0 text-lg leading-none opacity-60 transition hover:opacity-100"
        >
          &times;
        </button>
      ) : null}
    </div>
  );
}

/**
 * A labelled input.
 *
 * `error` is wired to `aria-invalid` and `aria-describedby`, so the message is
 * announced rather than only coloured.
 */
export function Field({ label, name, error, hint, ...props }) {
  return (
    <div>
      <label className="mb-1 block text-sm font-medium text-slate-700" htmlFor={name}>
        {label}
      </label>
      <input
        id={name}
        name={name}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? `${name}-error` : hint ? `${name}-hint` : undefined}
        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm shadow-sm outline-none transition focus:border-slate-900 focus:ring-2 focus:ring-slate-900/10 disabled:bg-slate-100"
        {...props}
      />
      {error ? (
        <p className="mt-1 text-xs text-rose-600" id={`${name}-error`}>
          {error}
        </p>
      ) : hint ? (
        <p className="mt-1 text-xs text-slate-500" id={`${name}-hint`}>
          {hint}
        </p>
      ) : null}
    </div>
  );
}

/** A labelled select, for the small number of genuine choices. */
export function Select({ label, name, error, children, ...props }) {
  return (
    <div>
      <label className="mb-1 block text-sm font-medium text-slate-700" htmlFor={name}>
        {label}
      </label>
      <select
        id={name}
        name={name}
        aria-invalid={Boolean(error)}
        className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm outline-none transition focus:border-slate-900 focus:ring-2 focus:ring-slate-900/10 disabled:bg-slate-100"
        {...props}
      >
        {children}
      </select>
      {error ? (
        <p className="mt-1 text-xs text-rose-600" id={`${name}-error`}>
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** A label/value pair, for the small summary blocks. */
export function Detail({ label, children }) {
  return (
    <div>
      <dt className="text-xs tracking-wide text-slate-500 uppercase">{label}</dt>
      <dd className="mt-0.5 text-sm text-slate-900">{children}</dd>
    </div>
  );
}

/** A button. `variant` picks between the primary and the quieter actions. */
export function Button({ variant = "primary", isLoading, children, ...props }) {
  const variants = {
    primary:
      "bg-slate-900 text-white hover:bg-slate-700 disabled:hover:bg-slate-900",
    secondary:
      "border border-slate-300 bg-white text-slate-700 hover:border-slate-400 disabled:hover:border-slate-300",
    danger:
      "border border-rose-300 bg-white text-rose-700 hover:border-rose-400 disabled:hover:border-rose-300",
  };

  return (
    <button
      type="button"
      {...props}
      disabled={isLoading || props.disabled}
      className={`rounded-lg px-3 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-60 ${variants[variant]}`}
    >
      {isLoading ? "Working..." : children}
    </button>
  );
}

/**
 * A 1-5 score picker.
 *
 * Rendered as radio inputs rather than a `<select>` because choosing a score is
 * the one decision in the flow where seeing the whole range at once helps, and
 * as real radios so keyboard and screen-reader users get the same control.
 */
export function ScorePicker({ poolId, value, onChange, isLoading, label = "Score" }) {
  return (
    <fieldset disabled={isLoading}>
      <legend className="mb-1 text-sm font-medium text-slate-700">{label}</legend>
      <div className="flex gap-1.5">
        {[1, 2, 3, 4, 5].map((score) => (
          <label
            key={score}
            className={`flex h-9 w-9 cursor-pointer items-center justify-center rounded-lg border text-sm font-semibold transition ${
              value === score
                ? "border-slate-900 bg-slate-900 text-white"
                : "border-slate-300 bg-white text-slate-700 hover:border-slate-400"
            }`}
          >
            <input
              type="radio"
              name={`score-${poolId}`}
              value={score}
              checked={value === score}
              onChange={() => onChange(score)}
              className="sr-only"
            />
            {score}
          </label>
        ))}
      </div>
    </fieldset>
  );
}