// @ts-nocheck
import Link from "next/link";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@/components/icons/icon";
import { AppDialog } from "@/components/ui/app-dialog";
import { CommercePageHeading } from "@/components/ui/commerce-page-heading";
import { aiTaskTypes } from "@/config/ai-task-types";
import { AiComposerPanel } from "@/features/ai/components/ai-composer-panel";
import { AiResultPanel } from "@/features/ai/components/ai-result-panel";
import { aiShortcutLinks } from "@/features/ai/constants";
import { aiWorkflowDefinitions } from "@/features/ai/data";
import {
  generateAiText,
  readImageAsDataUrl,
  transcribeAudioFile,
} from "@/lib/ai-client";
import { showToast } from "@/lib/events";
import { buildHref } from "@/lib/navigation";
import { findRecord, listRecords } from "@/lib/store/core";
import { readPreference, savePreference } from "@/lib/store/preferences";
import { saveRecord } from "@/lib/store/records";

function AiShortcutLinks() {
  return (
    <div className="c-ai-shortcuts">
      {aiShortcutLinks.map(([e, t]) => (
        <Link
          key={e}
          className="secondary-button"
          href={buildHref(`/commerce/${e}`)}
        >
          {t}
          <Icon name="arrow-right" />
        </Link>
      ))}
    </div>
  );
}

function SavedAiDraftsDialog({ drafts, onClose }) {
  return (
    <AppDialog title="Saved AI drafts" onClose={onClose} wide>
      {drafts.length ? (
        drafts.map((e) => (
          <article key={e.id} className="c-saved-draft">
            <small>{new Date(e.date).toLocaleString()}</small>
            <p>{e.text}</p>
          </article>
        ))
      ) : (
        <p>
          No saved drafts yet. Write or generate a draft, then select Save
          draft.
        </p>
      )}
    </AppDialog>
  );
}

const aiStudioWorkflows = aiWorkflowDefinitions;

const aiStudioTasks = aiTaskTypes;

function buildInitialAiStudioValues(e, t) {
  const n = aiStudioWorkflows.find((t) => t.id === e.get("workflow"));
  const r = e.get("task");
  const i = r && aiStudioTasks.includes(r) ? r : n?.task || "Product copy";
  const a = findRecord("products", e.get("productId"));
  return {
    task: t ? "Product identification" : i,
    mode: "Template responses",
    productId: String(
      a?.id ||
        (n && !["Product copy", "SEO", "Translation"].includes(n.task)
          ? ""
          : "products-1"),
    ),
    customerId: "",
    language: "English",
    template: "Custom instructions",
    prompt: t
      ? "Identify the product using the attached image and supplied catalog. If uncertain, ask for a clearer photo or SKU."
      : n?.prompt ||
        (i === "SEO"
          ? "Write a concise search description using only the supplied product facts."
          : "Write a warm product description with three useful benefits. Use only the supplied facts."),
  };
}

export function AiStudioPage({ params, voice = false }) {
  const n = useMemo(
    () => aiStudioWorkflows.find((t) => t.id === params.get("workflow")),
    [params],
  );
  const r = useMemo(
    () => findRecord("products", params.get("productId")),
    [params],
  );
  const [i, a] = useState(() => buildInitialAiStudioValues(params, voice));
  const [o, s] = useState("");
  const [c, u] = useState("Ready when you are");
  const [d, f] = useState("");
  const [p, m] = useState("");
  const [h, g] = useState(false);
  const [_, v] = useState(false);
  const [y, b] = useState(false);
  const [x, S] = useState(0);
  const C = useRef(null);
  const w = useRef(null);
  const T = useMemo(() => listRecords("products"), []);
  const E = useMemo(() => listRecords("customers"), []);
  const D = useMemo(() => listRecords("prompts"), [x]);
  const O = useMemo(() => readPreference("ai-saved-drafts", []), [x]);
  useEffect(() => () => window.speechSynthesis?.cancel(), []);
  const k = (e, t) =>
    a((n) => ({
      ...n,
      [e]: t,
    }));
  const A = (e) => {
    a((t) => {
      const n = D.find((t) => t.name === e);
      return {
        ...t,
        template: e,
        prompt: n ? String(n.prompt || "") : t.prompt,
      };
    });
  };
  const j = async (e) => {
    e.preventDefault();
    m("");
    g(true);
    f("Preparing your draft…");
    let n = false;
    try {
      const e = voice ? w.current?.files?.[0] : void 0;
      const r = e ? await readImageAsDataUrl(e) : void 0;
      const a = await generateAiText({
        ...i,
        mode: i.mode === "Connected AI provider" ? "connected" : "demo",
        image: r,
      });
      s(String(a.text || ""));
      u(String(a.mode || ""));
      f(
        a.mode === "Template responses"
          ? "Template response ready"
          : `${Number(a.inputTokens || 0)} input / ${Number(a.outputTokens || 0)} output tokens`,
      );
      S((e) => e + 1);
      n = true;
    } catch (e) {
      m(e instanceof Error ? e.message : "The AI draft could not be prepared.");
    } finally {
      g(false);
      if (!n) {
        f("Ready to try again.");
      }
    }
  };
  const M = async () => {
    m("");
    v(true);
    try {
      const e = await transcribeAudioFile(C.current?.files?.[0]);
      k("prompt", String(e || ""));
      showToast("Voice note transcribed. Review it before generating a reply.");
    } catch (e) {
      m(
        e instanceof Error
          ? e.message
          : "The voice note could not be transcribed.",
      );
    } finally {
      v(false);
    }
  };
  const N = () => {
    m("");
    try {
      if (!o.trim()) throw Error("Write or generate a draft first.");
      savePreference("ai-saved-drafts", [
        {
          id: crypto.randomUUID(),
          text: o,
          date: new Date().toISOString(),
        },
        ...readPreference("ai-saved-drafts", []),
      ]);
      S((e) => e + 1);
      showToast("AI draft saved locally.");
    } catch (e) {
      m(e instanceof Error ? e.message : "The AI draft could not be saved.");
    }
  };
  const ee = () => {
    m("");
    try {
      if (!o.trim()) throw Error("Write or generate a reply first.");
      if (!("speechSynthesis" in window))
        throw Error("Read aloud is not supported in this browser.");
      speechSynthesis.cancel();
      speechSynthesis.speak(new SpeechSynthesisUtterance(o));
    } catch (e) {
      m(e instanceof Error ? e.message : "Read aloud could not start.");
    }
  };
  const te = () => {
    m("");
    try {
      const e = findRecord("products", i.productId);
      if (!e || !o.trim())
        throw Error("Select a product and prepare a draft first.");
      if (!["Product copy", "SEO"].includes(i.task))
        throw Error(
          "Only Product copy and SEO drafts can be applied to products.",
        );
      saveRecord(
        "products",
        {
          ...e,
          [i.task === "SEO" ? "seoDescription" : "description"]: o,
        },
        e.id,
      );
      showToast(`Draft applied to ${String(e.name)}.`);
    } catch (e) {
      m(
        e instanceof Error
          ? e.message
          : "The draft could not be applied to this product.",
      );
    }
  };
  const ne = (
    <Fragment>
      {r ? (
        <Link
          className="secondary-button"
          href={buildHref(
            `/commerce/products/edit?id=${encodeURIComponent(r.id)}`,
          )}
        >
          Back to product
        </Link>
      ) : null}
      <Link
        className="secondary-button"
        href={buildHref("/commerce/ai-workflows")}
      >
        Workflows
        <Icon name="arrow-right" />
      </Link>
      <Link
        className="secondary-button"
        href={buildHref("/commerce/knowledge")}
      >
        Knowledge
        <Icon name="arrow-right" />
      </Link>
      <Link
        className="secondary-button"
        href={buildHref("/commerce/integrations")}
      >
        API connection
        <Icon name="arrow-right" />
      </Link>
    </Fragment>
  );
  return (
    <Fragment>
      <CommercePageHeading
        title={voice ? "Voice & product assist" : "Commerce AI studio"}
        actions={ne}
      />
      {n ? (
        <div className="ai-selected-workflow">
          <strong>{n.title}</strong>
          <span>{n.scope}</span>
        </div>
      ) : null}
      <div className="c-ai-layout">
        <AiComposerPanel
          voice={voice}
          values={i}
          tasks={aiStudioTasks}
          products={T}
          customers={E}
          prompts={D}
          error={p}
          progress={d}
          busy={h}
          transcribing={_}
          audioRef={C}
          imageRef={w}
          onValueChange={k}
          onTemplateChange={A}
          onSubmit={j}
          onTranscribe={M}
        />
        <AiResultPanel
          output={o}
          resultMode={c}
          voice={voice}
          onOutputChange={s}
          onSaveDraft={N}
          onViewDrafts={() => b(true)}
          onSpeak={ee}
          onStopSpeech={() => window.speechSynthesis?.cancel()}
          onApplyToProduct={te}
        />
      </div>
      <AiShortcutLinks />
      {y ? <SavedAiDraftsDialog drafts={O} onClose={() => b(false)} /> : null}
    </Fragment>
  );
}
