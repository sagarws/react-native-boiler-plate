// @ts-nocheck

export function BulkSelectionBar({ count, archived, onBulkArchive, onClear }) {
  return (
    <div className="c-selection" hidden={!count}>
      <strong>
        {count}
        {" selected"}
      </strong>
      <button
        type="button"
        className="secondary-button"
        data-c-action="bulk-archive"
        onClick={onBulkArchive}
      >
        {archived ? "Restore selected" : "Archive selected"}
      </button>
      <button
        type="button"
        className="secondary-button"
        data-c-action="clear-selection"
        onClick={onClear}
      >
        Clear selection
      </button>
    </div>
  );
}
