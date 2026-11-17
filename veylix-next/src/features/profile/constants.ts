// @ts-nocheck

export const profileFormFields = [
  {
    key: "name",
    label: "Full name",
    type: "text",
    required: true,
    maxLength: 100,
  },
  {
    key: "email",
    label: "Email address",
    type: "email",
    required: true,
    maxLength: 100,
  },
  {
    key: "phone",
    label: "Phone number",
    type: "tel",
    maxLength: 100,
  },
  {
    key: "role",
    label: "Job title",
    type: "text",
    maxLength: 100,
  },
  {
    key: "company",
    label: "Company",
    type: "text",
    maxLength: 100,
  },
  {
    key: "location",
    label: "Location",
    type: "text",
    maxLength: 100,
  },
];

export const profilePhotoRules = {
  acceptedMimeTypes: ["image/png", "image/jpeg", "image/webp"],
  accept: "image/png,image/jpeg,image/webp",
  maximumBytes: 512e3,
  helpText: "PNG, JPEG or WebP · up to 500 KB",
  errorText: "Choose a PNG, JPEG or WebP photo under 500 KB.",
};
