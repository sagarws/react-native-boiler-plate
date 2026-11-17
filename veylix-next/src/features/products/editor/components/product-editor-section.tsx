// @ts-nocheck
import { Icon } from "@/components/icons/icon";

export function ProductEditorSection({
  id,
  icon,
  title,
  description,
  children,
  className = "",
  hidden = false,
  panel = false,
}) {
  return (
    <section
      id={`product-${id}`}
      className={`glass-card product-section${panel ? " product-editor-panel" : ""}${className ? ` ${className}` : ""}`}
      hidden={hidden}
      data-product-panel={panel ? id : void 0}
      role={panel ? "tabpanel" : void 0}
      aria-labelledby={panel ? `product-tab-${id}` : void 0}
    >
      <header className="product-section-heading">
        <span className="product-section-icon">
          <Icon name={icon} />
        </span>
        <div>
          <h2>{title}</h2>
          <p>{description}</p>
        </div>
      </header>
      {children}
    </section>
  );
}
