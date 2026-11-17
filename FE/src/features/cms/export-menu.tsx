"use client";

import { useCallback, useRef, useState } from "react";
import { Icon } from "@/components/icons/icon";
import { useDismiss } from "@/components/ui/use-dismiss";

export type ExportScope = "selected" | "page" | "all";

/** TrackVid "Export" menu: Selected / Page Orders / All N Orders. */
export function ExportMenu({ selectedCount, total, busy, onExport }: { selectedCount: number; total: number; busy: boolean; onExport: (scope: ExportScope) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(open, ref, close);
  const choose = (scope: ExportScope) => {
    setOpen(false);
    onExport(scope);
  };
  return (
    <div className="tv-popover-wrap" ref={ref}>
      <button type="button" className="secondary-button" aria-haspopup="menu" aria-expanded={open} disabled={busy} onClick={() => setOpen((o) => !o)}>
        {busy ? <span className="tv-spinner small" aria-hidden="true" /> : <Icon name="upload" />}
        Export
        <Icon name="caret-down" />
      </button>
      {open ? (
        <div className="tv-popover" role="menu" aria-label="Export claims">
          <div className="tv-menu-list">
            <button type="button" role="menuitem" disabled={!selectedCount} onClick={() => choose("selected")}>
              <Icon name="check-circle" /> Selected {selectedCount ? `(${selectedCount})` : ""}
            </button>
            <button type="button" role="menuitem" onClick={() => choose("page")}>
              <Icon name="file-text" /> Page Orders
            </button>
            <button type="button" role="menuitem" onClick={() => choose("all")}>
              <Icon name="database" /> All {total} Orders
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
