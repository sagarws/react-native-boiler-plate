// @ts-nocheck
import { Icon } from "@/components/icons/icon";
import {
  aiLanguageOptions,
  aiResponseModeOptions,
} from "@/features/ai/constants";

function AiVoiceTools({ audioRef, imageRef, transcribing, onTranscribe }) {
  return (
    <div className="c-voice-tools">
      <label className="c-field">
        <span>Customer voice note</span>
        <input ref={audioRef} type="file" name="audio" accept="audio/*" />
      </label>
      <button
        type="button"
        className="secondary-button"
        data-c-action="transcribe"
        disabled={transcribing}
        onClick={onTranscribe}
      >
        Transcribe audio
      </button>
      <label className="c-field">
        <span>Product photo (PNG, JPEG, WebP)</span>
        <input
          ref={imageRef}
          type="file"
          name="image"
          accept="image/png,image/jpeg,image/webp"
        />
      </label>
      <p>
        Audio transcription and image recognition use the connected provider.
        You can also type a transcript or search by product name/SKU manually.
      </p>
    </div>
  );
}

function getAiRecordLabel(e) {
  return String(e.name || e.number || e.code || e.id);
}

export function AiComposerPanel({
  voice,
  values,
  tasks,
  products,
  customers,
  prompts,
  error,
  progress,
  busy,
  transcribing,
  audioRef,
  imageRef,
  onValueChange,
  onTemplateChange,
  onSubmit,
  onTranscribe,
}) {
  return (
    <section className="glass-card">
      <div className="c-ai-intro">
        <span className="icon-tile">
          <Icon name="sparkle" />
        </span>
        <div>
          <h2>
            {voice
              ? "Listen. Understand. Respond."
              : "What could use a little help?"}
          </h2>
          <p>Start with a task. Keep the final say.</p>
        </div>
      </div>
      <form className="c-form" data-c-form="ai" onSubmit={onSubmit}>
        <div className="c-form-grid">
          <label className="c-field" htmlFor="field-task">
            <span>Task</span>
            <select
              id="field-task"
              name="task"
              value={values.task}
              onChange={(e) => onValueChange("task", e.target.value)}
            >
              <option value="">Choose task</option>
              {tasks.map((e) => (
                <option key={e} value={e}>
                  {e}
                </option>
              ))}
            </select>
          </label>
          <label className="c-field" htmlFor="field-mode">
            <span>Generation mode</span>
            <select
              id="field-mode"
              name="mode"
              value={values.mode}
              onChange={(e) => onValueChange("mode", e.target.value)}
            >
              <option value="">Choose generation mode</option>
              {aiResponseModeOptions.map((e) => (
                <option key={e} value={e}>
                  {e}
                </option>
              ))}
            </select>
          </label>
          <label className="c-field" htmlFor="field-productId">
            <span>Product context</span>
            <select
              id="field-productId"
              name="productId"
              value={values.productId}
              onChange={(e) => onValueChange("productId", e.target.value)}
            >
              <option value="">Choose product context</option>
              {products.map((e) => (
                <option key={e.id} value={e.id}>
                  {getAiRecordLabel(e)}
                </option>
              ))}
            </select>
          </label>
          <label className="c-field" htmlFor="field-customerId">
            <span>Customer context (optional)</span>
            <select
              id="field-customerId"
              name="customerId"
              value={values.customerId}
              onChange={(e) => onValueChange("customerId", e.target.value)}
            >
              <option value="">Choose customer context (optional)</option>
              {customers.map((e) => (
                <option key={e.id} value={e.id}>
                  {getAiRecordLabel(e)}
                </option>
              ))}
            </select>
          </label>
          <label className="c-field" htmlFor="field-language">
            <span>Output language</span>
            <select
              id="field-language"
              name="language"
              value={values.language}
              onChange={(e) => onValueChange("language", e.target.value)}
            >
              <option value="">Choose output language</option>
              {aiLanguageOptions.map((e) => (
                <option key={e} value={e}>
                  {e}
                </option>
              ))}
            </select>
          </label>
          <label className="c-field" htmlFor="field-template">
            <span>Prompt template</span>
            <select
              id="field-template"
              name="template"
              value={values.template}
              onChange={(e) => onTemplateChange(e.target.value)}
            >
              <option value="">Choose prompt template</option>
              <option value="Custom instructions">Custom instructions</option>
              {prompts.map((e) => (
                <option key={e.id} value={String(e.name || "")}>
                  {String(e.name || "")}
                </option>
              ))}
            </select>
          </label>
        </div>
        {voice ? (
          <AiVoiceTools
            audioRef={audioRef}
            imageRef={imageRef}
            transcribing={transcribing}
            onTranscribe={onTranscribe}
          />
        ) : null}
        <label className="c-field span-full" htmlFor="field-prompt">
          <span>
            {voice ? "Transcript or instructions" : "Your instructions"}{" "}
            <small>*</small>
          </span>
          <textarea
            id="field-prompt"
            name="prompt"
            rows={4}
            maxLength={2e4}
            required
            value={values.prompt}
            onChange={(e) => onValueChange("prompt", e.target.value)}
          />
        </label>
        <p className="c-form-error" role="alert">
          {error}
        </p>
        <div className="c-form-footer">
          <span id="ai-progress" data-no-translate aria-live="polite">
            {progress}
          </span>
          <button type="submit" className="primary-button" disabled={busy}>
            <Icon name="sparkle" />
            {" Create draft"}
          </button>
        </div>
      </form>
    </section>
  );
}
