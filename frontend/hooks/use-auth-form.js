"use client";

import { useState } from "react";

import { ApiError } from "../lib/api";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Small form-state helper shared by the login and register pages. It handles
 * the three states the UI needs: loading, field validation errors, and API
 * errors. The API re-validates everything with Zod, so this is only about
 * fast feedback.
 */
export function useAuthForm(initialValues) {
  const [values, setValues] = useState(initialValues);
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const handleChange = (event) => {
    const { name, value } = event.target;
    setValues((current) => ({ ...current, [name]: value }));
    setErrors((current) => ({ ...current, [name]: undefined }));
    setFormError("");
  };

  const validate = () => {
    const found = {};

    if ("name" in values) {
      if (!values.name.trim() || values.name.trim().length < 2) {
        found.name = "Name must be at least 2 characters";
      }
    }

    if (!values.email.trim() || !EMAIL_PATTERN.test(values.email.trim())) {
      found.email = "Enter a valid email address";
    }

    if ("password" in values) {
      if (values.password.length < 8) {
        found.password = "Password must be at least 8 characters";
      } else if (!/[A-Za-z]/.test(values.password) || !/[0-9]/.test(values.password)) {
        found.password = "Use at least one letter and one number";
      }
    }

    if ("role" in values && !values.role) {
      found.role = "Choose whether you are a passenger or a driver";
    }

    setErrors(found);
    return Object.keys(found).length === 0;
  };

  /** Runs the request with consistent loading and error handling. */
  const submit = async (request) => {
    if (!validate()) return null;

    setIsLoading(true);
    setFormError("");

    try {
      return await request(values);
    } catch (error) {
      if (error instanceof ApiError) {
        if (error.details.length > 0) {
          setErrors(error.fieldErrors);
        } else {
          setFormError(error.message);
        }
      } else {
        setFormError("Something went wrong. Please try again.");
      }

      return null;
    } finally {
      setIsLoading(false);
    }
  };

  return { values, errors, formError, isLoading, handleChange, submit };
}
