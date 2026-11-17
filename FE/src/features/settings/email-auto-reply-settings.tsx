"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Icon } from "@/components/icons/icon";
import { RichTextEditor } from "@/components/editor/rich-text-editor";
import { AppDialog } from "@/components/ui/app-dialog";
import { SelectField, TextField } from "@/components/ui/form-field";
import { LoadingState } from "@/components/ui/states";
import { MailboxManager } from "@/features/emails/mailbox-manager";
import { errorMessage, toast } from "@/lib/events";
import { canAccess } from "@/lib/permissions";
import { sanitizeHtml } from "@/lib/sanitize";
import { TemplateAutomationService } from "@/services/template-automation-service";
import { useSelector } from "@/store";
import type { TemplateFormState, TemplatePreview, TemplateStatus } from "@/types/settings";
import { SettingsSection, useCanEditSettings } from "./settings-shared";

const PROVIDER = "ajio";

const DEFAULT_TEMPLATE_PLACEHOLDERS: string[] = [
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

const EMPTY_FORM: TemplateFormState = { _id: undefined, name: "", subject: "", body: "", status: "active" };

const STATUS_OPTIONS: { value: TemplateStatus; label: string }[] = [
  { value: "active", label: "Active" },
  { value: "inactive", label: "Inactive" },
];

interface LoadedTemplate {
  form: TemplateFormState;
  variables?: string[];
}

/** Saved template first (the default one, else the newest); otherwise the provider's default structure. */
async function loadUserTemplate(): Promise<LoadedTemplate> {
  try {
    const { templates } = await TemplateAutomationService.listTemplates({ provider: PROVIDER });
    const userTemplate = templates.find((t) => t.isDefault) ?? templates[0];
    if (userTemplate) {
      const { _id, name, subject, body, status } = userTemplate;
      return { form: { _id, name, subject, body, status }, variables: userTemplate.variables };
    }
  } catch (err) {
    // Fall through to the default structure, as TrackVid does.
    console.warn("Failed to load user templates, falling back to default", err);
  }
  const { defaults, template } = await TemplateAutomationService.getDefaultTemplate(PROVIDER);
  if (template) {
    const { _id, name, subject, body, status } = template;
    return { form: { _id, name, subject, body, status }, variables: template.variables };
  }
  if (defaults) return { form: { ...EMPTY_FORM, name: defaults.name, subject: defaults.subject, body: defaults.body }, variables: defaults.variables };
  return { form: EMPTY_FORM };
}

/** "Load Default Template": always the default structure, never the saved one (no `_id`, so it saves as new). */
async function loadDefaultStructure(): Promise<LoadedTemplate> {
  const { defaults, template } = await TemplateAutomationService.getDefaultTemplate(PROVIDER);
  if (defaults) return { form: { ...EMPTY_FORM, name: defaults.name, subject: defaults.subject, body: defaults.body }, variables: defaults.variables };
  if (template) return { form: { ...EMPTY_FORM, name: template.name, subject: template.subject, body: template.body }, variables: template.variables };
  return { form: EMPTY_FORM };
}

function VariableChips({ variables }: { variables: readonly string[] }) {
  if (variables.length === 0) return <span className="tv-muted tv-small">No variables available</span>;
  return (
    <div className="tv-settings-vars">
      {variables.map((v) => (
        <code key={v}>{`{{${v}}}`}</code>
      ))}
    </div>
  );
}

/** "Template Management" card of TrackVid `IntegrationsSettings.tsx` (the AJIO auto-reply template). */
function TemplateManagement() {
  const canEdit = useCanEditSettings();
  const [form, setForm] = useState<TemplateFormState>(EMPTY_FORM);
  const [placeholders, setPlaceholders] = useState<string[]>(DEFAULT_TEMPLATE_PLACEHOLDERS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [preview, setPreview] = useState<TemplatePreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [reloadTick, setReloadTick] = useState(0);

  useEffect(() => {
    let active = true;
    loadUserTemplate()
      .then((loaded) => {
        if (!active) return;
        setForm(loaded.form);
        if (loaded.variables?.length) setPlaceholders(loaded.variables);
      })
      .catch((err: unknown) => {
        if (active) toast.error(errorMessage(err, "Unable to load template"));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [reloadTick]);

  const handleLoadDefault = async () => {
    setForm(EMPTY_FORM);
    setLoading(true);
    try {
      const loaded = await loadDefaultStructure();
      setForm(loaded.form);
      if (loaded.variables?.length) setPlaceholders(loaded.variables);
    } catch (err) {
      toast.error(errorMessage(err, "Unable to load default template"));
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!form.name.trim()) {
      toast.error("Template name is required");
      return;
    }
    setSaving(true);
    try {
      // One template per provider, so it is always saved as the default.
      await TemplateAutomationService.saveTemplate({ ...form, provider: PROVIDER, variables: placeholders, isDefault: true });
      toast.success(form._id ? "Template updated" : "Template saved");
      setLoading(true);
      setReloadTick((t) => t + 1);
    } catch (err) {
      toast.error(errorMessage(err, "Failed to save template"));
    } finally {
      setSaving(false);
    }
  };

  const handlePreview = async () => {
    if (!form._id) {
      toast.error("Please save the template first to preview");
      return;
    }
    setPreviewLoading(true);
    try {
      const res = await TemplateAutomationService.previewTemplate(form._id);
      setPreview(res.preview);
      if (res.preview.variables?.length) setPlaceholders(res.preview.variables);
    } catch (err) {
      toast.error(errorMessage(err, "Failed to load preview"));
    } finally {
      setPreviewLoading(false);
    }
  };

  return (
    <SettingsSection
      icon="file-text"
      title="Template Management"
      description="Create and manage the auto-reply template, with placeholders for dynamic content."
      action={
        canEdit ? (
          <button type="button" className="secondary-button compact-button" onClick={() => void handleLoadDefault()} disabled={loading}>
            <Icon name="refresh" />
            {loading ? "Loading…" : "Load Default Template"}
          </button>
        ) : null
      }
    >
      {loading ? (
        <LoadingState label="Loading template…" />
      ) : (
        <form className="tv-stack" onSubmit={(e) => void handleSubmit(e)}>
          <div className="c-form-grid">
            <TextField
              label="Template Name"
              required
              value={form.name}
              readOnly={!canEdit}
              onChange={(e) => {
                const name = e.currentTarget.value;
                setForm((prev) => ({ ...prev, name }));
              }}
            />
            <SelectField
              label="Status"
              value={form.status}
              options={STATUS_OPTIONS}
              disabled={!canEdit}
              onChange={(e) => {
                const status = e.currentTarget.value as TemplateStatus;
                setForm((prev) => ({ ...prev, status }));
              }}
            />
          </div>

          <div className="tv-stack tv-settings-body-field">
            <div className="tv-row">
              <span className="tv-settings-label">Body</span>
              <button
                type="button"
                className="icon-button compact-button"
                aria-label="How to use variables"
                aria-expanded={showHelp}
                title="How to use variables"
                onClick={() => setShowHelp((s) => !s)}
              >
                <Icon name="info" />
              </button>
            </div>
            {showHelp ? (
              <div className="tv-settings-help">
                <strong>How to use variables</strong>
                <p>
                  Use double curly braces to insert variables: <code>{"{{variable_name}}"}</code>
                </p>
                <strong>Supported variables</strong>
                <VariableChips variables={placeholders} />
              </div>
            ) : null}
            <RichTextEditor
              label="Template body"
              value={form.body}
              readOnly={!canEdit}
              onChange={(body) => setForm((prev) => (prev.body === body ? prev : { ...prev, body }))}
            />
          </div>

          <div className="tv-row">
            {canEdit ? (
              <button type="submit" className="primary-button" disabled={saving || loading}>
                {saving ? "Saving…" : "Save Template"}
              </button>
            ) : null}
            {form._id ? (
              <button type="button" className="secondary-button" onClick={() => void handlePreview()} disabled={previewLoading}>
                <Icon name="eye" />
                {previewLoading ? "Loading…" : "Preview"}
              </button>
            ) : null}
          </div>
        </form>
      )}

      {preview ? (
        <AppDialog
          title="Template Preview"
          size="wide"
          onClose={() => setPreview(null)}
          footer={
            <button type="button" className="secondary-button" onClick={() => setPreview(null)}>
              Close
            </button>
          }
        >
          <div className="tv-stack">
            <p className="tv-muted tv-small">Preview the resolved auto-reply with sample variables.</p>
            <div>
              <span className="tv-settings-eyebrow">Subject</span>
              <p className="tv-strong">{preview.resolvedSubject || "—"}</p>
            </div>
            <div>
              <span className="tv-settings-eyebrow">Available variables</span>
              <VariableChips variables={preview.variables ?? placeholders} />
            </div>
            <hr className="tv-divider" />
            {/* Template HTML is user-authored: sanitize before rendering. */}
            <div className="tv-html tv-settings-preview" dangerouslySetInnerHTML={{ __html: sanitizeHtml(preview.resolvedBodyHtml || preview.body) }} />
          </div>
        </AppDialog>
      ) : null}
    </SettingsSection>
  );
}

/**
 * TrackVid `components/settings/IntegrationsSettings.tsx` ("AJIO Email Auto Reply" tab): connected
 * mailboxes (shared `MailboxManager`) and the auto-reply template. Without `email::mailbox::view`
 * the whole tab is the "no permission" card.
 */
export function EmailAutoReplySettings() {
  const user = useSelector((s) => s.profile.userProfile);
  const canViewMailboxes = canAccess(user, ["admin"], ["email::mailbox::view"]);

  return (
    <div className="tv-stack">
      <MailboxManager />
      {canViewMailboxes ? <TemplateManagement /> : null}
    </div>
  );
}
