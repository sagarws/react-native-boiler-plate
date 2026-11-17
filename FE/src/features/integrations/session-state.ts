import type { StatusTone } from "@/components/ui/status-pill";
import type { CredentialSession } from "@/types/integrations";

/**
 * Three states, not two (TrackVid `sessionState`): an expired session is one Renew away, a missing one
 * usually means the login never worked, and a session without a recorded expiry may work but we can't say.
 */
export function sessionState(session: CredentialSession | null): { label: string; tone: StatusTone | "neutral" } {
  if (!session) return { label: "No session", tone: "neutral" };
  if (!session.expiresAt) return { label: "Unknown expiry", tone: "neutral" };
  return new Date(session.expiresAt).getTime() > Date.now() ? { label: "Active", tone: "green" } : { label: "Expired", tone: "red" };
}

/** "26 Aug 2026, 01:45 (in 3 days)": absolute first, relative second. */
export function describeSessionAge(iso?: string | null): string {
  if (!iso) return "—";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "—";
  const absolute = new Date(then).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
  const deltaMs = then - Date.now();
  const mins = Math.round(Math.abs(deltaMs) / 60000);
  const days = Math.round(mins / 1440);
  const unit = mins < 60 ? `${mins} min` : mins < 1440 ? `${Math.round(mins / 60)} hr` : `${days} day${days === 1 ? "" : "s"}`;
  return `${absolute} (${deltaMs >= 0 ? `in ${unit}` : `${unit} ago`})`;
}
