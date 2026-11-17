// @ts-nocheck
import { shippingDateFormatter } from "@/features/orders/constants/shipping";
import { showToast } from "@/lib/events";
import { findRecord } from "@/lib/store/core";

export function getShippingModuleSummary(e, t) {
  if (e === "carriers") {
    const e = t.filter((e) => e.status === "Active");
    const n = new Set(
      e.flatMap((e) =>
        String(e.services || "")
          .split(",")
          .map((e) => e.trim())
          .filter(Boolean),
      ),
    );
    const r = e.length
      ? e.reduce((e, t) => e + Number(t.onTime || 0), 0) / e.length
      : 0;
    return [
      ["Active carriers", e.length, "Available for fulfillment"],
      ["Service levels", n.size, "Across enabled carriers"],
      ["Average on-time", `${r.toFixed(1)}%`, "Demo performance snapshot"],
      [
        "Paused",
        t.filter((e) => e.status === "Paused").length,
        "Not used for new shipments",
      ],
    ];
  }
  if (e === "shipping-rules") {
    const e = t.filter((e) => e.status === "Active");
    return [
      ["Shipping zones", t.length, "Destination rules"],
      ["Active zones", e.length, "Available at checkout"],
      [
        "Free-shipping rules",
        e.filter(
          (e) => Number(e.freeAbove || 0) > 0 || e.rateType === "Free shipping",
        ).length,
        "Threshold or free rate",
      ],
      [
        "Express zones",
        e.filter((e) => e.service === "Express" || e.service === "Same-day")
          .length,
        "Faster delivery options",
      ],
    ];
  }
  return e === "returns"
    ? [
        ["Return requests", t.length, "Reverse-logistics records"],
        [
          "In transit",
          t.filter((e) => e.status === "In transit").length,
          "Coming back to warehouse",
        ],
        [
          "Needs inspection",
          t.filter(
            (e) =>
              ["Requested", "Approved", "Received"].includes(
                String(e.status || ""),
              ) && e.disposition === "Pending inspection",
          ).length,
          "Review disposition",
        ],
        [
          "Received",
          t.filter((e) => e.status === "Received").length,
          "Arrived back at store",
        ],
      ]
    : [];
}

export function getShipmentOrder(e) {
  return findRecord("orders", e.orderId);
}

export function getShipmentCustomer(e) {
  return e ? findRecord("customers", e.customerId) : void 0;
}

export function getOrderUnitCount(e) {
  return (
    (Array.isArray(e?.items) ? e?.items : []).reduce(
      (e, t) => e + Number(t.quantity || 0),
      0,
    ) || Number(e?.quantity || 0)
  );
}

export function formatShippingDate(e) {
  if (!e) return "—";
  const t = new Date(`${String(e)}T00:00:00`);
  return Number.isNaN(t.getTime())
    ? String(e)
    : shippingDateFormatter.format(t);
}

export function getNextFulfillmentAction(e) {
  return e.status === "Picking"
    ? ["Packed", "Mark packed", "check-circle"]
    : e.status === "Packed"
      ? ["In transit", "Mark shipped", "truck"]
      : e.status === "In transit"
        ? ["Delivered", "Mark delivered", "check-circle"]
        : null;
}

export function copyFulfillmentTrackingNumber(e) {
  const t = String(e.tracking || "").trim();
  if (t) {
    if (navigator.clipboard?.writeText) {
      navigator.clipboard
        .writeText(t)
        .then(() => showToast("Tracking number copied."))
        .catch(() => showToast("Copy is unavailable in this browser."));
    } else {
      showToast("Copy is unavailable in this browser.");
    }
  } else {
    showToast("This shipment does not have a tracking number yet.");
  }
}

export function getNextDeliveryAction(e) {
  return e.status === "Ready to dispatch"
    ? ["Shipped", "Mark shipped", "truck"]
    : e.status === "Shipped"
      ? ["In transit", "Mark in transit", "truck"]
      : e.status === "In transit"
        ? ["Out for delivery", "Out for delivery", "truck"]
        : e.status === "Out for delivery"
          ? ["Delivered", "Mark delivered", "check-circle"]
          : null;
}

export function copyDeliveryTrackingNumber(e) {
  const t = String(e.tracking || "").trim();
  if (t) {
    if (navigator.clipboard?.writeText) {
      navigator.clipboard
        .writeText(t)
        .then(() => showToast("Tracking number copied."))
        .catch(() => showToast("Copy is unavailable in this browser."));
    } else {
      showToast("Copy is unavailable in this browser.");
    }
  } else {
    showToast("This shipment does not have a tracking number yet.");
  }
}
