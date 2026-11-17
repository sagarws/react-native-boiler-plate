// @ts-nocheck
import { AppDialog } from "@/components/ui/app-dialog";
import { findRecord } from "@/lib/store/core";

export function WebhookPayloadDialog({ recordId, onClose }) {
  const n = findRecord("webhooks", recordId);
  if (!n) return null;
  const r = String(n.event || "event.updated");
  const i = {
    id: "evt_demo_001",
    type: r,
    created_at: new Date().toISOString(),
    data: {
      id: "VX83291",
      object: r.split(".")[0],
    },
  };
  return (
    <AppDialog title="Webhook payload preview" onClose={onClose}>
      <p>Example delivery only. No request was sent.</p>
      <pre className="c-code">{JSON.stringify(i, null, 2)}</pre>
      <p>
        Sign the raw request body on your server using a server-held secret.
        Your receiver must verify signatures, deduplicate event IDs and return a
        successful response before retry limits.
      </p>
    </AppDialog>
  );
}
