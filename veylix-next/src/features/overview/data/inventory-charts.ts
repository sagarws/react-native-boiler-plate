// @ts-nocheck
import { inventorySummary } from "@/data/dashboard";

export const inventoryStockSegments = [
  {
    name: "In Stock",
    value: inventorySummary.inStock,
    color: "#43bf82",
  },
  {
    name: "Low Stock",
    value: inventorySummary.lowStock,
    color: "#ffd06c",
  },
  {
    name: "Out of Stock",
    value: inventorySummary.outOfStock,
    color: "#ed9363",
  },
];

export const inventoryHealthTrend = {
  labels: [
    "Apr 24",
    "Apr 25",
    "Apr 26",
    "Apr 27",
    "Apr 28",
    "Apr 29",
    "Apr 30",
  ],
  values: [86, 90, 88, 94, 91, 92, 94],
};
