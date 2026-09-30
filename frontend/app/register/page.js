"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";

import { AuthShell } from "../../components/auth-shell";
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

  const onSubmit = async (event) => {
    event.preventDefault();

    const data = await submit(registerRequest);

    if (!data) return;

    saveSession(data);
    router.replace("/dashboard");
  };

  return (
    <AuthShell
      wide
      title="Create your account"
      description="Join as a passenger to share rides, or as a driver to earn."
      footer={
        <>
          Already have an account?{" "}
          <Link href="/login" className="font-medium text-slate-900 underline underline-offset-4">
            Sign in
          </Link>
        </>
      }
    >
      <form className="space-y-4" onSubmit={onSubmit} noValidate>
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

        <SubmitButton isLoading={isLoading}>Create account</SubmitButton>
      </form>
    </AuthShell>
  );
}