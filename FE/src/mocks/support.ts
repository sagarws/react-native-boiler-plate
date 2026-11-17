import { daysAgo } from "@/mocks/delay";
import type { SupportAssignee, SupportMessage, SupportTicket } from "@/types/support";

/** Support agents used by the simulated stream and the sample tickets. */
export const supportAgents: SupportAssignee[] = [
  { _id: "6650a1f0c2b1e40012a1b001", name: "Priya Sharma", email: "priya@trackvid.in" },
  { _id: "6650a1f0c2b1e40012a1b002", name: "Rohit Mehta", email: "rohit@trackvid.in" },
];

const at = (days: number, hour: number, minute = 0): string => {
  const d = new Date(daysAgo(days, hour));
  d.setMinutes(minute);
  return d.toISOString();
};

export const sampleSupportTickets: SupportTicket[] = [
  {
    _id: "6651b2e0d3c2f50013b2c101",
    ticketNumber: "TV-10482",
    subject: "AJIO claim rejected for AWB 1490 2283 7712",
    status: "ASSIGNED",
    priority: "HIGH",
    assignee: supportAgents[0],
    lastMessageAt: at(0, 11, 42),
    lastMessagePreview: "We have re-attached the unboxing video. Please re-file the claim from CMS.",
    unreadByCustomer: 2,
    createdAt: at(1, 16, 5),
  },
  {
    _id: "6651b2e0d3c2f50013b2c102",
    ticketNumber: "TV-10477",
    subject: "Camera feed offline at packing station 2",
    status: "OPEN",
    priority: "MEDIUM",
    assignee: null,
    lastMessageAt: at(2, 9, 18),
    lastMessagePreview: "The RTSP feed shows offline since morning. Screenshot attached.",
    unreadByCustomer: 0,
    createdAt: at(2, 9, 18),
  },
  {
    _id: "6651b2e0d3c2f50013b2c103",
    ticketNumber: "TV-10451",
    subject: "Myntra return video not linked to order 3115482097",
    status: "RESOLVED",
    priority: "LOW",
    assignee: supportAgents[1],
    lastMessageAt: at(6, 15, 30),
    lastMessagePreview: "Ticket marked as resolved",
    unreadByCustomer: 0,
    createdAt: at(8, 12, 0),
    feedbackPoint: 5,
  },
  {
    _id: "6651b2e0d3c2f50013b2c104",
    ticketNumber: "TV-10420",
    subject: "Invoice for credit recharge of ₹5,000",
    status: "REOPENED",
    priority: "MEDIUM",
    assignee: supportAgents[1],
    lastMessageAt: at(12, 10, 4),
    lastMessagePreview: "GST number on the invoice is still the old one.",
    unreadByCustomer: 1,
    createdAt: at(15, 14, 20),
  },
];

const msg = (
  id: string,
  ticket: string,
  senderType: SupportMessage["senderType"],
  senderName: string,
  body: string,
  createdAt: string,
  attachments: SupportMessage["attachments"] = [],
): SupportMessage => ({ _id: id, ticket, senderType, senderName, senderId: null, body, attachments, createdAt });

const [t1, t2, t3, t4] = sampleSupportTickets.map((t) => t._id);

export const sampleSupportMessages: SupportMessage[] = [
  msg("m101", t1, "customer", "You", "Hi team, our AJIO SPF claim for AWB 1490 2283 7712 got rejected saying \"video not clear\". The packing video is in VMS.", at(1, 16, 5)),
  msg("m102", t1, "system", "System", "Ticket assigned to Priya Sharma", at(1, 16, 40)),
  msg("m103", t1, "agent", "Priya Sharma", "Thanks for reaching out! I can see the order in VMS. Checking the claim with the AJIO team now.", at(1, 16, 42)),
  msg(
    "m104",
    t1,
    "customer",
    "You",
    "Sharing the rejection mail for reference.",
    at(1, 17, 10),
    [{ url: "/assets/whats-new/AAR1.png", key: "support/AAR1.png", name: "rejection-mail.png", mime: "image/png", size: 184_320 }],
  ),
  msg("m105", t1, "agent", "Priya Sharma", "Got it. The clip attached by CMS was the trimmed one. I have re-attached the full unboxing video.", at(0, 11, 40)),
  msg("m106", t1, "agent", "Priya Sharma", "We have re-attached the unboxing video. Please re-file the claim from CMS.", at(0, 11, 42)),

  msg(
    "m201",
    t2,
    "customer",
    "You",
    "The RTSP feed shows offline since morning. Screenshot attached.",
    at(2, 9, 18),
    [{ url: "/assets/whats-new/sd2.png", key: "support/sd2.png", name: "feed-offline.png", mime: "image/png", size: 236_544 }],
  ),

  msg("m301", t3, "customer", "You", "Return video for Myntra order 3115482097 is not showing in RMS.", at(8, 12, 0)),
  msg("m302", t3, "system", "System", "Ticket assigned to Rohit Mehta", at(8, 12, 30)),
  msg("m303", t3, "agent", "Rohit Mehta", "The return AWB was scanned with a typo. I have linked the video to the right order now.", at(7, 10, 15)),
  msg("m304", t3, "customer", "You", "Working now, thank you!", at(6, 15, 28)),
  msg("m305", t3, "system", "System", "Ticket marked as resolved", at(6, 15, 30)),

  msg(
    "m401",
    t4,
    "customer",
    "You",
    "Please share the invoice for the ₹5,000 credit recharge done on the 3rd.",
    at(15, 14, 20),
  ),
  msg(
    "m402",
    t4,
    "agent",
    "Rohit Mehta",
    "Here is the invoice.",
    at(14, 11, 0),
    [{ url: "", key: "support/invoice-TV-5000.pdf", name: "invoice-TV-5000.pdf", mime: "application/pdf", size: 48_210 }],
  ),
  msg("m403", t4, "system", "System", "Ticket marked as resolved", at(14, 11, 5)),
  msg("m404", t4, "customer", "You", "GST number on the invoice is still the old one.", at(12, 10, 0)),
  msg("m405", t4, "system", "System", "Ticket reopened", at(12, 10, 1)),
  msg("m406", t4, "agent", "Rohit Mehta", "Sorry about that, we are regenerating it with the updated GSTIN 24AAKCT4471M1Z5.", at(12, 10, 4)),
];

/** Canned agent replies for the simulated stream, picked by keyword. */
export const supportAutoReplies: { match: RegExp; reply: string }[] = [
  { match: /claim|spf|reject|ajio|myntra|meesho|flipkart|amazon/i, reply: "Thanks! I am checking the claim and the linked video now. I will update you here shortly." },
  { match: /camera|feed|rtsp|offline|video/i, reply: "Could you confirm the camera is powered on and reachable on the network? I am checking the feed logs on our side." },
  { match: /invoice|gst|payment|credit|recharge|refund/i, reply: "Our billing team is on it. You will get the corrected document in this chat." },
];

export const supportDefaultReply = "Thanks for the details! A support specialist has picked this up and will reply here shortly.";
