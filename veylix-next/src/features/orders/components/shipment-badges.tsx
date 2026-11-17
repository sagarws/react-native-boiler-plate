// @ts-nocheck
import { Icon } from "@/components/icons/icon";

export function ShipmentStatusPill({ value = "Picking" }) {
  const t = String(value || "Picking");
  const n =
    t === "Delivered"
      ? "green"
      : ["Delayed", "Failed", "Delivery attempted"].includes(t)
        ? "red"
        : ["Packed", "Ready to dispatch", "Out for delivery"].includes(t)
          ? "amber"
          : ["In transit", "Shipped"].includes(t)
            ? "blue"
            : "neutral";
  return (
    <span className={`shipment-status ${n}`}>
      <i />
      {t}
    </span>
  );
}

export function ShipmentPriorityPill({ value = "Standard" }) {
  const t = String(value || "Standard");
  return (
    <span
      className={`shipment-priority ${t === "Express" ? "red" : t === "Priority" ? "amber" : "neutral"}`}
    >
      {t}
    </span>
  );
}

export function ShippingSortableHeader({
  label,
  sortKey,
  sort,
  direction,
  onSort,
}) {
  return (
    <th
      scope="col"
      aria-sort={
        sort === sortKey
          ? direction === 1
            ? "ascending"
            : "descending"
          : "none"
      }
    >
      <button type="button" onClick={() => onSort(sortKey)}>
        {label}
        <Icon
          name={sort === sortKey && direction < 0 ? "arrow-down" : "arrow-up"}
        />
      </button>
    </th>
  );
}
