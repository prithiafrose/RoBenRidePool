"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { FormAlert, FormField, SubmitButton } from "../../components/auth-form-parts";
import { useAuthForm } from "../../hooks/use-auth-form";
import { loginRequest } from "../../lib/api";
import { saveSession } from "../../lib/auth-storage";

export default function LoginPage() {
  const router = useRouter();
  const { values, errors, formError, isLoading, handleChange, submit } = useAuthForm({
    email: "",
    password: "",
  });
  const [successMessage, setSuccessMessage] = useState("");

  const onSubmit = async (event) => {
    event.preventDefault();

    const data = await submit(loginRequest);

    if (!data) return;

    saveSession(data);
    setSuccessMessage(`Welcome back, ${data.user.name}. Taking you to the dashboard...`);
    router.push("/");
  };

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center px-6 py-16">
      <div className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <p className="text-xs font-semibold tracking-widest text-slate-500 uppercase">
          RoBen RidePool
        </p>
        <h1 className="mt-2 text-2xl font-bold tracking-tight">Sign in</h1>
        <p className="mt-2 text-sm text-slate-600">
          Access your rides as a passenger or driver.
        </p>

        <form className="mt-6 space-y-4" onSubmit={onSubmit} noValidate>
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
            autoComplete="current-password"
            placeholder="Your password"
            value={values.password}
            onChange={handleChange}
            error={errors.password}
            disabled={isLoading}
          />

          <FormAlert>{formError}</FormAlert>

          {successMessage ? (
            <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
              {successMessage}
            </p>
          ) : null}

          <SubmitButton isLoading={isLoading}>Sign in</SubmitButton>
        </form>

        <p className="mt-6 text-center text-sm text-slate-600">
          New to RidePool?{" "}
          <Link href="/register" className="font-medium text-slate-900 underline">
            Create an account
          </Link>
        </p>
      </div>
    </main>
  );
}
