// @ts-nocheck

export const shippingDateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
});

export const shippingWorkspaceTabs = [
  ["fulfillment", "Fulfillment queue", "package"],
  ["deliveries", "Delivery tracking", "truck"],
  ["carriers", "Carriers", "globe"],
  ["shipping-rules", "Shipping zones", "tag"],
  ["returns", "Return logistics", "arrow-left"],
];

export const shippingWorkspaceModuleIds = new Set([
  "carriers",
  "shipping-rules",
  "returns",
]);

export const fulfillmentStatusOptions = [
  "Picking",
  "Packed",
  "In transit",
  "Delivered",
  "Delayed",
];

export const deliveryStatusOptions = [
  "Ready to dispatch",
  "Shipped",
  "In transit",
  "Out for delivery",
  "Delivered",
  "Delivery attempted",
  "Delayed",
  "Failed",
];
