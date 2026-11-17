import { daysAgo } from "@/mocks/delay";

export interface Notifications {
  message: string;
  description: string;
  is_read: boolean;
  is_archived: boolean;
  _id: string;
  fileUrl?: string;
  type?: string;
  createdAt: string;
}

export interface BackgroundJobs {
  importNotifications: { mainJobId: string; status: string; title: string }[];
}

export const sampleNotifications: Notifications[] = [
  {
    _id: "ntf000000000000000000001",
    message: "Export ready",
    description: "Your CMS export (412 rows) is ready to download.",
    is_read: false,
    is_archived: false,
    type: "EXPORT",
    fileUrl: "/assets/sheets/Order_Data.xlsx",
    createdAt: daysAgo(0, 9),
  },
  {
    _id: "ntf000000000000000000002",
    message: "Return scan finished",
    description: "R&D scan matched 38 of 40 parcels. 2 need review.",
    is_read: false,
    is_archived: false,
    type: "R_D_SCAN",
    createdAt: daysAgo(0, 8),
  },
  {
    _id: "ntf000000000000000000003",
    message: "Claim approved",
    description: "Ajio approved claim for AWB 1490823311 (₹1,249).",
    is_read: false,
    is_archived: false,
    type: "CLAIM",
    createdAt: daysAgo(1, 16),
  },
  {
    _id: "ntf000000000000000000004",
    message: "Low credits",
    description: "Fewer than 2,000 credits left. Top up to keep recording.",
    is_read: true,
    is_archived: false,
    type: "CREDIT",
    createdAt: daysAgo(2, 11),
  },
  {
    _id: "ntf000000000000000000005",
    message: "Import completed",
    description: "Myntra return sheet imported: 120 orders added.",
    is_read: true,
    is_archived: false,
    type: "IMPORT",
    createdAt: daysAgo(3, 14),
  },
];

export const sampleBackgroundJobs: BackgroundJobs = {
  importNotifications: [{ mainJobId: "job_01", status: "RUNNING", title: "Flipkart forward sheet import" }],
};
