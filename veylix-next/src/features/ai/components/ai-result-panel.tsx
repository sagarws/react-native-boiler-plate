// @ts-nocheck

export function AiResultPanel({
  output,
  resultMode,
  voice,
  onOutputChange,
  onSaveDraft,
  onViewDrafts,
  onSpeak,
  onStopSpeech,
  onApplyToProduct,
}) {
  return (
    <section className="glass-card c-ai-result">
      <div className="card-heading">
        <h2>Your working draft</h2>
        <span id="ai-result-mode" className="c-status amber">
          {resultMode}
        </span>
      </div>
      <label className="sr-only" htmlFor="ai-output">
        Editable AI output
      </label>
      <textarea
        data-no-translate
        id="ai-output"
        rows={17}
        placeholder="Your draft will appear here. You can also write your own text."
        value={output}
        onChange={(e) => onOutputChange(e.target.value)}
      />
      <div className="c-toolbar">
        <button
          type="button"
          className="secondary-button"
          data-c-action="save-ai-draft"
          onClick={onSaveDraft}
        >
          Save draft
        </button>
        <button
          type="button"
          className="secondary-button"
          data-c-action="view-ai-drafts"
          onClick={onViewDrafts}
        >
          Saved drafts
        </button>
        <button
          type="button"
          className="secondary-button"
          data-c-action="speak-ai"
          onClick={onSpeak}
        >
          Read aloud
        </button>
        <button
          type="button"
          className="secondary-button"
          data-c-action="stop-speech"
          onClick={onStopSpeech}
        >
          Stop audio
        </button>
        {voice ? null : (
          <button
            type="button"
            className="secondary-button"
            data-c-action="apply-ai"
            onClick={onApplyToProduct}
          >
            Apply to product
          </button>
        )}
      </div>
      <p className="c-section-copy">
        Review facts, tone and product details before using a draft. Applying
        updates only the selected local product.
      </p>
    </section>
  );
}
