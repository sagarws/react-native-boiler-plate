"use client";

import { format, formatDistanceToNowStrict } from "date-fns";
import { Fragment, useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Icon } from "@/components/icons/icon";
import { FilterSelect } from "@/components/ui/form-field";
import { PageHeading } from "@/components/ui/page-heading";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { StatusPill } from "@/components/ui/status-pill";
import { errorMessage, toast } from "@/lib/events";
import { useAsync } from "@/lib/use-async";
import { SUPPORT_MAX_FILES, SupportChatService } from "@/services/supportChat-service";
import type { SupportAttachment, SupportMessage, SupportStreamHandlers, SupportTicket, SupportTicketDetail } from "@/types/support";
import { AttachmentCard, AttachmentPreviewDialog, PendingFileChip } from "./support-attachments";
import { NewTicketDialog, ResolveDialog } from "./support-dialogs";
import { dayLabelFor, pickValidFiles, statusFilterOptions, statusMeta, SUPPORT_ACCEPT } from "./support-helpers";

/**
 * /support — TrackVid `pages/SupportChat.tsx` in the template's customer-inbox layout (`c-inbox`):
 * conversation list on the left, chat panel on the right, composer with attachments, new-ticket and
 * resolve dialogs. The ticket SSE stream is simulated by `SupportChatService.subscribeTicketStream`.
 * Route access (`support::view`) is enforced by the dashboard shell's route guard.
 */
export function SupportPage() {
  const [status, setStatus] = useState("");
  const list = useAsync(() => SupportChatService.listTickets(status || undefined), [status]);
  const tickets = list.data?.data ?? [];

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [convo, setConvo] = useState<SupportTicketDetail | null>(null);
  const [convoLoading, setConvoLoading] = useState(false);
  const [convoError, setConvoError] = useState<string | null>(null);

  const [body, setBody] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [sending, setSending] = useState(false);
  const [newOpen, setNewOpen] = useState(false);
  const [resolveOpen, setResolveOpen] = useState(false);
  const [preview, setPreview] = useState<SupportAttachment | null>(null);

  const requestRef = useRef(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const messagesRef = useRef<HTMLDivElement>(null);

  /** Re-read the list without the loading state (after send / resolve / stream events). */
  const refreshTickets = () => {
    SupportChatService.listTickets(status || undefined)
      .then((res) => list.setData(res))
      .catch(() => {
        // Background refresh only: the list keeps its last good data; the user can press Refresh.
      });
  };

  const clearUnread = (ticketId: string) => {
    list.setData((prev) => (prev ? { ...prev, data: prev.data.map((t) => (t._id === ticketId ? { ...t, unreadByCustomer: 0 } : t)) } : prev));
  };

  const openTicket = (ticketId: string) => {
    requestRef.current += 1;
    const req = requestRef.current;
    setSelectedId(ticketId);
    setConvoLoading(true);
    setConvoError(null);
    SupportChatService.getTicket(ticketId)
      .then((res) => {
        if (req !== requestRef.current) return;
        setConvo(res.data);
        SupportChatService.markRead(ticketId).catch(() => {
          // Same as TrackVid: marking read is best effort; the badge is cleared locally anyway.
        });
        clearUnread(ticketId);
      })
      .catch((err: unknown) => {
        if (req !== requestRef.current) return;
        const msg = errorMessage(err, "Could not load ticket");
        setConvoError(msg);
        toast.error(msg);
      })
      .finally(() => {
        if (req === requestRef.current) setConvoLoading(false);
      });
  };

  // Stream handlers live in a ref so the subscription only restarts when the ticket changes.
  const streamRef = useRef<SupportStreamHandlers | null>(null);
  useEffect(() => {
    streamRef.current = {
      onMessage: (message: SupportMessage) => {
        setConvo((prev) =>
          prev && prev.ticket._id === message.ticket && !prev.messages.some((m) => m._id === message._id)
            ? { ...prev, messages: [...prev.messages, message] }
            : prev,
        );
        if (message.senderType === "agent") {
          // The conversation is open, so the reply is read right away.
          SupportChatService.markRead(message.ticket)
            .then(refreshTickets)
            .catch(() => {
              // Best effort, see openTicket.
            });
        } else {
          refreshTickets();
        }
      },
      onTicketUpdate: (ticket: SupportTicket) => {
        setConvo((prev) => (prev && prev.ticket._id === ticket._id ? { ...prev, ticket } : prev));
      },
    };
  });

  useEffect(() => {
    if (!selectedId) return;
    // Simulated EventSource; the returned function clears its timers (TrackVid: es.close()).
    return SupportChatService.subscribeTicketStream(selectedId, {
      onMessage: (m) => streamRef.current?.onMessage(m),
      onTicketUpdate: (t) => streamRef.current?.onTicketUpdate(t),
    });
  }, [selectedId]);

  const messageCount = convo?.messages.length ?? 0;
  useEffect(() => {
    const el = messagesRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messageCount, selectedId]);

  const handleSend = async () => {
    if (!selectedId) return;
    if (!body.trim() && files.length === 0) return;
    setSending(true);
    const fd = new FormData();
    if (body.trim()) fd.append("body", body.trim());
    files.forEach((f) => fd.append("attachments", f));
    try {
      const res = await SupportChatService.sendMessage(selectedId, fd);
      const sent = res.data;
      setConvo((prev) => (prev && prev.ticket._id === sent.ticket && !prev.messages.some((m) => m._id === sent._id) ? { ...prev, messages: [...prev.messages, sent] } : prev));
      setBody("");
      setFiles([]);
      refreshTickets();
    } catch (err) {
      toast.error(errorMessage(err, "Could not send message"));
    } finally {
      setSending(false);
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  };

  const totalUnread = tickets.reduce((sum, t) => sum + (t.unreadByCustomer || 0), 0);
  const selectedTicket = convo && convo.ticket._id === selectedId ? convo.ticket : null;
  const isResolved = selectedTicket?.status === "RESOLVED";
  const sendDisabled = sending || !selectedId || (!body.trim() && files.length === 0);
  const sortedMessages = convo ? [...convo.messages].sort((a, b) => a.createdAt.localeCompare(b.createdAt)) : [];
  /** Day divider before the first message of each calendar day. */
  const dayKeys = sortedMessages.map((m) => format(new Date(m.createdAt), "yyyy-MM-dd"));

  const startButton = (
    <button type="button" className="primary-button" onClick={() => setNewOpen(true)}>
      <Icon name="plus" /> Start a conversation
    </button>
  );

  return (
    <div className="tv-page">
      <PageHeading
        title="Support"
        crumbs={[{ label: "Help center" }]}
        subtitle={
          <>
            Chat with our support team — replies usually within a few hours.
            {totalUnread > 0 ? (
              <>
                {" · "}
                <strong className="tv-support-unread-text">
                  {totalUnread} new {totalUnread === 1 ? "reply" : "replies"}
                </strong>
              </>
            ) : null}
          </>
        }
        actions={
          <>
            <button type="button" className="icon-button" aria-label="Refresh" title="Refresh" onClick={list.reload}>
              <Icon name="refresh" />
            </button>
            <button type="button" className="primary-button" onClick={() => setNewOpen(true)}>
              <Icon name="plus" /> New ticket
            </button>
          </>
        }
      />

      <div className="c-inbox tv-support-inbox">
        <aside className="glass-card c-conversations" aria-label="Conversations">
          <h2>
            Conversations
            {tickets.length > 0 ? <span>{tickets.length}</span> : null}
          </h2>
          <div className="tv-support-filter">
            <FilterSelect label="Filter by status" value={status} onChange={setStatus} allLabel="All statuses" options={statusFilterOptions} />
          </div>
          <div>
            {list.loading ? (
              <LoadingState label="Loading conversations…" />
            ) : list.error ? (
              <ErrorState message={list.error} onRetry={list.reload} title="Could not load tickets" />
            ) : tickets.length === 0 ? (
              <EmptyState
                icon="chats-circle"
                title={status ? "No tickets with this status" : "No conversations yet"}
                action={
                  status ? (
                    <button type="button" className="secondary-button" onClick={() => setStatus("")}>
                      Show all
                    </button>
                  ) : (
                    <button type="button" className="secondary-button" onClick={() => setNewOpen(true)}>
                      <Icon name="plus" /> Start a conversation
                    </button>
                  )
                }
              />
            ) : (
              tickets.map((t) => {
                const meta = statusMeta(t.status);
                const unread = t.unreadByCustomer > 0;
                return (
                  <button
                    key={t._id}
                    type="button"
                    className={`c-conversation tv-support-conversation ${selectedId === t._id ? "selected" : ""} ${unread ? "is-unread" : ""}`.trim()}
                    aria-current={selectedId === t._id ? "true" : undefined}
                    onClick={() => openTicket(t._id)}
                  >
                    <span className="c-avatar">
                      <Icon name="headset" />
                    </span>
                    <span>
                      <span className="tv-support-conversation-top">
                        <strong>{t.subject}</strong>
                        <span className="tv-support-conversation-time">
                          {t.lastMessageAt ? formatDistanceToNowStrict(new Date(t.lastMessageAt)) : ""}
                        </span>
                        {unread ? (
                          <span className="tv-support-unread" aria-label={`${t.unreadByCustomer} unread`}>
                            {t.unreadByCustomer}
                          </span>
                        ) : null}
                      </span>
                      <small>{t.lastMessagePreview || "—"}</small>
                      <em>
                        <StatusPill value={meta.label} tone={meta.tone} />
                        <span>#{t.ticketNumber}</span>
                      </em>
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </aside>

        <section className="glass-card c-chat-panel tv-support-panel" aria-label="Conversation">
          {!selectedId ? (
            <div className="tv-support-welcome">
              <span className="tv-support-welcome-icon">
                <Icon name="headset" />
              </span>
              <small>Need a hand?</small>
              <h2>We&apos;re here to help</h2>
              <p>Pick a conversation from the list, or start a new one. Our support team usually replies within a few hours.</p>
              {startButton}
            </div>
          ) : convoLoading && !selectedTicket ? (
            <LoadingState label="Loading conversation…" />
          ) : convoError || !selectedTicket ? (
            <ErrorState message={convoError} onRetry={() => openTicket(selectedId)} title="Could not load ticket" />
          ) : (
            <>
              <header>
                <div>
                  <div className="tv-row">
                    <h2>{selectedTicket.subject}</h2>
                    <StatusPill value={statusMeta(selectedTicket.status).label} tone={statusMeta(selectedTicket.status).tone} />
                  </div>
                  <small>
                    #{selectedTicket.ticketNumber} · Opened {format(new Date(selectedTicket.createdAt), "PPp")}
                    {selectedTicket.assignee ? (
                      <>
                        {" · Handled by "}
                        <strong>{selectedTicket.assignee.name}</strong>
                      </>
                    ) : null}
                  </small>
                </div>
                {!isResolved ? (
                  <button type="button" className="secondary-button compact-button" onClick={() => setResolveOpen(true)}>
                    <Icon name="check-circle" /> Mark as resolved
                  </button>
                ) : null}
              </header>

              <div ref={messagesRef} className="c-messages" role="log" aria-live="polite" aria-label={`Conversation: ${selectedTicket.subject}`}>
                {sortedMessages.length === 0 ? <p className="tv-muted tv-support-no-messages">No messages yet. Say hello below.</p> : null}
                {sortedMessages.map((m, i) => {
                  const date = new Date(m.createdAt);
                  const showDay = i === 0 || dayKeys[i] !== dayKeys[i - 1];
                  const divider = showDay ? (
                    <div className="tv-support-day" role="separator">
                      <span>{dayLabelFor(date)}</span>
                    </div>
                  ) : null;
                  if (m.senderType === "system") {
                    return (
                      <Fragment key={m._id}>
                        {divider}
                        <p className="tv-support-system">
                          {m.body} · {format(date, "HH:mm")}
                        </p>
                      </Fragment>
                    );
                  }
                  const isCustomer = m.senderType === "customer";
                  return (
                    <Fragment key={m._id}>
                      {divider}
                      {/* Template classes: `.c-message.agent` is the right-aligned "own" bubble, used here for the customer. */}
                      <div className={`c-message tv-support-message ${isCustomer ? "agent" : ""}`.trim()}>
                        <small>{isCustomer ? "You" : m.senderName}</small>
                        {m.body ? <p>{m.body}</p> : null}
                        {m.attachments?.length > 0 ? (
                          <div className="tv-support-attachments">
                            {m.attachments.map((a) => (
                              <AttachmentCard key={a.key} attachment={a} onOpen={setPreview} />
                            ))}
                          </div>
                        ) : null}
                        <time dateTime={m.createdAt}>{format(date, "HH:mm")}</time>
                      </div>
                    </Fragment>
                  );
                })}
              </div>

              <form
                className="c-reply tv-support-composer"
                onSubmit={(e) => {
                  e.preventDefault();
                  void handleSend();
                }}
              >
                <label htmlFor="tv-support-reply" className="sr-only">
                  Message
                </label>
                {files.length > 0 ? (
                  <div className="tv-support-file-list">
                    {files.map((f, idx) => (
                      <PendingFileChip key={`${f.name}-${f.size}-${idx}`} file={f} disabled={sending} onRemove={() => setFiles((prev) => prev.filter((_, i) => i !== idx))} />
                    ))}
                  </div>
                ) : null}
                <div className="tv-support-composer-row">
                  <button
                    type="button"
                    className="icon-button"
                    aria-label="Attach files"
                    title={`Attach files (PNG, JPG, WEBP or PDF, max ${SUPPORT_MAX_FILES})`}
                    onClick={() => fileInputRef.current?.click()}
                    disabled={sending || files.length >= SUPPORT_MAX_FILES || isResolved}
                  >
                    <Icon name="paperclip" />
                  </button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    className="sr-only"
                    tabIndex={-1}
                    accept={SUPPORT_ACCEPT}
                    multiple
                    onChange={(e) => {
                      const picked = Array.from(e.currentTarget.files ?? []);
                      setFiles((prev) => pickValidFiles(picked, prev));
                      e.currentTarget.value = "";
                    }}
                  />
                  <textarea
                    id="tv-support-reply"
                    rows={2}
                    placeholder={isResolved ? "This ticket is resolved. Send a message to reopen it." : "Type a message…"}
                    value={body}
                    onChange={(e) => setBody(e.currentTarget.value)}
                    onKeyDown={handleKeyDown}
                  />
                  <button type="submit" className="primary-button" disabled={sendDisabled}>
                    {sending ? "Sending…" : "Send"} {!sending ? <Icon name="paper-plane" /> : null}
                  </button>
                </div>
                <small>
                  Press <strong>Enter</strong> to send, <strong>Shift + Enter</strong> for new line
                </small>
              </form>
            </>
          )}
        </section>
      </div>

      {newOpen ? (
        <NewTicketDialog
          onClose={() => setNewOpen(false)}
          onCreated={(ticket) => {
            setNewOpen(false);
            if (status) setStatus("");
            else refreshTickets();
            openTicket(ticket._id);
          }}
        />
      ) : null}
      {resolveOpen && selectedId ? (
        <ResolveDialog
          ticketId={selectedId}
          onClose={() => setResolveOpen(false)}
          onResolved={(ticket) => {
            setResolveOpen(false);
            setConvo((prev) => (prev && prev.ticket._id === ticket._id ? { ...prev, ticket } : prev));
            refreshTickets();
          }}
        />
      ) : null}
      {preview ? <AttachmentPreviewDialog attachment={preview} onClose={() => setPreview(null)} /> : null}
    </div>
  );
}
