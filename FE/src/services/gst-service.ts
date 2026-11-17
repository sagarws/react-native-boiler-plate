import { delay, newId } from "@/mocks/delay";

/**
 * Mock of TrackVid-FE `api/gst-service.ts` (the GST portal captcha proxy). No network: the captcha is a
 * generated SVG data URL and the answer is kept per session in memory.
 */

export interface GstInitResponse {
  captchaImageBase64: string;
  sessionId: string;
  success: boolean;
}

export interface GstVerifyRequest {
  gstin: string;
  captcha: string;
  sessionId: string;
}

export interface GstVerifyResponse {
  success: boolean;
  displayMessage?: string;
  data?: unknown;
}

export interface GstRefreshCaptchaRequest {
  sessionId: string;
  captcha?: string;
}

const GSTIN_RE = /^([0][1-9]|[1-2][0-9]|[3][0-7])([a-zA-Z]{5}[0-9]{4}[a-zA-Z]{1}[1-9a-zA-Z]{1}[zZ]{1}[0-9a-zA-Z]{1})+$/;
const CAPTCHA_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const sessions = new Map<string, string>();

function makeCaptcha(): { text: string; image: string } {
  let text = "";
  for (let i = 0; i < 6; i += 1) text += CAPTCHA_CHARS[Math.floor(Math.random() * CAPTCHA_CHARS.length)];
  const letters = text
    .split("")
    .map((ch, i) => {
      const rotate = Math.round(Math.random() * 30 - 15);
      const x = 14 + i * 22;
      return `<text x="${x}" y="32" transform="rotate(${rotate} ${x} 26)" font-family="monospace" font-size="24" font-weight="700" fill="#5b4a2a">${ch}</text>`;
    })
    .join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="150" height="44"><rect width="150" height="44" rx="6" fill="#f5efe2"/><path d="M4 30 C40 6 80 40 146 14" stroke="#c9a85c" stroke-width="2" fill="none"/>${letters}</svg>`;
  return { text, image: `data:image/svg+xml;base64,${btoa(svg)}` };
}

const gstInit = async (): Promise<GstInitResponse> => {
  await delay(500);
  const sessionId = newId();
  const { text, image } = makeCaptcha();
  sessions.set(sessionId, text);
  return { captchaImageBase64: image, sessionId, success: true };
};

const gstRefreshCaptcha = async (payload: GstRefreshCaptchaRequest): Promise<GstInitResponse> => {
  await delay(400);
  const sessionId = sessions.has(payload.sessionId) ? payload.sessionId : newId();
  const { text, image } = makeCaptcha();
  sessions.set(sessionId, text);
  return { captchaImageBase64: image, sessionId, success: true };
};

const gstVerify = async (payload: GstVerifyRequest): Promise<GstVerifyResponse> => {
  await delay(800);
  const expected = sessions.get(payload.sessionId);
  if (!expected) return { success: false, displayMessage: "Session expired. Refresh the captcha and try again." };
  if (payload.captcha.trim().toUpperCase() !== expected) return { success: false, displayMessage: "Invalid captcha. Please try again." };
  const gstin = payload.gstin.trim().toUpperCase();
  if (!GSTIN_RE.test(gstin)) return { success: false, displayMessage: "Invalid GST number." };
  sessions.delete(payload.sessionId);
  return {
    success: true,
    displayMessage: "GST number verified successfully",
    data: { gstin, legalName: "URBAN THREADS PRIVATE LIMITED", tradeName: "Urban Threads", status: "Active", state: "Gujarat" },
  };
};

export const GstService = { gstInit, gstRefreshCaptcha, gstVerify };
