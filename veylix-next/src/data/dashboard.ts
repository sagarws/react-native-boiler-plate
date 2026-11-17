// @ts-nocheck

export const storeProfile = {
  name: "Veylix",
  tagline: "Commerce, in harmony.",
  owner: "Alex Chen",
  role: "Store Owner",
  health: 94,
  lastSync: "Store snapshot",
  currency: "USD",
};

export const dashboardPeriods = [
  {
    id: "7",
    label: "Last 7 days",
    range: "Apr 24 – 30, 2026",
    sales: 18460,
    orders: 342,
    conversion: 3.5,
    aov: 54,
    change: 8.4,
    customers: 264,
    returning: 31,
    delivery: 2.6,
    trend: [1.6, 2.1, 1.8, 3.3, 2.8, 3.9, 3],
    previous: [1.3, 1.8, 2.2, 2.3, 2.7, 3.1, 2.1],
    labels: ["Apr 24", "Apr 26", "Apr 28", "Apr 30"],
  },
  {
    id: "30",
    label: "Last 30 days",
    range: "Apr 1 – 30, 2026",
    sales: 68420,
    orders: 1248,
    conversion: 3.2,
    aov: 54.8,
    change: 12,
    customers: 982,
    returning: 28,
    delivery: 2.8,
    trend: [2.3, 3, 4.8, 4.1, 5.7, 5.2, 7.1, 8.7, 8.1, 6.8, 7.9, 6.4],
    previous: [3.5, 3.7, 3, 3.8, 4.4, 6.1, 5.3, 4.2, 5, 7.3, 7.5, 5.6],
    labels: ["Apr 1", "Apr 8", "Apr 15", "Apr 22", "Apr 30"],
  },
  {
    id: "90",
    label: "Last 90 days",
    range: "Jan 31 – Apr 30, 2026",
    sales: 196870,
    orders: 3638,
    conversion: 3.1,
    aov: 54.1,
    change: 18.6,
    customers: 2846,
    returning: 26,
    delivery: 3.1,
    trend: [4.8, 5.3, 4.9, 6.8, 6.3, 7.6, 7.1, 8.6, 8.1, 9.7, 9.1, 11],
    previous: [3.4, 4.1, 4.7, 4.2, 5.4, 5.8, 5.1, 6.3, 6.8, 7.2, 6.6, 7.8],
    labels: ["Feb 1", "Feb 22", "Mar 15", "Apr 7", "Apr 30"],
  },
];

export const orderPipelineStages = [
  {
    label: "Orders received",
    ratio: 1,
    color: "amber",
    icon: "clipboard-text",
  },
  {
    label: "Processing",
    ratio: 892 / 1248,
    color: "green",
    icon: "timer",
  },
  {
    label: "Packed",
    ratio: 721 / 1248,
    color: "green",
    icon: "package",
  },
  {
    label: "Shipped",
    ratio: 654 / 1248,
    color: "green",
    icon: "truck",
  },
  {
    label: "Delivered",
    ratio: 602 / 1248,
    color: "green",
    icon: "check-circle",
  },
];

export const recentShipmentUpdates = [
  {
    id: "VX83291",
    status: "Out for delivery",
    tone: "success",
    time: "2h ago",
  },
  {
    id: "VX83290",
    status: "In transit",
    tone: "info",
    time: "Apr 28",
  },
  {
    id: "VX83289",
    status: "Package created",
    tone: "neutral",
    time: "Apr 27",
  },
  {
    id: "VX83288",
    status: "Label created",
    tone: "info",
    time: "Apr 27",
  },
  {
    id: "VX83287",
    status: "Delayed",
    tone: "danger",
    time: "Apr 26",
  },
];

export const salesChannels = [
  {
    name: "Website",
    percent: 42,
    icon: "globe",
    tone: "success",
  },
  {
    name: "Mobile App",
    percent: 28,
    icon: "device-mobile",
    tone: "danger",
  },
  {
    name: "Marketplace",
    percent: 20,
    icon: "storefront",
    tone: "amber",
  },
  {
    name: "Social Commerce",
    percent: 10,
    icon: "chats-circle",
    tone: "info",
  },
];

export const recentOrders = [
  {
    id: "VX83291",
    customer: "Sarah Kim",
    items: 2,
    amount: 79,
    status: "Paid",
    time: "2h ago",
    date: "2026-04-30",
  },
  {
    id: "VX83290",
    customer: "Michael Tan",
    items: 1,
    amount: 24,
    status: "Paid",
    time: "5h ago",
    date: "2026-04-30",
  },
  {
    id: "VX83289",
    customer: "Emily Davis",
    items: 3,
    amount: 129,
    status: "Paid",
    time: "8h ago",
    date: "2026-04-30",
  },
  {
    id: "VX83288",
    customer: "Daniel Lee",
    items: 1,
    amount: 49,
    status: "Paid",
    time: "12h ago",
    date: "2026-04-30",
  },
  {
    id: "VX83287",
    customer: "Priya Sharma",
    items: 2,
    amount: 89,
    status: "Paid",
    time: "1d ago",
    date: "2026-04-29",
  },
  {
    id: "VX83286",
    customer: "Noah Wilson",
    items: 4,
    amount: 186,
    status: "Pending",
    time: "1d ago",
    date: "2026-04-29",
  },
  {
    id: "VX83285",
    customer: "Amara Okafor",
    items: 1,
    amount: 34,
    status: "Paid",
    time: "2d ago",
    date: "2026-04-28",
  },
];

export const activeShipments = [
  {
    tracking: "SPX88291",
    customer: "James Wilson",
    destination: "New York, NY",
    status: "Out for delivery",
    tone: "success",
    eta: "Today",
  },
  {
    tracking: "J&T76521",
    customer: "Aisha Rahman",
    destination: "London, UK",
    status: "In transit",
    tone: "info",
    eta: "Apr 28",
  },
  {
    tracking: "DHL11822",
    customer: "Chen Wei",
    destination: "Singapore",
    status: "Delivered",
    tone: "success",
    eta: "Apr 27",
  },
  {
    tracking: "UPS55210",
    customer: "Carlos M.",
    destination: "Toronto, CA",
    status: "In transit",
    tone: "info",
    eta: "Apr 27",
  },
  {
    tracking: "FEDEX3390",
    customer: "Emma Rossi",
    destination: "Milan, IT",
    status: "Delayed",
    tone: "danger",
    eta: "Apr 28",
  },
];

export const salesByRegion = [
  {
    code: "US",
    name: "United States",
    percent: 28,
  },
  {
    code: "GB",
    name: "United Kingdom",
    percent: 16,
  },
  {
    code: "CA",
    name: "Canada",
    percent: 12,
  },
  {
    code: "DE",
    name: "Germany",
    percent: 10,
  },
  {
    code: "AU",
    name: "Australia",
    percent: 8,
  },
];

export const topProducts = [
  {
    id: "everyday-tee",
    name: "Everyday Tee",
    sold: 1284,
    price: 24,
    icon: "t-shirt",
    color: "charcoal",
  },
  {
    id: "minimal-backpack",
    name: "Minimal Backpack",
    sold: 892,
    price: 79,
    icon: "backpack",
    color: "sand",
  },
  {
    id: "ceramic-mug",
    name: "Ceramic Mug",
    sold: 745,
    price: 18,
    icon: "coffee",
    color: "silver",
  },
];

export const inventorySummary = {
  total: 1698,
  inStock: 1420,
  lowStock: 230,
  outOfStock: 48,
};

export const lowStockProducts = [
  {
    id: "canvas-tote",
    name: "Canvas Tote Bag",
    count: 12,
    icon: "tote",
    color: "sand",
  },
  {
    id: "wireless-mouse",
    name: "Wireless Mouse",
    count: 8,
    icon: "mouse",
    color: "charcoal",
  },
  {
    id: "water-bottle",
    name: "Water Bottle",
    count: 6,
    icon: "thermometer",
    color: "silver",
  },
  {
    id: "notebook-set",
    name: "Notebook Set",
    count: 5,
    icon: "notebook",
    color: "sand",
  },
];

export const paymentMethodShare = [
  {
    name: "Credit Card",
    percent: 52,
    color: "#409cff",
  },
  {
    name: "PayPal",
    percent: 22,
    color: "#84ccff",
  },
  {
    name: "Apple Pay",
    percent: 14,
    color: "#7ec493",
  },
  {
    name: "Bank Transfer",
    percent: 8,
    color: "#ff936c",
  },
  {
    name: "Others",
    percent: 4,
    color: "#bbb8b1",
  },
];

export const quickActions = [
  {
    label: "Add Product",
    icon: "plus",
    tone: "success",
    action: "add-product",
  },
  {
    label: "Create Discount",
    icon: "seal-percent",
    tone: "amber",
    action: "create-discount",
  },
  {
    label: "Manage Orders",
    icon: "package",
    tone: "amber",
    action: "orders",
  },
  {
    label: "Run Campaign",
    icon: "megaphone",
    tone: "neutral",
    action: "campaign",
  },
  {
    label: "View Reports",
    icon: "chart-bar",
    tone: "success",
    action: "reports",
  },
];
