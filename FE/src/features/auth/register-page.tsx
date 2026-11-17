"use client";

import { useFormik } from "formik";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useRef, useState } from "react";
import { PasswordField, TextField } from "@/components/ui/form-field";
import { PhoneField } from "@/components/ui/phone-field";
import ROUTE_URLS from "@/config/route";
import { CompanyLogoUploader, SubmitButton } from "@/features/auth/auth-controls";
import { AuthFrame } from "@/features/auth/auth-frame";
import { DEFAULT_PHONE, fieldError } from "@/features/auth/auth-helpers";
import { registerValidation } from "@/features/auth/auth-validation";
import { errorMessage, toast } from "@/lib/events";
import { AuthService, type RegisterPayload } from "@/services/auth-service";
import type { IRegister } from "@/types/auth";

/** TrackVid `pages/Register.tsx`: one-step sign-up (no GST, no plans), optional logo, `?email=` and `?ref=`. */
export function RegisterPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const invitedEmail = searchParams.get("email");
  const referralCodeFromUrl = searchParams.get("ref")?.trim().toUpperCase() || "";

  const [imageUrl, setImageUrl] = useState("");
  const [logoUploading, setLogoUploading] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  // Sync guard: Enter in any field re-submits the form even while the button is disabled.
  const registerInFlight = useRef(false);
  // A logo still uploading has no companyId yet; registering now would orphan the uploaded company.
  const logoUploadInFlight = useRef(false);

  const formik = useFormik<IRegister>({
    initialValues: {
      name: { firstName: "", lastName: "" },
      email: invitedEmail ?? "",
      password: "",
      confirmPassword: "",
      company: { name: "" },
      phone: DEFAULT_PHONE,
    },
    validationSchema: registerValidation,
    onSubmit: async (value) => {
      if (logoUploadInFlight.current) {
        toast.error("Please wait for the logo to finish uploading");
        return;
      }
      if (registerInFlight.current) return;
      registerInFlight.current = true;
      setIsLoading(true);
      // Copy phone rather than mutate form state, so a retry sends the same number.
      const payload: RegisterPayload = { ...value, phone: { ...value.phone, number: value.phone.number.trim() } };
      if (referralCodeFromUrl) payload.referralCode = referralCodeFromUrl;
      try {
        const response = await AuthService.register(payload);
        toast(response.message);
        router.push(ROUTE_URLS.LOGIN);
      } catch (error) {
        toast.error(errorMessage(error, "Registration failed"));
      } finally {
        registerInFlight.current = false;
        setIsLoading(false);
      }
    },
  });

  const handleLogo = async (file: File) => {
    logoUploadInFlight.current = true;
    setLogoUploading(true);
    try {
      const response = await AuthService.uploadFile(file);
      void formik.setFieldValue("company.companyId", response._id);
      // Optimistic preview from the local file (the server-side key is not usable before sign-up).
      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result === "string") setImageUrl(reader.result);
      };
      reader.readAsDataURL(file);
      toast.success(response.message || "Image uploaded successfully");
    } catch (error) {
      toast.error(errorMessage(error, "Image upload failed"));
    } finally {
      logoUploadInFlight.current = false;
      setLogoUploading(false);
    }
  };

  const { touched, errors } = formik;

  return (
    <AuthFrame
      wide
      title="Create your TrackVid account"
      subtitle="Tell us about you and your company — it takes under a minute."
      footer={
        <>
          Already have an account? <Link href={ROUTE_URLS.LOGIN}>Sign in</Link>
        </>
      }
    >
      <form className="tv-auth-form" onSubmit={formik.handleSubmit} noValidate>
        <div className="tv-auth-grid-2">
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
        </div>
        <TextField
          label="Email"
          type="email"
          placeholder="you@company.com"
          autoComplete="email"
          disabled={Boolean(invitedEmail)}
          {...formik.getFieldProps("email")}
          error={fieldError(touched.email, errors.email)}
        />
        <PhoneField
          label="Mobile Number"
          value={formik.values.phone}
          onChange={(phone) => {
            // TrackVid ignores input past 10 national digits.
            if (phone.number.length > 10) return;
            void formik.setFieldValue("phone", phone);
          }}
          error={fieldError(touched.phone?.number, errors.phone?.number)}
        />
        <div className="tv-auth-company">
          <CompanyLogoUploader imageUrl={imageUrl} onChange={(file) => void handleLogo(file)} isLoading={logoUploading} />
          <TextField
            label="Company Name"
            placeholder="Acme Retail Pvt Ltd"
            autoComplete="organization"
            fieldClassName="tv-auth-grow"
            {...formik.getFieldProps("company.name")}
            error={fieldError(touched.company?.name, errors.company?.name)}
          />
        </div>
        <PasswordField
          label="Password"
          placeholder="Create a strong password"
          autoComplete="new-password"
          {...formik.getFieldProps("password")}
          error={fieldError(touched.password, errors.password)}
        />
        <PasswordField
          label="Confirm Password"
          placeholder="Re-enter your password"
          autoComplete="new-password"
          {...formik.getFieldProps("confirmPassword")}
          error={fieldError(touched.confirmPassword, errors.confirmPassword)}
        />
        <SubmitButton loading={isLoading} disabled={logoUploading}>
          Create account
        </SubmitButton>
      </form>
    </AuthFrame>
  );
}
