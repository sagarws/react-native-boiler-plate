// @ts-nocheck

export function OrderOpsFlowPanel({ moduleId }) {
  if (moduleId === "abandoned") return null;
  const t = moduleId === "refunds";
  return (
    <section className="glass-card ops-flow">
      <div>
        <span>{t ? "REFUND OPERATIONS" : "CANCELLATION CONTROL"}</span>
        <h2>
          {t
            ? "Decision → provider → inventory"
            : "Protect fulfillment, payment and inventory"}
        </h2>
        <p>
          {t
            ? "Keep the money movement, liability and return/restock decision together so support and finance see the same outcome."
            : "Approve only while the order is still cancellable, then keep the payment and stock consequences explicit."}
        </p>
      </div>
      <ol>
        {(t
          ? [
              ["Review", "Order, amount and reason"],
              ["Liability", "Store, vendor, carrier or shared"],
              ["Process", "Provider or store credit"],
              ["Close", "Payment + inventory outcome"],
            ]
          : [
              ["Request", "Who asked and why"],
              ["Fulfillment check", "Block shipped/delivered orders"],
              ["Liability", "Payment + inventory owner"],
              ["Decision", "Approve or reject with history"],
            ]
        ).map(([e, t], n) => (
          <li key={e}>
            <span>{n + 1}</span>
            <strong>{e}</strong>
            <small>{t}</small>
          </li>
        ))}
      </ol>
    </section>
  );
}
