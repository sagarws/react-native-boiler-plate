// @ts-nocheck
import { readStoredValue, writeStoredValue } from "@/lib/storage";

const defaultProfile = {
  name: "Alex Chen",
  email: "alex@example.com",
  phone: "+1 202 555 0100",
  role: "Store Owner",
  company: "Veylix",
  location: "Brooklyn, New York",
  bio: "Building a store that makes everyday life a little better.",
  photo: "",
};

export function readProfile() {
  const e = readStoredValue("profile", {});
  try {
    return validateProfile({
      ...defaultProfile,
      ...(e && typeof e == "object" && !Array.isArray(e) ? e : {}),
    });
  } catch {
    return {
      ...defaultProfile,
    };
  }
}

function validateProfile(e) {
  const t = Object.fromEntries(
    Object.keys(defaultProfile).map((t) => [t, String(e[t] ?? "").trim()]),
  );
  if (!t.name || t.name.length > 80)
    throw Error("Enter a name between 1 and 80 characters.");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t.email))
    throw Error("Enter a valid email address.");
  if (t.phone && !/^[+\d\s().-]{5,30}$/.test(t.phone))
    throw Error("Enter a valid phone number.");
  for (const e of ["role", "company", "location"])
    if (t[e].length > 100)
      throw Error("Keep profile details under 100 characters.");
  if (t.bio.length > 500) throw Error("Keep your bio under 500 characters.");
  if (
    t.photo &&
    (!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(t.photo) ||
      t.photo.length > 7e5)
  )
    throw Error("Choose a PNG, JPEG or WebP photo under 500 KB.");
  return t;
}

export function saveProfile(e) {
  const t = validateProfile(e);
  if (!writeStoredValue("profile", t))
    throw Error("Browser storage is unavailable. Your profile was not saved.");
  window.dispatchEvent(new CustomEvent("veylix:profile"));
  return t;
}
