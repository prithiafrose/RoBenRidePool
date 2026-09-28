"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import {
  FormAlert,
  FormField,
  RoleSelector,
  SubmitButton,
} from "../../components/auth-form-parts";
import { useAuthForm } from "../../hooks/use-auth-form";
import { registerRequest } from "../../lib/api";
import { saveSession } from "../../lib/auth-storage";

export default function RegisterPage() {
  const router = useRouter();
  const { values, errors, formError, isLoading, handleChange, submit } = useAuthForm({
    name: "",
    email: "",
    password: "",
    role: "PASSENGER",
  });
  const [successMessage, setSuccessMessage] = useState("");

  const onSubmit = async (event) => {
    event.preventDefault();

    const data = await submit(registerRequest);

    if (!data) return;

    saveSession(data);
    setSuccessMessage(
      `Account created for ${data.user.email}. Taking you to the dashboard...`,
    );
    router.push("/");
  };

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center px-6 py-16">
      <div className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <p className="text-xs font-semibold tracking-widest text-slate-500 uppercase">
          RoBen RidePool
        </p>
        <h1 className="mt-2 text-2xl font-bold tracking-tight">Create your account</h1>
        <p className="mt-2 text-sm text-slate-600">
          Join as a passenger to share rides, or as a driver to earn.
        </p>

        <form className="mt-6 space-y-4" onSubmit={onSubmit} noValidate>
          <FormField
            label="Full name"
            name="name"
            autoComplete="name"
            placeholder="Ada Lovelace"
            value={values.name}
            onChange={handleChange}
            error={errors.name}
            disabled={isLoading}
          />

          <FormField
            label="Email"
            name="email"
            type="email"
            autoComplete="email"
            placeholder="ada@example.com"
            value={values.email}
            onChange={handleChange}
            error={errors.email}
            disabled={isLoading}
          />

          <FormField
            label="Password"
            name="password"
            type="password"
            autoComplete="new-password"
            placeholder="At least 8 characters, one letter and one number"
            value={values.password}
            onChange={handleChange}
            error={errors.password}
            disabled={isLoading}
          />

          <RoleSelector
            value={values.role}
            onChange={(role) => handleChange({ target: { name: "role", value: role } })}
            error={errors.role}
            disabled={isLoading}
          />

          <FormAlert>{formError}</FormAlert>

          {successMessage ? (
            <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
              {successMessage}
            </p>
          ) : null}

          <SubmitButton isLoading={isLoading}>Create account</SubmitButton>
        </form>

        <p className="mt-6 text-center text-sm text-slate-600">
          Already have an account?{" "}
          <Link href="/login" className="font-medium text-slate-900 underline">
            Sign in
          </Link>
        </p>
      </div>
    </main>
  );
}
