import * as yup from "yup";

/** Port of TrackVid-FE `validations/auth-validation.ts` (auth screens only). Messages are unchanged. */

const PASSWORD_RULE = /^(?=.*[a-z])(?=.*[0-9])(?=.*[-!@#$%^&*])(?=.{8,})/;
const PASSWORD_MESSAGE = "Must Contain 8 Characters, One Lowercase, One Number and One Special Case Character";

const email = () => yup.string().required("Email is required").email("Enter a valid email").trim();
const password = () => yup.string().required("Password is required").trim().matches(PASSWORD_RULE, PASSWORD_MESSAGE);
const confirmPassword = () =>
  yup
    .string()
    .required("Confirm Password is required")
    .trim()
    .oneOf([yup.ref("password")], "Password must match");

const phone = () =>
  yup.object().shape({
    code: yup.string().required("Code is required"),
    number: yup.string().required("Number is required").trim(),
    countryCode: yup.string().required("Country Code is required"),
  });

const name = () =>
  yup.object().shape({
    firstName: yup.string().required("First Name is required").trim(),
    lastName: yup.string().required("Last Name is required").trim(),
  });

export const authValidation = yup.object({
  email: email(),
  password: password(),
});

export const registerValidation = yup.object().shape({
  name: name(),
  email: email(),
  password: password(),
  confirmPassword: confirmPassword(),
  company: yup.object().shape({
    name: yup.string().trim().required("Company name is required"),
  }),
  phone: phone(),
});

// Invited sub-users join an existing company, so their form has no company field.
export const subUserRegisterValidation = registerValidation.omit(["company"]);

export const forgotPasswordValidation = yup.object().shape({
  email: email(),
});

export const resetPasswordValidation = yup.object().shape({
  password: password(),
  confirmPassword: confirmPassword(),
});
