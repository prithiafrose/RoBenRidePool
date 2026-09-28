"use client";

/** Shared input styling for every auth form field. */
const inputClass =
  "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm shadow-sm outline-none transition focus:border-slate-900 focus:ring-2 focus:ring-slate-900/10 disabled:bg-slate-100";

const labelClass = "mb-1 block text-sm font-medium text-slate-700";

const fieldErrorClass = "mt-1 text-xs text-rose-600";

/**
 * Presentational form pieces shared by the login and register pages. Keeping
 * them here avoids duplicating the loading / error markup twice.
 */
export function FormField({ label, name, type = "text", value, onChange, error, ...props }) {
  return (
    <div>
      <label className={labelClass} htmlFor={name}>
        {label}
      </label>
      <input
        id={name}
        name={name}
        type={type}
        value={value}
        onChange={onChange}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? `${name}-error` : undefined}
        className={inputClass}
        {...props}
      />
      {error ? (
        <p className={fieldErrorClass} id={`${name}-error`}>
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function RoleSelector({ value, onChange, error, disabled }) {
  const options = [
    { value: "PASSENGER", label: "Passenger", hint: "Join a shared ride" },
    { value: "DRIVER", label: "Driver", hint: "Offer seats and earn" },
  ];

  return (
    <fieldset disabled={disabled}>
      <legend className={labelClass}>I want to join as</legend>
      <div className="grid grid-cols-2 gap-3">
        {options.map((option) => {
          const isSelected = value === option.value;

          return (
            <label
              key={option.value}
              className={`cursor-pointer rounded-lg border px-4 py-3 transition ${
                isSelected
                  ? "border-slate-900 bg-slate-900 text-white"
                  : "border-slate-300 bg-white text-slate-700 hover:border-slate-400"
              } ${disabled ? "cursor-not-allowed opacity-60" : ""}`}
            >
              <input
                type="radio"
                name="role"
                value={option.value}
                checked={isSelected}
                onChange={() => onChange(option.value)}
                className="sr-only"
              />
              <span className="block text-sm font-semibold">{option.label}</span>
              <span
                className={`block text-xs ${isSelected ? "text-slate-300" : "text-slate-500"}`}
              >
                {option.hint}
              </span>
            </label>
          );
        })}
      </div>
      {error ? <p className={fieldErrorClass}>{error}</p> : null}
    </fieldset>
  );
}

export function FormAlert({ children }) {
  if (!children) return null;

  return (
    <div
      role="alert"
      className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700"
    >
      {children}
    </div>
  );
}

export function SubmitButton({ isLoading, children }) {
  return (
    <button
      type="submit"
      disabled={isLoading}
      className="w-full rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {isLoading ? "Please wait..." : children}
    </button>
  );
}
