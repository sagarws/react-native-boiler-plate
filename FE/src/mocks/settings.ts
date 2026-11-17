import { QC_REASON_KEY, type IAppSetting, type IncreffQcMappingEntry, type TemplateProvider, type TemplateRecord } from "@/types/settings";

/** Sample data for /settings. Values follow TrackVid-BE `defaultAppSetting` and `processors/template-builder.ts`. */

export const sampleIncreffQcMapping: IncreffQcMappingEntry[] = [
  { [QC_REASON_KEY]: "Wrong Product", ajio: "Wrong product received", myntra: "Different Product Returned", flipkart: "Wrong product returned", amazon: "Different item returned" },
  { [QC_REASON_KEY]: "Damaged Product", ajio: "Product damaged", myntra: "Damaged Product", flipkart: "Damaged product returned", amazon: "Damaged item returned" },
  { [QC_REASON_KEY]: "Used Product", ajio: "Used product received", myntra: "Used Product", flipkart: "Used product returned", amazon: "Used item returned" },
  { [QC_REASON_KEY]: "Missing Tags", ajio: "Tags missing", myntra: "Tag Missing", flipkart: "Missing brand tag", amazon: "" },
  { [QC_REASON_KEY]: "Empty Box", ajio: "Empty box received", myntra: "Empty Packet Received", flipkart: "Empty box received", amazon: "Empty package returned" },
  { [QC_REASON_KEY]: "Partial Return", ajio: "Partial articles received", myntra: "Partial Return", flipkart: "Missing components", amazon: "Missing item / accessory" },
  { [QC_REASON_KEY]: "Stained / Soiled", ajio: "Product stained", myntra: "Stained Product", flipkart: "Damaged product returned", amazon: "" },
  { [QC_REASON_KEY]: "Size Mismatch", ajio: "Size different from ordered", myntra: "Size Mismatch", flipkart: "Wrong product returned", amazon: "Different item returned" },
];

export const sampleAppSetting: IAppSetting = {
  backupDurationRates: [
    { days: 30, credits: 0 },
    { days: 60, credits: 0.25 },
    { days: 90, credits: 0.5 },
    { days: 180, credits: 1 },
  ],
  videoSizeRates: [
    { videoSize: 50, credits: 1 },
    { videoSize: 100, credits: 2 },
    { videoSize: 150, credits: 3 },
    { videoSize: 200, credits: 4 },
    { videoSize: 250, credits: 5 },
    { videoSize: 300, credits: 6 },
  ],
  cmsCredits: 1,
  vmsCredits: 1,
  increffQcMapping: sampleIncreffQcMapping,
  spfClaimTatPeriod: {
    ajio: 10,
    meesho: 10,
    snapdeal: 10,
    delhivery: 10,
    expressbees: 10,
    myntra: 10,
    flipkart: 10,
    amazon: 10,
    tataCliq: 10,
    naykaa: 10,
  },
};

/** TrackVid-BE `DEFAULT_VARIABLES`. */
export const DEFAULT_TEMPLATE_VARIABLES: string[] = [
  "sender_name",
  "original_subject",
  "user_phone",
  "user_first_name",
  "user_last_name",
  "user_full_name",
  "order_id",
  "order_status",
  "order_total",
  "order_currency",
  "order_details",
  "order_details_html",
  "video_links",
  "video_links_html",
  "incident_id",
  "provider",
];

/** TrackVid-BE `SAMPLE_CONTEXT`, used to resolve a template preview. */
export const TEMPLATE_SAMPLE_CONTEXT: Record<string, string> = {
  sender_name: "Customer Name",
  original_subject: "Issue with Order FN7845120963",
  user_phone: "+91 98765 43210",
  user_first_name: "Aarav",
  user_last_name: "Mehta",
  user_full_name: "Aarav Mehta",
  order_id: "FN7845120963",
  order_status: "delivered",
  order_total: "₹2,499.00",
  order_currency: "INR",
  order_details: "Order FN7845120963 • delivered\nTotal: ₹2,499.00\nItems:\n- Cotton Kurta Set (x1) – ₹2,499.00",
  order_details_html:
    "<div><p><strong>Order FN7845120963 • delivered</strong></p><p>Total: ₹2,499.00</p><ul><li>Cotton Kurta Set (x1) – ₹2,499.00</li></ul></div>",
  video_links: "1. https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4",
  video_link: "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4",
  video_links_html:
    '<ul><li><a href="https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4">https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4</a></li></ul>',
  incident_id: "INC0096879927",
  provider: "ajio",
};

const ajioTemplateHtml = [
  "<p>Hi Team AJIO,</p>",
  "<p></p>",
  "<p>Please find the requested CCTV footage for the below-mentioned order:</p>",
  "<p></p>",
  "<p>Order Id: {{order_id}}</p>",
  "<p>CCTV Footage Link: {{video_link}}</p>",
  "<p></p>",
  "<p>We have named the file as per the given instructions (Order ID only, without spaces or special characters). Kindly review the footage and confirm.</p>",
  "<p>Let us know if any further information is required.</p>",
  "<p></p>",
  "<p>Best Regards,</p>",
  "<p>{{sender_name}}</p>",
].join("");

const plainAck = "Hello {{sender_name}},\n\nThis is an automated acknowledgement for order {{order_id}}. We will get back to you shortly.\n\nSupport: {{user_phone}}\n";

/** TrackVid-BE `PROVIDER_BODIES`. */
export const PROVIDER_TEMPLATE_BODIES: Record<TemplateProvider, string> = {
  ajio: ajioTemplateHtml,
  amazon:
    "Hello {{sender_name}},\n\nThank you for contacting Amazon support. Your order {{order_id}} is currently {{order_status}}. Our agent will call you at {{user_phone}} if we need more details.\n",
  flipkart:
    "Hi {{sender_name}},\n\nWe have logged your request for order {{order_id}}. Summary:\n{{order_details}}\nVideo links:\n{{video_links}}\n\nRegards,\nFlipkart Support",
  myntra: "Hello {{sender_name}},\n\nYour order {{order_id}} is being reviewed. You can reach us at {{user_phone}}.\n\nThank you,\nMyntra Care",
  nykaa: "Hi {{sender_name}},\n\nThanks for reaching out. Order {{order_id}} details:\n{{order_details}}\nVideo links:\n{{video_links}}\n\nTeam Nykaa",
  other: plainAck,
  limeroad: plainAck,
  meesho: plainAck,
  snapdeal: plainAck,
  "tata cliq": plainAck,
};

/** The company's saved AJIO template (edited once by the seller). */
export const sampleTemplates: TemplateRecord[] = [
  {
    _id: "tmpl00000000000000000001",
    name: "AJIO Auto Reply",
    subject: "Re: {{original_subject}}",
    body: ajioTemplateHtml.replace("<p>Best Regards,</p>", "<p>Warm regards,</p>").replace("{{sender_name}}</p>", "{{sender_name}}<br>Urban Threads Pvt Ltd</p>"),
    provider: "ajio",
    status: "active",
    variables: DEFAULT_TEMPLATE_VARIABLES,
    updatedAt: "2026-10-28T09:42:00.000Z",
    isDefault: true,
  },
];
