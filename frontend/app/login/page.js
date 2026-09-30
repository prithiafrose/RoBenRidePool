"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";

import { AuthShell } from "../../components/auth-shell";
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

  const onSubmit = async (event) => {
    event.preventDefault();

    const data = await submit(loginRequest);

    if (!data) return;

    saveSession(data);
    router.replace("/dashboard");
  };

  return (
    <AuthShell
      title="Sign in"
      description="Access your rides as a passenger or driver."
      footer={
        <>
          New to RidePool?{" "}
          <Link href="/register" className="font-medium text-slate-900 underline underline-offset-4">
            Create an account
          </Link>
        </>
      }
    >
      <form className="space-y-4" onSubmit={onSubmit} noValidate>
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

        <SubmitButton isLoading={isLoading}>Sign in</SubmitButton>
      </form>
    </AuthShell>
  );
}