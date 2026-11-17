// @ts-nocheck
import { AppDialog } from "@/components/ui/app-dialog";

export function IntegrationGuideDialog({ connection, onClose }) {
  return (
    <AppDialog title={`${connection.name} integration`} onClose={onClose}>
      <ol className="c-guide-list">
        <li>Create a sandbox account with your selected provider.</li>
        <li>
          {"Store credentials as "}
          <code>{connection.env}</code>
          {" on your backend."}
        </li>
        <li>
          {"Implement authenticated server endpoints for "}
          {connection.category === "Payments"
            ? "checkout sessions, captures, refunds and payouts"
            : "the selected service"}
          .
        </li>
        <li>
          Verify incoming event signatures, deduplicate event IDs and record an
          audit trail.
        </li>
        <li>
          Expose connection readiness to this UI, then enable matching checkout
          methods.
        </li>
      </ol>
      <p>
        {
          "Veylix does not submit payments or send external messages in this demo. See the included "
        }
        <strong>documentation/INTEGRATIONS.md</strong>
        {" for adapter contracts."}
      </p>
    </AppDialog>
  );
}
