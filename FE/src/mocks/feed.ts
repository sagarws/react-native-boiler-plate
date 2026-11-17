import { daysAgo } from "@/mocks/delay";
import type { IFeed } from "@/types/feed";

const COMPANY_ID = "64f0c0ffee0000000000c001";
const USER_ID = "64f0c0ffee0000000000a001";

type Row = [feedName: string, cameraType: "web_cam" | "rtsp", ip: string, onvif: boolean, disabled: boolean];

const rows: Row[] = [
  ["Packing Station 1", "rtsp", "192.168.1.21", true, false],
  ["Packing Station 2", "rtsp", "192.168.1.22", true, false],
  ["Return Desk", "web_cam", "", false, false],
  ["QC Table", "rtsp", "192.168.1.32", false, false],
  ["Warehouse Gate", "rtsp", "192.168.1.40", true, true],
  ["Myntra Returns", "web_cam", "", false, false],
  ["Ajio Dispatch", "rtsp", "192.168.1.51", false, false],
  ["Flipkart Dispatch", "rtsp", "192.168.1.52", true, false],
  ["Meesho Bay", "web_cam", "", false, true],
  ["Nykaa Packing", "rtsp", "192.168.1.61", false, false],
  ["Amazon Easy Ship", "rtsp", "192.168.1.62", false, false],
  ["Laptop Cam", "web_cam", "", false, false],
];

const slug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");

export const sampleFeeds: IFeed[] = rows.map(([feedName, cameraType, ip, onvif, disabled], i) => ({
  _id: `feed${String(i + 1).padStart(20, "0")}`,
  feedName,
  cameraType,
  rtspURL: cameraType === "rtsp" ? `rtsp://admin:Cam@${4821 + i}@${ip}:554/Streaming/Channels/101` : "",
  companyId: COMPANY_ID,
  userId: USER_ID,
  isSelectedFeed: i === 0,
  isDisable: disabled,
  isDeleted: false,
  createdAt: daysAgo(180 - i * 13),
  feedUser: { userId: `ut_${slug(feedName)}`, password: `Tv#${(73021 + i * 977).toString(36)}Q${i}` },
  onvif_ip: onvif ? ip : "",
  onvif_username: onvif ? "admin" : "",
  onvif_password: onvif ? `Onvif@${2200 + i}` : "",
}));
