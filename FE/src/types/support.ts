/** Types for /support. Same field names as TrackVid-FE `pages/SupportChat.tsx` (`Attachment`, `Message`, `Ticket`). */

export interface SupportAttachment {
  /** Public URL. Empty for files uploaded in this session: the file is kept in memory, see `getAttachmentBlob`. */
  url: string;
  key: string;
  name: string;
  mime: string;
  size: number;
}

export type SupportSenderType = "customer" | "agent" | "system";

export interface SupportMessage {
  _id: string;
  ticket: string;
  senderType: SupportSenderType;
  senderId?: string | null;
  senderName: string;
  body: string;
  attachments: SupportAttachment[];
  createdAt: string;
}

export type SupportTicketStatus = "OPEN" | "ASSIGNED" | "RESOLVED" | "REOPENED";

export interface SupportAssignee {
  _id: string;
  name: string;
  email: string;
  avatar?: string;
}

export interface SupportTicket {
  _id: string;
  ticketNumber: string;
  subject: string;
  status: SupportTicketStatus;
  priority: string;
  assignee?: SupportAssignee | null;
  lastMessageAt: string;
  lastMessagePreview: string;
  unreadByCustomer: number;
  createdAt: string;
  feedbackPoint?: number;
  feedback?: string;
}

/** API envelope (`res.data.data` in TrackVid). */
export interface SupportResponse<T> {
  data: T;
  message?: string;
}

export interface SupportTicketDetail {
  ticket: SupportTicket;
  messages: SupportMessage[];
}

export interface SupportResolvePayload {
  feedbackPoint?: number;
  feedback?: string;
}

/** Simulated SSE events (`message` and `ticket-update` in TrackVid). */
export interface SupportStreamHandlers {
  onMessage: (message: SupportMessage) => void;
  onTicketUpdate: (ticket: SupportTicket) => void;
}
