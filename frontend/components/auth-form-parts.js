"use client";

import { Alert, Button, Field } from "./ui";
import { Icon } from "./icons";

/**
 * Presentational form pieces shared by the login and register pages.
 *
 * These are thin wrappers over `ui.js` rather than a second set of styles. An
 * earlier version kept its own `inputClass`, `labelClass` and error text, which
 * meant the auth forms were subtly out of step with every other form in the app -
 * a different height, a different error colour, a focus ring that only existed
 * here. Delegating means there is one control style and one focus treatment.
 */

export function FormField({ label, name, error, hint, ...props }) {
  return <Field label={label} name={name} error={error} hint={hint} {...props} />;
}

const ROLES = [
  {
    value: "PASSENGER",
    label: "Passenger",
    hint: "Join a shared ride",
    icon: "user",
  },
  {
    value: "DRIVER",
    label: "Driver",
    hint: "Offer seats and earn",
    icon: "car",
  },
];

/**
 * The passenger-or-driver choice.
 *
 * Two large targets rather than a `<select>`, because it is the one decision on
 * the register form that determines what the account can do, and it is worth
 * showing both consequences. Real radios underneath, so it is still one control
 * to the keyboard rather than a pair of styled divs - and because the radios are
 * `sr-only`, the focus ring is repeated on the label via `has-[:focus-visible]`.
 */
export function RoleSelector({ value, onChange, error, disabled }) {
  return (
    <fieldset disabled={disabled}>
      <legend className="mb-1.5 block text-sm font-medium text-slate-700">
        I want to join as
      </legend>

      <div className="grid grid-cols-2 gap-3">
        {ROLES.map((option) => {
          const isSelected = value === option.value;

          return (
            <label
              key={option.value}
              className={`flex cursor-pointer flex-col gap-1 rounded-lg border px-4 py-3.5 transition
                has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-slate-900
                ${
                  isSelected
                    ? "border-slate-900 bg-slate-900 text-white"
                    : "border-slate-300 bg-white text-slate-700 hover:border-slate-400 hover:bg-slate-50"
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

              <span className="flex items-center gap-2">
                <Icon name={option.icon} className="h-4 w-4" />
                <span className="text-sm font-semibold">{option.label}</span>
              </span>
              <span
                className={`text-xs ${isSelected ? "text-slate-300" : "text-slate-500"}`}
              >
                {option.hint}
              </span>
            </label>
          );
        })}
      </div>

      {error ? (
        <p className="mt-1.5 flex items-start gap-1 text-xs text-rose-600">
          <Icon name="alert" className="mt-px h-3.5 w-3.5 shrink-0" />
          <span>{error}</span>
        </p>
      ) : null}
    </fieldset>
  );
}

export function FormAlert({ children }) {
  return <Alert tone="error">{children}</Alert>;
}

export function SubmitButton({ isLoading, children }) {
  return (
    <Button type="submit" isLoading={isLoading} className="w-full py-2.5 font-semibold">
      {children}
    </Button>
  );
}