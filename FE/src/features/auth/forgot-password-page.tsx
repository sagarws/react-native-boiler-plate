"use client";

import { useFormik } from "formik";
import Link from "next/link";
import { useState } from "react";
import { Icon } from "@/components/icons/icon";
import { TextField } from "@/components/ui/form-field";
import ROUTE_URLS from "@/config/route";
import { SubmitButton } from "@/features/auth/auth-controls";
import { AuthFrame } from "@/features/auth/auth-frame";
import { fieldError } from "@/features/auth/auth-helpers";
import { forgotPasswordValidation } from "@/features/auth/auth-validation";
import { errorMessage, toast } from "@/lib/events";
import { AuthService } from "@/services/auth-service";

/** TrackVid `pages/ForgotPassword.tsx`: sends a reset link and stays on the page. */
export function ForgotPasswordPage() {
  const [isLoading, setIsLoading] = useState(false);

  const formik = useFormik<{ email: string }>({
    initialValues: { email: "" },
    validationSchema: forgotPasswordValidation,
    onSubmit: async (value) => {
      setIsLoading(true);
      try {
        const response = await AuthService.forgotPassword({ email: value.email.trim() });
        toast.success(response.message || "Email sent successfully");
      } catch (error) {
        toast.error(errorMessage(error, "Email sent failed"));
      } finally {
        setIsLoading(false);
      }
    },
  });

  return (
    <AuthFrame
      title="Forgot Password"
      subtitle="Enter your account email and we will send you a link to reset your password."
      footer={
        <Link href={ROUTE_URLS.LOGIN} className="tv-auth-back">
          <Icon name="arrow-left" /> Back to Login
        </Link>
      }
    >
      <form className="tv-auth-form" onSubmit={formik.handleSubmit} noValidate>
        <TextField
          label="Email"
          type="email"
          placeholder="Email"
          autoComplete="email"
          autoFocus
          {...formik.getFieldProps("email")}
          error={fieldError(formik.touched.email, formik.errors.email)}
        />
        <SubmitButton loading={isLoading}>Submit</SubmitButton>
      </form>
    </AuthFrame>
  );
}
