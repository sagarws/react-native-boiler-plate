"use client";

import { useFormik } from "formik";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { PasswordField, TextField } from "@/components/ui/form-field";
import { PhoneField } from "@/components/ui/phone-field";
import ROUTE_URLS from "@/config/route";
import { SubmitButton } from "@/features/auth/auth-controls";
import { AuthFrame } from "@/features/auth/auth-frame";
import { DEFAULT_PHONE, fieldError } from "@/features/auth/auth-helpers";
import { subUserRegisterValidation } from "@/features/auth/auth-validation";
import { errorMessage, toast } from "@/lib/events";
import { AuthService } from "@/services/auth-service";
import type { ISubUseRegister } from "@/types/auth";

/**
 * TrackVid `pages/SubUserRegister.tsx`: an invited user finishes sign-up (reached from `/auth/invitation`
 * with `?email=&token=`). A missing or expired token fails on submit with the server message, like TrackVid.
 */
export function SubUserRegisterPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const invitedEmail = searchParams.get("email");
  const token = searchParams.get("token");
  const [isLoading, setIsLoading] = useState(false);

  const formik = useFormik<ISubUseRegister>({
    initialValues: {
      name: { firstName: "", lastName: "" },
      email: invitedEmail ?? "",
      password: "",
      confirmPassword: "",
      phone: DEFAULT_PHONE,
    },
    validationSchema: subUserRegisterValidation,
    onSubmit: async (value) => {
      setIsLoading(true);
      try {
        const response = await AuthService.addDataUser({ ...value, phone: { ...value.phone }, token });
        toast(response.message);
        router.push(ROUTE_URLS.LOGIN);
      } catch (error) {
        toast.error(errorMessage(error, "Registration failed"));
      } finally {
        setIsLoading(false);
      }
    },
  });

  const { touched, errors } = formik;

  return (
    <AuthFrame title="Personal Details" subtitle="Finish setting up your account to join your team on TrackVid.">
      <form className="tv-auth-form" onSubmit={formik.handleSubmit} noValidate>
        <TextField
          label="First Name"
          placeholder="John"
          autoComplete="given-name"
          {...formik.getFieldProps("name.firstName")}
          error={fieldError(touched.name?.firstName, errors.name?.firstName)}
        />
        <TextField
          label="Last Name"
          placeholder="Doe"
          autoComplete="family-name"
          {...formik.getFieldProps("name.lastName")}
          error={fieldError(touched.name?.lastName, errors.name?.lastName)}
        />
        <TextField
          label="Email"
          type="email"
          placeholder="test@gmail.com"
          autoComplete="email"
          disabled={Boolean(invitedEmail)}
          {...formik.getFieldProps("email")}
          error={fieldError(touched.email, errors.email)}
        />
        <PasswordField
          label="Password"
          placeholder="Enter your password"
          autoComplete="new-password"
          {...formik.getFieldProps("password")}
          error={fieldError(touched.password, errors.password)}
        />
        <PasswordField
          label="Confirm Password"
          placeholder="Confirm your password"
          autoComplete="new-password"
          {...formik.getFieldProps("confirmPassword")}
          error={fieldError(touched.confirmPassword, errors.confirmPassword)}
        />
        <PhoneField
          label="Mobile Number"
          value={formik.values.phone}
          onChange={(phone) => void formik.setFieldValue("phone", phone)}
          error={fieldError(touched.phone?.number, errors.phone?.number)}
        />
        <SubmitButton loading={isLoading}>Register</SubmitButton>
      </form>
    </AuthFrame>
  );
}
