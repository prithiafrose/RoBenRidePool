"use client";

import { STATUS_TONES } from "../lib/format";
import { Icon } from "./icons";

/**
 * The presentational pieces both dashboards are built from.
 *
 * They live in one module rather than one file each because they are small,
 * stateless and always used together - a dashboard panel is nearly always a
 * heading, some body, and either a loading line, an empty line or an alert.
 *
 * Sizing and colour are decided here, not at the call site. An earlier version
 * styled buttons and cards inline in each page, which meant the same "Sign out"
 * control was written four slightly different ways and nothing lined up. Every
 * variant now comes from the tables below.
 */

/**
 * Shared class for the text inputs, selects and textareas.
 *
 * The background is deliberately NOT set here. `bg-white` in this string and
 * `bg-rose-50/40` in the error tone would be two competing background-colour
 * utilities, and which one wins is decided by Tailwind's stylesheet order rather
 * than by the order of this concatenation - so the error tint was a coin flip.
 * The tone owns the background instead, and there is only ever one.
 */
const CONTROL_BASE =
  "w-full rounded-lg border text-sm text-slate-900 transition " +
  "placeholder:text-slate-400 focus:border-slate-500 " +
  "disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500";

const CONTROL_TONE = {
  normal: "border-slate-300 bg-white",
  error: "border-rose-400 bg-rose-50/40",
};

/** Shared class for a label above a control. */
const LABEL = "block text-sm font-medium text-slate-700";

/** The message under a control: an error if there is one, otherwise the hint. */
function ControlMessage({ name, error, hint }) {
  if (error) {
    return (
      <p className="mt-1.5 flex items-start gap-1 text-xs text-rose-600" id={`${name}-error`}>
        <Icon name="alert" className="mt-px h-3.5 w-3.5 shrink-0" />
        <span>{error}</span>
      </p>
    );
  }

  if (hint) {
    return (
      <p className="mt-1.5 text-xs text-slate-500" id={`${name}-hint`}>
        {hint}
      </p>
    );
  }

  return null;
}

/** A page title, with an optional description and a right-hand action slot. */
export function PageHeader({ title, description, actions }) {
  return (
    <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{title}</h1>
        {description ? (
          <p className="mt-1.5 max-w-2xl text-sm text-slate-600">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </header>
  );
}

/** The small uppercase label that sits above a block of content. */
export function SectionLabel({ children, className = "" }) {
  return (
    <h2
      className={`text-xs font-semibold tracking-wider text-slate-500 uppercase ${className}`}
    >
      {children}
    </h2>
  );
}

/** A titled card. The unit every dashboard section is built in. */
export function Panel({ title, description, action, children, className = "" }) {
  return (
    <section
      className={`rounded-xl border border-slate-200 bg-white p-6 shadow-card ${className}`}
    >
      {title || description || action ? (
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            {title ? <SectionLabel>{title}</SectionLabel> : null}
            {description ? (
              <p className="mt-1.5 text-sm text-slate-600">{description}</p>
            ) : null}
          </div>
          {action}
        </div>
      ) : null}

      <div className={title || description || action ? "mt-6" : ""}>{children}</div>
    </section>
  );
}

const BUTTON_VARIANTS = {
  primary:
    "bg-slate-900 text-white shadow-card hover:bg-slate-700 active:bg-slate-800",
  secondary:
    "border border-slate-300 bg-white text-slate-700 hover:border-slate-400 hover:bg-slate-50",
  ghost: "text-slate-600 hover:bg-slate-100 hover:text-slate-900",
  danger: "border border-rose-300 bg-white text-rose-700 hover:border-rose-400 hover:bg-rose-50",
  dangerSolid: "bg-rose-600 text-white shadow-card hover:bg-rose-500 active:bg-rose-600",
};

const BUTTON_SIZES = {
  sm: "px-2.5 py-1.5 text-xs gap-1.5",
  md: "px-3.5 py-2 text-sm gap-2",
};

/**
 * A button.
 *
 * `type` defaults to `button` but a caller can override it, which is why the
 * attribute comes before the spread - the form submits use `type="submit"`.
 * An incoming `className` is appended rather than dropped, so a one-off layout
 * tweak is still possible without forking the component.
 */
export function Button({
  variant = "primary",
  size = "md",
  isLoading,
  icon,
  className = "",
  children,
  disabled,
  ...props
}) {
  return (
    <button
      type="button"
      {...props}
      disabled={isLoading || disabled}
      className={`inline-flex items-center justify-center rounded-lg font-medium transition
        disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none
        ${BUTTON_VARIANTS[variant] ?? BUTTON_VARIANTS.primary}
        ${BUTTON_SIZES[size] ?? BUTTON_SIZES.md} ${className}`}
    >
      {isLoading ? <Spinner className="h-3.5 w-3.5" /> : icon ? <Icon name={icon} /> : null}
      {isLoading ? "Working" : children}
    </button>
  );
}

/**
 * A busy indicator. Purely decorative - `aria-hidden`, and deliberately not a live
 * region.
 *
 * Every caller already announces the state in words ("Loading your rides",
 * "Working"), and a spinner that reported itself would nest a live region inside
 * another one, so assistive tech reads the status twice and the spinner's own
 * label masks the sentence that actually says what is happening.
 */
export function Spinner({ className = "h-4 w-4" }) {
  return (
    <span
      aria-hidden="true"
      className={`inline-block shrink-0 animate-spin rounded-full border-2 border-current border-r-transparent align-[-0.125em] ${className}`}
    />
  );
}

/** A loading state, distinct from a real message. */
export function Pending({ label = "Loading" }) {
  return (
    <div
      className="flex items-center justify-center gap-2.5 py-10 text-sm text-slate-500"
      role="status"
    >
      <Spinner />
      {label}...
    </div>
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
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ring-black/5 ${
        STATUS_TONES[value] ?? "bg-slate-100 text-slate-700"
      }`}
    >
      {label ?? value}
    </span>
  );
}

/**
 * A neutral placeholder for a list with nothing in it.
 *
 * `icon` names an entry from the icon set, so an empty list reads as an
 * intentional state rather than a rendering failure.
 */
export function EmptyState({ title, icon = "inbox", children }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-slate-300 bg-slate-50/60 px-6 py-12 text-center">
      <span className="flex h-10 w-10 items-center justify-center rounded-full bg-white text-slate-400 shadow-card">
        <Icon name={icon} className="h-5 w-5" />
      </span>
      <p className="mt-1 text-sm font-medium text-slate-700">{title}</p>
      {children ? (
        <div className="max-w-sm text-sm leading-relaxed text-slate-500">{children}</div>
      ) : null}
    </div>
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

  const tones = {
    error: {
      wrap: "border-rose-200 bg-rose-50 text-rose-800",
      icon: "alert",
    },
    success: {
      wrap: "border-emerald-200 bg-emerald-50 text-emerald-800",
      icon: "check",
    },
    info: {
      wrap: "border-sky-200 bg-sky-50 text-sky-800",
      icon: "info",
    },
  };
  const chosen = tones[tone] ?? tones.error;

  return (
    <div
      role="alert"
      className={`flex items-start justify-between gap-3 rounded-lg border px-4 py-3 text-sm ${chosen.wrap}`}
    >
      <span className="flex items-start gap-2">
        <Icon name={chosen.icon} className="mt-0.5 h-4 w-4 shrink-0" />
        <span>{children}</span>
      </span>
      {onDismiss ? (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss message"
          className="-mt-0.5 -mr-1 shrink-0 rounded p-0.5 opacity-60 transition hover:opacity-100"
        >
          <Icon name="close" className="h-4 w-4" />
        </button>
      ) : null}
    </div>
  );
}

/**
 * A labelled input.
 *
 * `error` is wired to `aria-invalid` and `aria-describedby`, so the message is
 * announced rather than only coloured. The focus ring comes from the base layer
 * in `globals.css` rather than being restated here.
 */
export function Field({ label, name, error, hint, className = "", ...props }) {
  return (
    <div className={className}>
      <label className={`${LABEL} mb-1.5`} htmlFor={name}>
        {label}
      </label>
      <input
        id={name}
        name={name}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? `${name}-error` : hint ? `${name}-hint` : undefined}
        className={`${CONTROL_BASE} ${CONTROL_TONE[error ? "error" : "normal"]} h-10 px-3 ${props.type === "datetime-local" ? "[&::-webkit-calendar-picker-indicator]:opacity-60" : ""}`}
        {...props}
      />
      <ControlMessage name={name} error={error} hint={hint} />
    </div>
  );
}

/** A labelled select, for the small number of genuine choices. */
export function Select({ label, name, error, hint, className = "", children, ...props }) {
  return (
    <div className={className}>
      <label className={`${LABEL} mb-1.5`} htmlFor={name}>
        {label}
      </label>
      <select
        id={name}
        name={name}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? `${name}-error` : hint ? `${name}-hint` : undefined}
        className={`${CONTROL_BASE} ${CONTROL_TONE[error ? "error" : "normal"]} h-10 cursor-pointer px-3`}
        {...props}
      >
        {children}
      </select>
      <ControlMessage name={name} error={error} hint={hint} />
    </div>
  );
}

/** A label/value pair, for the small summary blocks. */
export function Detail({ label, children }) {
  return (
    <div>
      <dt className="text-xs font-medium tracking-wide text-slate-500 uppercase">{label}</dt>
      <dd className="mt-1 text-sm text-slate-900">{children}</dd>
    </div>
  );
}

/**
 * A 1-5 score picker.
 *
 * Rendered as radio inputs rather than a `<select>` because choosing a score is
 * the one decision in the flow where seeing the whole range at once helps, and
 * as real radios so keyboard and screen-reader users get the same control.
 *
 * The radios are `sr-only`, which means the global focus ring lands on a clipped
 * 1px box and is invisible. The ring is therefore repeated on the visible label
 * through `has-[:focus-visible]`, so tabbing through the scale is actually
 * traceable.
 */
export function ScorePicker({ poolId, value, onChange, isLoading, label = "Score" }) {
  return (
    <fieldset disabled={isLoading}>
      <legend className={`${LABEL} mb-1.5`}>{label}</legend>
      <div className="flex gap-1.5">
        {[1, 2, 3, 4, 5].map((score) => (
          <label
            key={score}
            className={`flex h-10 w-10 cursor-pointer items-center justify-center rounded-lg border text-sm font-semibold transition
              has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-slate-900
              ${
                value === score
                  ? "border-slate-900 bg-slate-900 text-white"
                  : "border-slate-300 bg-white text-slate-700 hover:border-slate-400 hover:bg-slate-50"
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