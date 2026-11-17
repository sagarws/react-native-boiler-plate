// @ts-nocheck
import Link from "next/link";
import { Icon } from "@/components/icons/icon";
import { buildHref } from "@/lib/navigation";

export function CommercePageHeading({
  title,
  onExport,
  onCreate,
  createLabel = "Add record",
  actions,
  afterExportActions,
}) {
  return (
    <header className="commerce-heading">
      <div>
        <div className="commerce-breadcrumb">
          <Link href={buildHref("/overview")}>Workspace</Link>
          <Icon name="caret-right" />
          <span>{title}</span>
        </div>
        <h1>
          {title}
          <span>.</span>
        </h1>
      </div>
      <div className="commerce-heading-actions">
        {actions}
        {onExport ? (
          <button
            type="button"
            className="secondary-button"
            data-c-action="export"
            onClick={onExport}
          >
            <Icon name="download" />
            {" Export"}
          </button>
        ) : null}
        {afterExportActions}
        {onCreate ? (
          <button
            type="button"
            className="primary-button"
            data-c-action="create"
            onClick={onCreate}
          >
            <Icon name="plus" /> {createLabel}
          </button>
        ) : null}
      </div>
    </header>
  );
}
