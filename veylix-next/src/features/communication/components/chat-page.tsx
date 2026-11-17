// @ts-nocheck
import Link from "next/link";
import { Fragment, useEffect, useMemo, useState } from "react";
import { Icon } from "@/components/icons/icon";
import { AppDialog } from "@/components/ui/app-dialog";
import { CommercePageHeading } from "@/components/ui/commerce-page-heading";
import { StatusPill } from "@/components/ui/status-pill";
import { modulesById } from "@/config/modules/registry";
import {
  DEFAULT_CHAT_TEST_MESSAGE,
  chatReplyModes,
} from "@/features/communication/constants";
import { generateAiText } from "@/lib/ai-client";
import { showToast } from "@/lib/events";
import { formatCurrency } from "@/lib/format";
import { buildHref } from "@/lib/navigation";
import { findRecord, listRecords } from "@/lib/store/core";
import { calculateOrderTotal } from "@/lib/store/orders";
import { getConversations, updateConversation } from "@/lib/store/preferences";

function getNameInitials(e) {
  return e
    .split(" ")
    .map((e) => e[0])
    .join("");
}

function resolveChatThreadId(e = "") {
  return (
    (e && getConversations().find((t) => t.customerId === e)?.id) || "chat-1"
  );
}

export function ChatPage({ initialCustomerId = "" }) {
  const t = modulesById.chat;
  const [n, r] = useState(0);
  const [i, a] = useState(() => resolveChatThreadId(initialCustomerId));
  const [o, s] = useState("");
  const [c, u] = useState("");
  const [d, f] = useState("demo");
  const [p, m] = useState("");
  const [h, g] = useState(false);
  const [_, v] = useState(false);
  const [y, b] = useState(DEFAULT_CHAT_TEST_MESSAGE);
  const [x, S] = useState("rule");
  const [C, w] = useState("");
  const T = getConversations();
  const E = T.find((e) => e.id === i) || T[0];
  const D = findRecord("customers", E.customerId);
  const O = listRecords("orders").filter((e) => e.customerId === E.customerId);
  useEffect(() => {
    u(E.draft || "");
    m("");
  }, [E.id, n]);
  const k = useMemo(() => {
    const e = o.toLowerCase();
    return e
      ? T.filter((t) => {
          const n = findRecord("customers", t.customerId);
          return [
            getNameInitials(n?.name || ""),
            n?.name,
            t.subject,
            t.status,
            t.channel,
          ]
            .join(" ")
            .toLowerCase()
            .includes(e);
        })
      : T;
  }, [T, o, n]);
  const A = () => r((e) => e + 1);
  const j = (e) => {
    updateConversation(E.id, {
      draft: c,
    });
    const t = T.find((t) => t.id === e);
    a(e);
    u(t?.draft || "");
    m("");
  };
  return (
    <Fragment>
      <CommercePageHeading
        title={t.title}
        actions={
          <Fragment>
            <Link
              className="secondary-button"
              href={buildHref("/commerce/automations")}
            >
              Reply rules
              <Icon name="arrow-right" />
            </Link>
            <button
              type="button"
              className="secondary-button"
              data-c-action="incoming-message"
              onClick={() => {
                w("");
                v(true);
              }}
            >
              Simulate incoming message
            </button>
          </Fragment>
        }
      />
      <div className="c-inbox">
        <aside
          className="glass-card c-conversations"
          aria-label="Customer conversations"
        >
          <h2>
            {"Conversations "}
            <span>{T.filter((e) => e.status === "Open").length}</span>
          </h2>
          <label className="c-search">
            <Icon name="search" />
            <input
              type="search"
              data-chat-search
              placeholder="Find a conversation"
              aria-label="Search conversations"
              value={o}
              onChange={(e) => s(e.target.value)}
            />
          </label>
          <div>
            {k.map((e) => {
              const t = findRecord("customers", e.customerId);
              return (
                <button
                  key={e.id}
                  type="button"
                  className={`c-conversation ${e.id === E.id ? "selected" : ""}`}
                  data-c-action="select-chat"
                  data-id={e.id}
                  onClick={() => j(e.id)}
                >
                  <span className="c-avatar">{getNameInitials(t.name)}</span>
                  <span>
                    <strong>{t.name}</strong>
                    <small>{e.subject}</small>
                    <em>
                      {e.status}
                      {" · "}
                      {e.channel}
                    </em>
                  </span>
                </button>
              );
            })}
          </div>
        </aside>
        <section className="glass-card c-chat-panel">
          <header>
            <div>
              <h2>{D.name}</h2>
              <small>{E.subject}</small>
            </div>
            <button
              type="button"
              className="secondary-button"
              data-c-action="resolve-chat"
              data-id={E.id}
              onClick={() => {
                updateConversation(E.id, {
                  status: E.status === "Resolved" ? "Open" : "Resolved",
                });
                A();
              }}
            >
              {E.status === "Resolved" ? "Reopen" : "Resolve"}
            </button>
          </header>
          <div
            className="c-messages"
            role="log"
            aria-label={`Conversation with ${D.name}`}
          >
            {E.messages.map((e, t) => (
              <div key={`${e.time}-${t}`} className={`c-message ${e.role}`}>
                <small>
                  {e.role === "customer"
                    ? D.name
                    : e.role === "ai"
                      ? "AI template"
                      : "You"}
                </small>
                <p>{e.text}</p>
                <time>{e.time}</time>
              </div>
            ))}
          </div>
          <form
            data-c-form="chat"
            data-id={E.id}
            className="c-reply"
            onSubmit={(e) => {
              e.preventDefault();
              const t = c.trim();
              if (t) {
                updateConversation(E.id, {
                  draft: "",
                  status: "Open",
                  messages: [
                    ...E.messages,
                    {
                      role: "agent",
                      text: t,
                      time: new Date().toLocaleTimeString("en-US", {
                        hour: "numeric",
                        minute: "2-digit",
                      }),
                    },
                  ],
                });
                u("");
                m("");
                showToast("Reply added.");
                A();
              } else {
                m("Write a reply first.");
              }
            }}
          >
            <label htmlFor="chat-reply">
              {"Reply to "}
              {D.name.split(" ")[0]}
            </label>
            <textarea
              id="chat-reply"
              name="message"
              rows={3}
              required
              placeholder="Write a thoughtful reply…"
              value={c}
              onChange={(e) => u(e.target.value)}
            />
            <p className="c-form-error" role="alert">
              {p}
            </p>
            <div className="c-toolbar">
              <label className="c-mode-select">
                {"AI mode "}
                <select
                  id="chat-ai-mode"
                  value={d}
                  onChange={(e) => f(e.target.value)}
                >
                  <option value="demo">Template responses</option>
                  <option value="connected">Connected provider</option>
                </select>
              </label>
              <button
                type="button"
                className="secondary-button"
                data-c-action="suggest-reply"
                data-id={E.id}
                disabled={h}
                onClick={async () => {
                  g(true);
                  m("");
                  try {
                    const e = await generateAiText({
                      task: "Support reply",
                      prompt: E.messages
                        .map((e) => `${e.role}: ${e.text}`)
                        .join("\n"),
                      productId: void 0,
                      customerId: E.customerId,
                      mode: d,
                      image: void 0,
                    });
                    u(e.text);
                    updateConversation(E.id, {
                      draft: e.text,
                    });
                    showToast(`${e.mode} reply ready. Review before sending.`);
                  } catch (e) {
                    m(
                      e instanceof Error
                        ? e.message
                        : "A reply could not be prepared.",
                    );
                  } finally {
                    g(false);
                  }
                }}
              >
                <Icon name="sparkle" />
                {" Suggest reply"}
              </button>
              <button type="submit" className="primary-button">
                <Icon name="paper-plane" />
                {" Add local reply"}
              </button>
            </div>
          </form>
        </section>
        <aside
          className="glass-card c-customer-context"
          aria-label="Customer details"
        >
          <span className="c-avatar large">{getNameInitials(D.name)}</span>
          <h2>{D.name}</h2>
          <p>{D.email}</p>
          <StatusPill value={D.segment} />
          <dl className="c-details">
            <div>
              <dt>Location</dt>
              <dd>{D.city}</dd>
            </div>
            <div>
              <dt>Orders</dt>
              <dd>{O.length}</dd>
            </div>
            <div>
              <dt>Order value</dt>
              <dd>
                {formatCurrency(
                  O.filter((e) => e.status !== "Cancelled").reduce(
                    (e, t) => e + calculateOrderTotal(t),
                    0,
                  ),
                  2,
                )}
              </dd>
            </div>
          </dl>
          <h3>Recent orders</h3>
          {O.map((e) => (
            <Link
              key={e.id}
              className="c-context-order"
              href={buildHref(
                `/commerce/orders?q=${encodeURIComponent(e.number)}`,
              )}
            >
              <strong>{e.number}</strong>
              <StatusPill value={e.status} />
              <span>{formatCurrency(calculateOrderTotal(e), 2)}</span>
            </Link>
          ))}
          <Link
            className="secondary-button"
            href={buildHref("/commerce/ai-voice")}
          >
            {"Voice & product assist"}
            <Icon name="arrow-right" />
          </Link>
        </aside>
      </div>
      {_ ? (
        <AppDialog title="Preview a customer message" onClose={() => v(false)}>
          <form
            className="c-form"
            data-c-form="incoming"
            data-id={E.id}
            onSubmit={async (e) => {
              e.preventDefault();
              const t = y.trim();
              if (!t) w("Enter a customer message.");
              else {
                w("");
                try {
                  const e = /order|status|track|delivery/i.test(t)
                    ? "Order status question"
                    : /product|sku|backpack|shirt|mug/i.test(t)
                      ? "Product question"
                      : "New customer message";
                  const n = listRecords("automations").find(
                    (t) => t.status === "Active" && t.trigger === e,
                  );
                  const r =
                    x === "rule"
                      ? {
                          Manual: "manual",
                          "Suggest draft": "suggest",
                          "Auto reply in demo": "auto",
                        }[n?.mode || ""] || "manual"
                      : x;
                  const i = [
                    ...E.messages,
                    {
                      role: "customer",
                      text: t,
                      time: "Just now",
                    },
                  ];
                  let a = "";
                  if (
                    r !== "manual" &&
                    n?.escalate !== "Always" &&
                    !/refund|disput|cancel|damag|chargeback/i.test(t) &&
                    listRecords("orders").some(
                      (e) => e.customerId === E.customerId,
                    )
                  ) {
                    const e = await generateAiText({
                      task: "Support reply",
                      prompt: t,
                      productId: void 0,
                      customerId: E.customerId,
                      image: void 0,
                    });
                    if (r === "auto") {
                      i.push({
                        role: "ai",
                        text: e.text,
                        time: "Just now",
                      });
                    } else {
                      a = e.text;
                    }
                  } else {
                    if (r !== "manual") {
                      showToast(
                        "This request needs a teammate. Automatic reply was skipped.",
                      );
                    }
                  }
                  updateConversation(E.id, {
                    messages: i,
                    draft: a,
                    status: "Open",
                  });
                  u(a);
                  v(false);
                  b(DEFAULT_CHAT_TEST_MESSAGE);
                  S("rule");
                  A();
                } catch (e) {
                  w(
                    e instanceof Error
                      ? e.message
                      : "The message could not be added.",
                  );
                }
              }
            }}
          >
            <label className="c-field">
              <span>Customer message</span>
              <textarea
                name="message"
                rows={4}
                required
                value={y}
                onChange={(e) => b(e.target.value)}
              />
            </label>
            <label className="c-field">
              <span>Reply behavior</span>
              <select name="mode" value={x} onChange={(e) => S(e.target.value)}>
                {chatReplyModes.map(([e, t]) => (
                  <option key={e} value={e}>
                    {t}
                  </option>
                ))}
              </select>
            </label>
            <p>
              Uses a template response. Refunds, disputes and missing-order
              requests go to a teammate.
            </p>
            <p className="c-form-error" role="alert">
              {C}
            </p>
            <button type="submit" className="primary-button">
              Add message
            </button>
          </form>
        </AppDialog>
      ) : null}
    </Fragment>
  );
}
