import { sessionState } from "@/features/integrations/session-state";
import type { CredentialSession } from "@/types/integrations";

/** Session state pill; `override` replaces the label while checking / renewing. */
export function SessionChip({ session, override }: { session: CredentialSession | null; override?: string }) {
  const state = sessionState(session);
  const tone = override ? "neutral" : state.tone;
  return <span className={`c-status ${tone === "neutral" ? "tv-int-status-neutral" : tone}`}>{override ?? state.label}</span>;
}
