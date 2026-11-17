import { clone, delay, newId } from "@/mocks/delay";
import {
  sampleSupportMessages,
  sampleSupportTickets,
  supportAgents,
  supportAutoReplies,
  supportDefaultReply,
} from "@/mocks/support";
import type {
  SupportAttachment,
  SupportMessage,
  SupportResolvePayload,
  SupportResponse,
  SupportStreamHandlers,
  SupportTicket,
  SupportTicketDetail,
  SupportTicketStatus,
} from "@/types/support";

/**
 * Mock of TrackVid-FE `api/supportChat-service.ts` (`/support-chat/customer/*`). Same exported object and
 * function names; FormData payloads are read the way the backend reads them (`subject`, `body`, `attachments`).
 * The SSE stream (`/tickets/:id/stream`) is simulated by `subscribeTicketStream`, which pushes an agent reply
 * a few seconds after a customer message. Every timer it starts is cleared when the subscription ends.
 */

export const SUPPORT_ALLOWED_MIME = ["image/png", "image/jpeg", "image/webp", "application/pdf"] as const;
export const SUPPORT_MAX_FILE_SIZE = 10 * 1024 * 1024;
export const SUPPORT_MAX_FILES = 5;
/** Delay before the simulated agent reply arrives on the stream. */
const AGENT_REPLY_MS = 3500;

let tickets: SupportTicket[] = clone(sampleSupportTickets);
let messages: SupportMessage[] = clone(sampleSupportMessages);
let ticketCounter = 10483;
/** Files uploaded in this session, by attachment key (no object URLs are kept alive here). */
const blobs = new Map<string, Blob>();
const streamListeners = new Map<string, Set<SupportStreamHandlers>>();
const customerListeners = new Map<string, Set<(message: SupportMessage) => void>>();

const nowIso = (offsetMs = 0): string => new Date(Date.now() + offsetMs).toISOString();

function findTicket(ticketId: string): SupportTicket {
  const ticket = tickets.find((t) => t._id === ticketId);
  if (!ticket) throw new Error("Ticket not found");
  return ticket;
}

function updateTicket(ticketId: string, patch: Partial<SupportTicket>): SupportTicket {
  let updated: SupportTicket | null = null;
  tickets = tickets.map((t) => {
    if (t._id !== ticketId) return t;
    updated = { ...t, ...patch };
    return updated;
  });
  if (!updated) throw new Error("Ticket not found");
  return updated;
}

function emitMessage(message: SupportMessage): void {
  streamListeners.get(message.ticket)?.forEach((h) => h.onMessage(clone(message)));
}

function emitTicket(ticket: SupportTicket): void {
  streamListeners.get(ticket._id)?.forEach((h) => h.onTicketUpdate(clone(ticket)));
}

function addMessage(message: SupportMessage): SupportMessage {
  messages = [...messages, message];
  return message;
}

function systemMessage(ticketId: string, body: string, offsetMs = 1): SupportMessage {
  return addMessage({
    _id: newId(),
    ticket: ticketId,
    senderType: "system",
    senderName: "System",
    senderId: null,
    body,
    attachments: [],
    createdAt: nowIso(offsetMs),
  });
}

function readString(fd: FormData, key: string): string {
  const v = fd.get(key);
  return typeof v === "string" ? v.trim() : "";
}

/** Validate and keep the uploaded files (same rules as the screen: type, 10 MB, max 5). */
function readAttachments(fd: FormData): SupportAttachment[] {
  const files = fd.getAll("attachments").filter((v): v is File => v instanceof File);
  if (files.length > SUPPORT_MAX_FILES) throw new Error(`You can attach up to ${SUPPORT_MAX_FILES} files`);
  return files.map((file) => {
    if (!(SUPPORT_ALLOWED_MIME as readonly string[]).includes(file.type)) throw new Error(`${file.name}: only PNG/JPG/WEBP/PDF allowed`);
    if (file.size > SUPPORT_MAX_FILE_SIZE) throw new Error(`${file.name}: too large (max 10 MB)`);
    const key = `support/${newId()}/${file.name}`;
    blobs.set(key, file);
    return { url: "", key, name: file.name, mime: file.type, size: file.size };
  });
}

function preview(body: string, attachments: SupportAttachment[]): string {
  if (body) return body.length > 120 ? `${body.slice(0, 120)}…` : body;
  return attachments.length === 1 ? `📎 ${attachments[0].name}` : `📎 ${attachments.length} attachments`;
}

/** `GET /tickets[?status=]` — newest activity first. */
const listTickets = async (status?: string): Promise<SupportResponse<SupportTicket[]>> => {
  await delay();
  const rows = tickets
    .filter((t) => !status || t.status === status)
    .sort((a, b) => b.lastMessageAt.localeCompare(a.lastMessageAt));
  return { data: clone(rows) };
};

/** `GET /tickets/:id` — ticket and its messages, oldest first. */
const getTicket = async (ticketId: string): Promise<SupportResponse<SupportTicketDetail>> => {
  await delay();
  const ticket = findTicket(ticketId);
  const list = messages.filter((m) => m.ticket === ticketId).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return { data: clone({ ticket, messages: list }) };
};

/** `POST /tickets` (multipart: subject, body?, attachments[]). */
const createTicket = async (formData: FormData): Promise<SupportResponse<SupportTicket>> => {
  await delay(600);
  const subject = readString(formData, "subject");
  if (!subject) throw new Error("Subject is required");
  const body = readString(formData, "body");
  const attachments = readAttachments(formData);
  const createdAt = nowIso();
  ticketCounter += 1;
  const ticket: SupportTicket = {
    _id: newId(),
    ticketNumber: `TV-${ticketCounter}`,
    subject,
    status: "OPEN",
    priority: "MEDIUM",
    assignee: null,
    lastMessageAt: createdAt,
    lastMessagePreview: body || attachments.length ? preview(body, attachments) : subject,
    unreadByCustomer: 0,
    createdAt,
  };
  tickets = [ticket, ...tickets];
  if (body || attachments.length) {
    addMessage({ _id: newId(), ticket: ticket._id, senderType: "customer", senderName: "You", senderId: null, body, attachments, createdAt });
  }
  return { data: clone(ticket) };
};

/** `POST /tickets/:id/messages` (multipart: body?, attachments[]). A resolved ticket is reopened. */
const sendMessage = async (ticketId: string, formData: FormData): Promise<SupportResponse<SupportMessage>> => {
  await delay(500);
  const ticket = findTicket(ticketId);
  const body = readString(formData, "body");
  const attachments = readAttachments(formData);
  if (!body && attachments.length === 0) throw new Error("Write a message or attach a file");
  const message = addMessage({
    _id: newId(),
    ticket: ticketId,
    senderType: "customer",
    senderName: "You",
    senderId: null,
    body,
    attachments,
    createdAt: nowIso(),
  });
  const reopen = ticket.status === "RESOLVED";
  const updated = updateTicket(ticketId, {
    lastMessageAt: message.createdAt,
    lastMessagePreview: preview(body, attachments),
    ...(reopen ? { status: "REOPENED" as SupportTicketStatus } : {}),
  });
  if (reopen) {
    emitMessage(systemMessage(ticketId, "Ticket reopened"));
    emitTicket(updated);
  }
  customerListeners.get(ticketId)?.forEach((fn) => fn(clone(message)));
  return { data: clone(message) };
};

/** `POST /tickets/:id/read`. */
const markRead = async (ticketId: string): Promise<{ message: string }> => {
  await delay(150);
  updateTicket(ticketId, { unreadByCustomer: 0 });
  return { message: "Marked as read" };
};

/** `POST /tickets/:id/resolve` with optional rating (1–5) and comment. */
const resolve = async (ticketId: string, payload?: SupportResolvePayload): Promise<SupportResponse<SupportTicket>> => {
  await delay(500);
  findTicket(ticketId);
  const note = systemMessage(ticketId, "Ticket marked as resolved", 0);
  const updated = updateTicket(ticketId, {
    status: "RESOLVED",
    feedbackPoint: payload?.feedbackPoint,
    feedback: payload?.feedback,
    lastMessageAt: note.createdAt,
    lastMessagePreview: note.body,
  });
  emitMessage(note);
  emitTicket(updated);
  return { data: clone(updated) };
};

function agentReply(ticketId: string, customerText: string): void {
  const ticket = tickets.find((t) => t._id === ticketId);
  if (!ticket || ticket.status === "RESOLVED") return;
  const assignee = ticket.assignee ?? supportAgents[Number.parseInt(ticket.ticketNumber.replace(/\D/g, ""), 10) % supportAgents.length];
  if (!ticket.assignee) emitMessage(systemMessage(ticketId, `Ticket assigned to ${assignee.name}`, 0));
  const reply = supportAutoReplies.find((r) => r.match.test(`${ticket.subject} ${customerText}`))?.reply ?? supportDefaultReply;
  const message = addMessage({
    _id: newId(),
    ticket: ticketId,
    senderType: "agent",
    senderName: assignee.name,
    senderId: assignee._id,
    body: reply,
    attachments: [],
    createdAt: nowIso(2),
  });
  const updated = updateTicket(ticketId, {
    status: "ASSIGNED",
    assignee,
    lastMessageAt: message.createdAt,
    lastMessagePreview: reply,
    unreadByCustomer: ticket.unreadByCustomer + 1,
  });
  emitMessage(message);
  emitTicket(updated);
}

/**
 * Simulated `EventSource` on `/tickets/:id/stream`: `onMessage` for new messages, `onTicketUpdate` for status /
 * assignee changes. An agent replies `AGENT_REPLY_MS` after each customer message (and once on subscribe when the
 * newest message is an unanswered customer message, e.g. a ticket just created). Returns the unsubscribe function,
 * which clears every pending timer.
 */
const subscribeTicketStream = (ticketId: string, handlers: SupportStreamHandlers): (() => void) => {
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const schedule = (text: string) => {
    const timer = setTimeout(() => {
      timers.delete(timer);
      agentReply(ticketId, text);
    }, AGENT_REPLY_MS);
    timers.add(timer);
  };
  const onCustomer = (message: SupportMessage) => schedule(message.body);

  if (!streamListeners.has(ticketId)) streamListeners.set(ticketId, new Set());
  if (!customerListeners.has(ticketId)) customerListeners.set(ticketId, new Set());
  streamListeners.get(ticketId)?.add(handlers);
  customerListeners.get(ticketId)?.add(onCustomer);

  const last = messages
    .filter((m) => m.ticket === ticketId && m.senderType !== "system")
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .at(-1);
  if (last?.senderType === "customer" && Date.now() - new Date(last.createdAt).getTime() < 60_000) schedule(last.body);

  return () => {
    timers.forEach((t) => clearTimeout(t));
    timers.clear();
    streamListeners.get(ticketId)?.delete(handlers);
    customerListeners.get(ticketId)?.delete(onCustomer);
  };
};

/** Minimal one-page PDF so the sample invoice attachment can be opened. */
function samplePdf(title: string): Blob {
  const text = `%PDF-1.4
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj
3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 595 842]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj
4 0 obj<</Length 60>>stream
BT /F1 18 Tf 60 760 Td (${title.replace(/[()\\]/g, "")}) Tj ET
endstream endobj
5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj
trailer<</Root 1 0 R>>
%%EOF`;
  return new Blob([text], { type: "application/pdf" });
}

/**
 * File behind an attachment uploaded in this session (or a generated sample PDF). Screens turn it into an
 * object URL only while it is shown, and revoke it on cleanup. Returns null for attachments with a public `url`.
 */
const getAttachmentBlob = (attachment: SupportAttachment): Blob | null => {
  const stored = blobs.get(attachment.key);
  if (stored) return stored;
  if (!attachment.url && attachment.mime === "application/pdf") {
    const pdf = samplePdf(`TrackVid - ${attachment.name}`);
    blobs.set(attachment.key, pdf);
    return pdf;
  }
  return null;
};

export const SupportChatService = {
  listTickets,
  getTicket,
  createTicket,
  sendMessage,
  markRead,
  resolve,
  subscribeTicketStream,
  getAttachmentBlob,
};
