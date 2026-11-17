// @ts-nocheck
import { Icon } from "@/components/icons/icon";

export function ProductAssistantTip({ uploading }) {
  return (
    <section className="glass-card product-section product-editor-tip">
      <span className="product-section-icon">
        <Icon name="sparkle" />
      </span>
      <h2>AI product assistant</h2>
      <p>
        Save your changes, then use this product in AI Studio. Review every
        draft before applying it.
      </p>
      <button
        type="submit"
        name="intent"
        value="ai-copy"
        className="secondary-button"
        disabled={uploading}
      >
        <Icon name="sparkle" />
        {" Save & write copy"}
      </button>
      <button
        type="submit"
        name="intent"
        value="ai-seo"
        className="secondary-button"
        disabled={uploading}
      >
        <Icon name="globe" />
        {" Save & improve SEO"}
      </button>
    </section>
  );
}
