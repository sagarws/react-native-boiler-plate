import { clone, delay, newId } from "@/mocks/delay";
import { DEFAULT_TEMPLATE_VARIABLES, PROVIDER_TEMPLATE_BODIES, TEMPLATE_SAMPLE_CONTEXT, sampleTemplates } from "@/mocks/settings";
import type { MessageResponse } from "@/types/common";
import type {
  DefaultTemplateResponse,
  ListTemplatesParams,
  ListTemplatesResponse,
  PreviewTemplateResponse,
  SaveTemplatePayload,
  TemplateDefaults,
  TemplateProvider,
  TemplateRecord,
  TemplateResponse,
} from "@/types/settings";

/**
 * Mock of TrackVid-FE `api/template-automation-service.ts` (`/templates`). Behaviour follows
 * TrackVid-BE `services/template.service.ts`: a company with no template for a provider gets the
 * built-in default on first list, saves upsert by `_id` (or provider + name), and a default template
 * is unique per provider.
 */

const DEFAULT_PROVIDER: TemplateProvider = "ajio";
const PROVIDERS: readonly TemplateProvider[] = ["ajio", "amazon", "flipkart", "myntra", "nykaa", "limeroad", "meesho", "snapdeal", "tata cliq", "other"];

let templates: TemplateRecord[] = clone(sampleTemplates);

function normalizeProvider(provider?: string): TemplateProvider {
  const value = (provider ?? "").toLowerCase();
  return (PROVIDERS as readonly string[]).includes(value) ? (value as TemplateProvider) : DEFAULT_PROVIDER;
}

/** TrackVid-BE `buildProviderTemplate`. */
function buildDefaults(provider: TemplateProvider): TemplateDefaults {
  return {
    name: `${provider.toUpperCase()} Auto Reply`,
    subject: "Re: {{original_subject}}",
    body: PROVIDER_TEMPLATE_BODIES[provider],
    variables: [...DEFAULT_TEMPLATE_VARIABLES],
  };
}

/** TrackVid-BE `renderTemplateString`: `{{name}}` → sample value; unknown names stay as written. */
function render(text: string): string {
  return text.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (match, key: string) => TEMPLATE_SAMPLE_CONTEXT[key] ?? match);
}

function htmlToText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const listTemplates = async (params: ListTemplatesParams): Promise<ListTemplatesResponse> => {
  await delay();
  const provider = params.provider ? normalizeProvider(params.provider) : undefined;
  let rows = provider ? templates.filter((t) => t.provider === provider) : templates;
  if (rows.length === 0) {
    const draft = buildDefaults(provider ?? DEFAULT_PROVIDER);
    const created: TemplateRecord = {
      _id: newId(),
      name: draft.name,
      subject: draft.subject,
      body: draft.body,
      provider: provider ?? DEFAULT_PROVIDER,
      status: "active",
      variables: draft.variables,
      updatedAt: new Date().toISOString(),
      isDefault: false,
    };
    templates = [created, ...templates];
    rows = [created];
  }
  return { templates: clone(rows.map((t) => ({ ...t, variables: t.variables?.length ? t.variables : [...DEFAULT_TEMPLATE_VARIABLES] }))) };
};

const saveTemplate = async (payload: SaveTemplatePayload): Promise<TemplateResponse> => {
  await delay(500);
  if (!payload.name?.trim()) throw new Error("Template name is required");
  const provider = normalizeProvider(payload.provider);
  const existing = payload._id
    ? templates.find((t) => t._id === payload._id)
    : templates.find((t) => t.provider === provider && t.name === payload.name);
  if (payload._id && !existing) throw new Error("Template not found or access denied");

  const saved: TemplateRecord = {
    _id: existing?._id ?? newId(),
    name: payload.name.trim(),
    subject: payload.subject ?? existing?.subject ?? "",
    body: payload.body,
    provider,
    status: payload.status ?? "active",
    variables: payload.variables?.length ? [...payload.variables] : [...DEFAULT_TEMPLATE_VARIABLES],
    updatedAt: new Date().toISOString(),
    isDefault: payload.isDefault ?? false,
  };
  templates = existing ? templates.map((t) => (t._id === saved._id ? saved : t)) : [saved, ...templates];
  if (saved.isDefault) {
    templates = templates.map((t) => (t.provider === provider && t._id !== saved._id ? { ...t, isDefault: false } : t));
  }
  return { template: clone(saved) };
};

const deleteTemplate = async (templateId: string): Promise<MessageResponse> => {
  await delay(400);
  if (!templates.some((t) => t._id === templateId)) throw new Error("Template not found");
  templates = templates.filter((t) => t._id !== templateId);
  return { message: "Template deleted" };
};

const setDefaultTemplate = async (templateId: string): Promise<TemplateResponse> => {
  await delay(400);
  const target = templates.find((t) => t._id === templateId);
  if (!target) throw new Error("Template not found");
  templates = templates.map((t) => (t.provider === target.provider ? { ...t, isDefault: t._id === templateId } : t));
  return { template: clone({ ...target, isDefault: true }) };
};

const previewTemplate = async (templateId: string): Promise<PreviewTemplateResponse> => {
  await delay(400);
  const template = templates.find((t) => t._id === templateId);
  if (!template) throw new Error("Template not found");
  const resolvedBody = render(template.body ?? "");
  const resolvedBodyHtml = /<[^>]+>/.test(resolvedBody) ? resolvedBody : resolvedBody.replace(/\n/g, "<br />");
  return {
    preview: {
      templateId: template._id,
      provider: template.provider,
      subject: template.subject,
      body: template.body,
      resolvedSubject: render(template.subject || "Re: {{original_subject}}"),
      resolvedBodyText: htmlToText(resolvedBodyHtml),
      resolvedBodyHtml,
      variables: template.variables?.length ? [...template.variables] : [...DEFAULT_TEMPLATE_VARIABLES],
    },
  };
};

const getDefaultTemplate = async (provider: string): Promise<DefaultTemplateResponse> => {
  await delay();
  const key = normalizeProvider(provider);
  const active = templates.find((t) => t.provider === key && t.status === "active" && t.isDefault);
  return { defaults: buildDefaults(key), template: active ? clone(active) : undefined };
};

export const TemplateAutomationService = {
  listTemplates,
  saveTemplate,
  deleteTemplate,
  setDefaultTemplate,
  previewTemplate,
  getDefaultTemplate,
};
