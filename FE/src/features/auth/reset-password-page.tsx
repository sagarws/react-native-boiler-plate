"use client";

import { useFormik } from "formik";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { Icon } from "@/components/icons/icon";
import { PasswordField } from "@/components/ui/form-field";
import ROUTE_URLS from "@/config/route";
import { SubmitButton } from "@/features/auth/auth-controls";
import { AuthFrame } from "@/features/auth/auth-frame";
import { fieldError } from "@/features/auth/auth-helpers";
import { resetPasswordValidation } from "@/features/auth/auth-validation";
import { errorMessage, toast } from "@/lib/events";
import { AuthService } from "@/services/auth-service";

/**
 * TrackVid `pages/ResetPassword.tsx`: `?token=` from the email link. A missing or expired token is rejected
 * by the server on submit and shown as an error toast (TrackVid has no separate error screen).
 */
export function ResetPasswordPage() {
  const router = useRouter();
  const token = useSearchParams().get("token");
  const [isLoading, setIsLoading] = useState(false);

  const formik = useFormik<{ password: string; confirmPassword: string }>({
    initialValues: { password: "", confirmPassword: "" },
    validationSchema: resetPasswordValidation,
    onSubmit: async (value) => {
      setIsLoading(true);
      try {
        const response = await AuthService.resetPassword({ password: value.password, token });
        router.push(ROUTE_URLS.LOGIN);
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
      title="Reset Password"
      subtitle="Choose a new password for your TrackVid account."
      footer={
        <Link href={ROUTE_URLS.LOGIN} className="tv-auth-back">
          <Icon name="arrow-left" /> Back to Login
        </Link>
      }
    >
      <form className="tv-auth-form" onSubmit={formik.handleSubmit} noValidate>
        <PasswordField
          label="Password"
          placeholder="Password"
          autoComplete="new-password"
          autoFocus
          {...formik.getFieldProps("password")}
          error={fieldError(formik.touched.password, formik.errors.password)}
        />
        <PasswordField
          label="Confirm Password"
          placeholder="Confirm Password"
          autoComplete="new-password"
          {...formik.getFieldProps("confirmPassword")}
          error={fieldError(formik.touched.confirmPassword, formik.errors.confirmPassword)}
        />
        <SubmitButton loading={isLoading}>Submit</SubmitButton>
      </form>
    </AuthFrame>
  );
}
