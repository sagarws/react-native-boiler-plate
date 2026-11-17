// @ts-nocheck

export function buildRecentSalesCsv(e) {
  const t = (e) => {
    let t = String(e);
    if (/^[=+\-@\t\r]/.test(t)) {
      t = `'${t}`;
    }
    return `"${t.replaceAll('"', '""')}"`;
  };
  return [
    ["Order ID", "Customer", "Items", "Amount (USD)", "Status", "Date"],
    ...e.map((e) => [
      e.id,
      e.customer,
      e.items,
      e.amount.toFixed(2),
      e.status,
      e.date,
    ]),
  ]
    .map((e) => e.map(t).join(","))
    .join("\r\n");
}
