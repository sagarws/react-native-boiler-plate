"use client";

import { useFormik } from "formik";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { PasswordField, TextField } from "@/components/ui/form-field";
import ROUTE_URLS from "@/config/route";
import { SubmitButton } from "@/features/auth/auth-controls";
import { AuthFrame } from "@/features/auth/auth-frame";
import { fieldError, safeRedirect } from "@/features/auth/auth-helpers";
import { authValidation } from "@/features/auth/auth-validation";
import { errorMessage, toast } from "@/lib/events";
import { AuthService } from "@/services/auth-service";
import { useDispatch } from "@/store";
import { setUserProfile } from "@/store/profile-slice";
import type { ILogin } from "@/types/auth";

/** TrackVid `pages/Login.tsx`. */
export function LoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const dispatch = useDispatch();
  const [isLoading, setIsLoading] = useState(false);
  const redirectTo = safeRedirect(searchParams.get("redirect"));

  const formik = useFormik<ILogin>({
    initialValues: { email: "", password: "" },
    validationSchema: authValidation,
    onSubmit: async (value) => {
      setIsLoading(true);
      try {
        const response = await AuthService.login({ email: value.email.trim(), password: value.password });
        dispatch(setUserProfile(response.user));
        toast.success(response.message || "Login Successfully");
        router.replace(redirectTo);
      } catch (error) {
        toast.error(errorMessage(error, "Login failed"));
      } finally {
        setIsLoading(false);
      }
    },
  });

  return (
    <AuthFrame
      title="Welcome back"
      subtitle="Sign in to continue to your TrackVid workspace."
      footer={
        <>
          Don&apos;t have an account? <Link href={ROUTE_URLS.REGISTER}>Sign up</Link>
        </>
      }
      legal="By signing in you agree to TrackVid's Terms of Service and Privacy Policy."
    >
      <form className="tv-auth-form" onSubmit={formik.handleSubmit} noValidate>
        <TextField
          label="Email"
          type="email"
          autoFocus
          autoComplete="email"
          placeholder="you@company.com"
          {...formik.getFieldProps("email")}
          error={fieldError(formik.touched.email, formik.errors.email)}
        />
        <PasswordField
          label="Password"
          autoComplete="current-password"
          placeholder="Enter your password"
          {...formik.getFieldProps("password")}
          error={fieldError(formik.touched.password, formik.errors.password)}
        />
        <div className="tv-auth-row-end">
          <Link href={ROUTE_URLS.FORGOT} className="tv-auth-link">
            Forgot password?
          </Link>
        </div>
        <SubmitButton loading={isLoading}>Sign in</SubmitButton>
      </form>
    </AuthFrame>
  );
}
