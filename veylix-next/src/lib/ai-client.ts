// @ts-nocheck
import { findRecord, listRecords } from "@/lib/store/core";
import { calculateOrderTotal } from "@/lib/store/orders";
import { saveRecord } from "@/lib/store/records";

export async function checkAiServerHealth() {
  const e = await fetch("/api/health", {
    signal: AbortSignal.timeout(5e3),
  });
  if (!e.ok || !e.headers.get("content-type")?.includes("application/json"))
    throw Error(
      "AI server is not running. Start the optional API server using the included setup guide.",
    );
  return e.json();
}

function buildAiContext(e, t, n = "Product copy") {
  const r = listRecords("products");
  const i = listRecords("orders");
  const a = (
    !["Catalog audit", "Inventory planning"].includes(n) && e
      ? [findRecord("products", e)].filter(Boolean)
      : r
  ).slice(0, 20);
  const o = (e) => String(e || "").slice(0, 350);
  const s = (e) => o(e).slice(0, 96);
  const c = {
    products: a.map(
      ({
        name: e,
        sku,
        category,
        price,
        stock,
        threshold,
        status: c,
        description,
        seoTitle,
        seoDescription,
      }) => ({
        name: s(e),
        sku: s(sku),
        category: s(category),
        price: price,
        stock: stock,
        threshold: threshold,
        status: c,
        description: o(description),
        seoTitle: s(seoTitle),
        seoDescription: o(seoDescription),
      }),
    ),
    policies: listRecords("knowledge")
      .filter((e) => e.status === "Active")
      .slice(0, 10)
      .map((e) => ({
        title: s(e.name),
        content: o(e.content),
      })),
    store: "Veylix local workspace",
    scope: {
      totalProducts: r.length,
      includedProducts: a.length,
      currency: "USD",
      note: "Local records only. Not a live ledger. Truncated record samples are explicitly counted.",
    },
  };
  if (
    ((c.orders = t
      ? i
          .filter((e) => e.customerId === t)
          .slice(0, 20)
          .map((e) => ({
            number: e.number,
            status: e.status,
            payment: e.payment,
            total: calculateOrderTotal(e),
            date: e.date,
          }))
      : []),
    ["Sales analysis", "Fulfillment review"].includes(n))
  ) {
    const e = i.filter((e) => e.payment === "Paid" && e.status !== "Cancelled");
    const t = e.reduce((e, t) => e + calculateOrderTotal(t), 0);
    c.sales = {
      orderCount: i.length,
      paidOrders: e.length,
      paidOrderValue: Math.round(t * 100) / 100,
      averagePaidOrderValue: e.length
        ? Math.round((t / e.length) * 100) / 100
        : 0,
      statusCounts: i.reduce(
        (e, t) => ({
          ...e,
          [t.status]: (e[t.status] || 0) + 1,
        }),
        {},
      ),
      dateRange: [...new Set(i.map((e) => e.date).filter(Boolean))]
        .sort()
        .filter((e, t, n) => t === 0 || t === n.length - 1),
      definition:
        "Paid non-cancelled order totals include shipping, tax and discounts. Refunds are not deducted; this is not net revenue.",
    };
  }
  if (n === "Fulfillment review") {
    c.fulfillment = listRecords("fulfillment")
      .slice(0, 30)
      .map(({ orderId, carrier, tracking, eta, status: i }) => ({
        order: findRecord("orders", orderId)?.number,
        carrier: carrier,
        tracking: tracking,
        eta: eta,
        status: i,
      }));
  }
  if (n === "Cart recovery") {
    c.carts = listRecords("abandoned")
      .slice(0, 10)
      .map(({ items, total, value, status: r, date }) => ({
        items: o(items),
        total: total,
        value: value,
        status: r,
        date: date,
      }));
  }
  if (["Review insights", "Review response"].includes(n)) {
    c.reviews = listRecords("reviews")
      .slice(0, 20)
      .map(
        ({
          productId,
          rating,
          title,
          comment,
          review,
          message,
          status: c,
        }) => ({
          product: s(findRecord("products", productId)?.name),
          rating: rating,
          title: s(title),
          comment: o(comment || review || message),
          status: c,
        }),
      );
  }
  if (n === "Campaign writing") {
    c.promotions = listRecords("promotions")
      .filter((e) => ["Active", "Scheduled"].includes(e.status))
      .slice(0, 10)
      .map(({ name: e, offer, start, end, status: i }) => ({
        name: s(e),
        offer: o(offer),
        start: start,
        end: end,
        status: i,
      }));
  }
  if (n === "FAQ drafting") {
    c.faqs = listRecords("faqs")
      .filter((e) => e.status === "Published")
      .slice(0, 15)
      .map(({ name: e, answer }) => ({
        question: s(e),
        answer: o(answer),
      }));
  }
  for (const [e, t] of [
    ["reviews", "reviews"],
    ["carts", "abandoned"],
    ["fulfillment", "fulfillment"],
    ["promotions", "promotions"],
    ["faqs", "faqs"],
  ]) {
    if (c[e]) {
      c.scope[e] = {
        totalRecords: listRecords(t).length,
        includedRecords: c[e].length,
      };
    }
  }
  return c;
}

function buildTemplateAiResponse(e, t, n) {
  const r = n.products[0];
  if (e === "Support reply") {
    const e = n.orders[0];
    return e
      ? `Hi! Thanks for reaching out. Your order ${e.number} is currently ${e.status.toLowerCase()}. We’re happy to help with the next step. Let us know if there’s anything else you need.`
      : "Hi! Thanks for getting in touch. I’d be happy to help. Could you share your order number or the name of the product you’re looking at so we can check the details?";
  }
  return e === "Product copy" && r
    ? `${r.name}\n\nA thoughtful addition to your everyday. ${r.description}\n\nAvailable for $${Number(r.price).toFixed(2)}. Browse the product details to find your perfect fit.`
    : e === "SEO" && r
      ? `${r.name} | Veylix\n\nExplore ${r.name.toLowerCase()} at Veylix. Thoughtfully selected everyday essentials. View product details, availability and shipping information.`
      : e === "Inventory planning"
        ? `Review these products before your next purchase order:\n\n${
            n.products
              .filter((e) => e.stock <= Number(e.threshold ?? 15))
              .map((e) => `• ${e.name} (${e.sku}): ${e.stock} units available.`)
              .join("\n") || "No low-stock products in the selected context."
          }\n\nConfirm supplier lead times and expected demand before setting reorder quantities.`
        : e === "Sales analysis"
          ? `Local order snapshot\n\n${n.sales.orderCount} orders · ${n.sales.paidOrders} paid, non-cancelled orders\nPaid order value: $${n.sales.paidOrderValue.toFixed(2)}\nAverage paid order value: $${n.sales.averagePaidOrderValue.toFixed(2)}\n\n${Object.entries(
              n.sales.statusCounts,
            )
              .map(([e, t]) => `${e}: ${t}`)
              .join(
                "\n",
              )}\n\n${n.sales.definition}\nComparable period data is needed before calculating growth.`
          : e === "Catalog audit"
            ? `Catalog review · ${n.scope.includedProducts} of ${n.scope.totalProducts} products\n\n${
                n.products
                  .map((e) => {
                    const t = [
                      !e.description && "description",
                      !e.seoTitle && "SEO title",
                      !e.seoDescription && "SEO description",
                      e.status === "Active" &&
                        e.stock === 0 &&
                        "stock availability",
                    ].filter(Boolean);
                    return t.length
                      ? `• ${e.sku} — review ${t.join(", ")}`
                      : "";
                  })
                  .filter(Boolean)
                  .join("\n") || "No gaps detected in these fields."
              }\n\nPrepared checks only. Review product facts before updating your catalog.`
            : e === "Cart recovery"
              ? "Subject: Your picks are still here\n\nHi {{customer.name}},\nYou left a few things in your cart. When you are ready, you can review your items here: {{cart.recovery_url}}. If you have a question, our team is happy to help.\n\nCheck current availability before sending. This draft has not been sent."
              : e === "Review insights"
                ? `Review snapshot\n\n${n.reviews.length} review records available.\n${n.reviews.map((e) => `• ${e.product || "Product"} — ${e.rating || "No"} rating: ${e.comment || "No review text supplied"}`).join("\n")}\n\nConnect the AI provider to group feedback into themes, or add your own summary.`
                : e === "FAQ drafting"
                  ? `Approved information for your FAQ draft\n\n${n.policies.map((e) => `${e.title}\n${e.content}`).join("\n\n")}\n\nReview existing published FAQs to avoid duplicates. Connect the provider to generate question-and-answer suggestions.`
                  : e === "Fulfillment review"
                    ? `Fulfillment review\n\n${Object.entries(
                        n.sales.statusCounts,
                      )
                        .map(([e, t]) => `${e}: ${t} orders`)
                        .join(
                          "\n",
                        )}\n\n${n.fulfillment.map((e) => `• ${e.order}: ${e.carrier} — ${e.status}; expected ${e.eta || "not set"}`).join("\n")}\n\nFollow up with the carrier for explicitly delayed shipments. No customer update has been sent.`
                    : e === "Campaign writing"
                      ? "Subject: A few good things for your everyday\n\nDiscover thoughtful essentials, from your first coffee to your last errand. Explore the latest Veylix collection and find something that feels like you.\n\nExplore the collection"
                      : e === "Review response"
                        ? "Thank you for taking the time to share your experience. We appreciate your feedback and would love to help with any details. Please contact our team with your order reference."
                        : e === "Product identification"
                          ? "Image recognition requires a connected provider. Connect the AI server to analyze an image, or use the product/SKU search in the catalog for an exact match."
                          : e === "Translation"
                            ? "Translation requires the connected AI provider. In manual mode, use the text area to write or paste your own translation, then save it as a draft."
                            : `Template responses insight: review your current product availability, fulfillment queue and customer questions together. Start with low-stock items and orders awaiting dispatch.\n\nYour request: ${t}\n\nConnect an AI provider for a generated answer tailored to this request.`;
}

export async function generateAiText({
  task,
  prompt: t,
  productId,
  customerId,
  language = "English",
  mode = "demo",
  image,
}) {
  const s = buildAiContext(productId, customerId, task);
  const c = `${t}\n\nOutput language: ${language}.`;
  let l;
  if (mode === "connected") {
    const t = await fetch("/api/ai/generate", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        task: task,
        prompt: c,
        context: s,
        image: image,
      }),
      signal: AbortSignal.timeout(9e4),
    });
    if (!t.headers.get("content-type")?.includes("application/json"))
      throw Error(
        "AI server is unavailable. Start the optional server or choose Template responses.",
      );
    const n = await t.json();
    if (!t.ok)
      throw Error(
        n.error || "The AI provider could not complete this request.",
      );
    l = {
      text: n.text,
      mode: "Connected provider",
      inputTokens: n.usage?.input_tokens || 0,
      outputTokens: n.usage?.output_tokens || 0,
    };
  } else
    l = {
      text: buildTemplateAiResponse(task, t, s),
      mode: "Template responses",
      inputTokens: 0,
      outputTokens: 0,
    };
  saveRecord("ai-history", {
    task: task,
    mode: l.mode,
    inputTokens: l.inputTokens,
    outputTokens: l.outputTokens,
    date: new Date().toISOString(),
    output: l.text,
  });
  return l;
}

export async function transcribeAudioFile(e) {
  if (!e || e.size > 20971520) throw Error("Choose an audio file under 20 MB.");
  const t = new FormData();
  t.append("file", e);
  const n = await fetch("/api/ai/transcribe", {
    method: "POST",
    body: t,
    signal: AbortSignal.timeout(9e4),
  });
  if (!n.headers.get("content-type")?.includes("application/json"))
    throw Error(
      "Voice transcription needs the optional AI server and a transcription model.",
    );
  const r = await n.json();
  if (!n.ok) throw Error(r.error || "Transcription failed.");
  return r.text;
}

export function readImageAsDataUrl(e) {
  return !e ||
    !["image/png", "image/jpeg", "image/webp"].includes(e.type) ||
    e.size > 4194304
    ? Promise.reject(Error("Choose a PNG, JPEG or WebP image under 4 MB."))
    : new Promise((t, n) => {
        const r = new FileReader();
        r.onload = () => t(r.result);
        r.onerror = () => n(Error("The image could not be read."));
        r.readAsDataURL(e);
      });
}
