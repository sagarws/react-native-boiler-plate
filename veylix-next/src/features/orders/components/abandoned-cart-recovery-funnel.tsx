// @ts-nocheck
import { formatCurrency } from "@/lib/format";

export function AbandonedCartRecoveryFunnel({ rows }) {
  return (
    <section className="glass-card recovery-funnel">
      <div className="ops-list-heading">
        <div>
          <span>RECOVERY SEQUENCE</span>
          <h2>Turn intent into a measured follow-up</h2>
          <p>
            Move each checkout through a controlled sequence instead of treating
            recovery as a one-off reminder.
          </p>
        </div>
      </div>
      <div className="recovery-funnel-grid">
        {[
          "No outreach",
          "Reminder 1 sent",
          "Reminder 2 sent",
          "Offer prepared",
          "Recovered",
        ].map((t, n) => {
          const r = rows.filter((e) => e.recoveryStage === t);
          return (
            <div key={t}>
              <span>{n + 1}</span>
              <strong>{t}</strong>
              <small>
                {r.length}
                {" checkout"}
                {r.length === 1 ? "" : "s"}
                {" · "}
                {formatCurrency(
                  r.reduce((e, t) => e + Number(t.value || 0), 0),
                  0,
                )}
              </small>
            </div>
          );
        })}
      </div>
    </section>
  );
}
