import { INVITED_COMPANY, TAKEN_EMAIL_PREFIX, impersonatedUser } from "@/mocks/auth";
import { clone, delay, newId } from "@/mocks/delay";
import { sampleUser } from "@/mocks/user";
import { SessionStore } from "@/services/session";
import type { AddDataUserPayload, ImpersonationResponse, IRegister, UploadLogoResponse, VerifyUserPayload, VerifyUserResponse } from "@/types/auth";
import type { IUser, MessageResponse } from "@/types/common";

/** Mock of TrackVid-FE `api/auth-service.ts`. Same function names; no network. Rules: see `@/mocks/auth`. */

export interface LoginPayload {
  email: string;
  password: string;
}
export interface LoginResponse {
  token: string;
  user: IUser;
  message: string;
}

function fail(message: string): never {
  throw new Error(message);
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const login = async (payload: LoginPayload): Promise<LoginResponse> => {
  await delay(600);
  const email = payload.email.trim().toLowerCase();
  if (!EMAIL_RE.test(email)) fail("Enter a valid email address.");
  if (payload.password.length < 6) fail("Invalid email or password.");
  const token = `mock.${btoa(email)}.${Date.now()}`;
  SessionStore.setToken(token);
  SessionStore.setImpersonator(null);
  return { token, user: clone(sampleUser), message: "Login Successfully" };
};

/** TrackVid `registerAdmin` payload: the sign-up form plus an optional referral code from `?ref=`. */
export type RegisterPayload = IRegister & { referralCode?: string };

const register = async (payload: RegisterPayload): Promise<MessageResponse> => {
  await delay(800);
  if (payload.email.trim().toLowerCase().startsWith(TAKEN_EMAIL_PREFIX)) fail("This email is already registered.");
  return { message: "Registration successful. We have sent a verification link to your email, verify it to log in." };
};

/** TrackVid uploads the logo before sign-up; the server creates the company and returns its id. */
const uploadFile = async (file: File): Promise<UploadLogoResponse> => {
  await delay(700);
  if (!file.type.startsWith("image/") || file.type === "image/svg+xml") fail("Please select a valid image file (jpg, png, gif).");
  if (file.size > 5 * 1024 * 1024) fail("Image must be 5 MB or smaller.");
  return { _id: newId(), fileKey: `logo/${file.name}`, fileName: file.name, url: "", message: "Image uploaded successfully" };
};

const createFolder = async (payload: { name: string }): Promise<MessageResponse> => {
  await delay();
  return { message: `Folder "${payload.name}" created.` };
};

const forgotPassword = async (payload: { email: string }): Promise<MessageResponse> => {
  await delay(600);
  if (!EMAIL_RE.test(payload.email.trim())) fail("Enter a valid email address.");
  return { message: "Password reset link sent to your email." };
};

const resetPassword = async (payload: { token: string | null; password: string }): Promise<MessageResponse> => {
  await delay(600);
  if (!payload.token || payload.token.includes("expired")) fail("Reset link is invalid or has expired.");
  return { message: "Password reset successfully" };
};

/** TrackVid sends `currentPassword`; `oldPassword` is accepted too for older callers. */
const changePassword = async (payload: {
  currentPassword?: string;
  oldPassword?: string;
  newPassword: string;
}): Promise<MessageResponse & { accessToken: string }> => {
  await delay(600);
  const current = payload.currentPassword ?? payload.oldPassword ?? "";
  if (current.length < 6) fail("Current password is incorrect.");
  if (current === payload.newPassword) fail("New password must be different from current password");
  // A password change ends every other session; carry on with the fresh token (same as TrackVid).
  const accessToken = `mock.${Date.now()}.rotated`;
  SessionStore.setToken(accessToken);
  return { message: "Password changed successfully.", accessToken };
};

const logout = async (): Promise<MessageResponse> => {
  await delay(200);
  SessionStore.clear();
  return { message: "Logged out" };
};

/** `POST /auth/register-with-token`. */
const registerUser = async (payload: { token: string | null; name?: { firstName: string; lastName: string }; password?: string }): Promise<MessageResponse> => {
  await delay(700);
  if (!payload.token || payload.token.includes("expired")) fail("Invitation link is invalid or has expired.");
  return { message: "Account created. You can sign in now." };
};

/** Feed user payload as TrackVid's Feed screen sends it (`email` kept for older callers). */
export interface FeedUserPayload {
  name?: { firstName: string; lastName: string };
  userId?: string;
  password?: string;
  feedId?: string;
  email?: string;
  _id?: string;
}

const addFeedUser = async (payload: FeedUserPayload): Promise<MessageResponse> => {
  await delay();
  const who = payload.userId ?? payload.email;
  return { message: who ? `Feed user ${who} added.` : "Feed user added." };
};

const editFeedUser = async (payload: FeedUserPayload): Promise<MessageResponse> => {
  await delay();
  const who = payload.userId ?? payload.email;
  return { message: who ? `Feed user ${who} updated.` : "Feed user updated." };
};

const reSendInvitation = async (payload: { email: string | null }): Promise<MessageResponse> => {
  await delay(700);
  if (!payload.email) fail("Email is required");
  return { message: `Invitation sent again to ${payload.email}.` };
};

const verifyUser = async (payload: VerifyUserPayload): Promise<VerifyUserResponse> => {
  await delay(700);
  const token = payload.token ?? "";
  if (!token) fail("Invalid token");
  if (token.includes("expired")) fail("Token expired");
  if (token.includes("verified")) fail("User already verified");
  const email = payload.email ?? "riya@urbanthreads.in";
  return {
    message: "User verified successfully",
    email,
    companyName: INVITED_COMPANY,
    isAdmin: email.toLowerCase().startsWith("admin"),
  };
};

export interface GstDetails {
  gstin: string;
  legalName: string;
  tradeName: string;
  status: string;
  address: string;
  state: string;
  pincode: string;
}

const verifyGst = async (payload: { gst_number?: string; gstNumber?: string }): Promise<GstDetails> => {
  await delay(800);
  const gst = (payload.gst_number ?? payload.gstNumber ?? "").trim().toUpperCase();
  if (!/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(gst)) fail("Enter a valid 15-character GSTIN.");
  return {
    gstin: gst,
    legalName: "URBAN THREADS PRIVATE LIMITED",
    tradeName: "Urban Threads",
    status: "Active",
    address: "Plot 14, Textile Market, Ring Road",
    state: "Gujarat",
    pincode: "395002",
  };
};

/**
 * Mock of `POST /auth/add-data-user` (TrackVid `ManageUserService.addDataUser`), the sub-user sign-up
 * from an invitation link. Kept here so the auth route does not depend on the users route's service.
 */
const addDataUser = async (payload: AddDataUserPayload): Promise<MessageResponse> => {
  await delay(800);
  if (!payload.token || payload.token.includes("expired")) fail("Invitation link is invalid or has expired.");
  return { message: "Registration successful. You can now log in with your email and password." };
};

/**
 * Mock of `GET /api/system-admin/:userId` (TrackVid `Impersonate.tsx` calls it with axios directly).
 * Does not touch the session; the page stores the token like `LocalStorageService.loginUser`.
 */
const impersonate = async (userId: string): Promise<ImpersonationResponse> => {
  await delay(900);
  if (!/^[a-f0-9]{24}$/i.test(userId)) fail("User not found");
  return { accessToken: `mock.impersonate.${userId}.${Date.now()}`, user: impersonatedUser(userId), message: "Login Successfully" };
};

export const AuthService = {
  login,
  register,
  uploadFile,
  forgotPassword,
  resetPassword,
  changePassword,
  logout,
  registerUser,
  createFolder,
  addFeedUser,
  reSendInvitation,
  verifyUser,
  editFeedUser,
  verifyGst,
  addDataUser,
  impersonate,
};
