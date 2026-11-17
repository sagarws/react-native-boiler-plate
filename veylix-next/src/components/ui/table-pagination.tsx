// @ts-nocheck

export function TablePagination({
  total,
  page,
  pages,
  size,
  onSizeChange,
  onPrevious,
  onNext,
}) {
  const s = total ? (page - 1) * size + 1 : 0;
  const c = Math.min(page * size, total);
  return (
    <footer className="c-pagination">
      <span>
        {s}–{c}
        {" of "}
        {total}
        {" records"}
      </span>
      <label>
        {"Per page "}
        <select
          data-c-page-size
          value={size}
          onChange={(e) => onSizeChange(Number(e.currentTarget.value))}
        >
          <option value={8}>8</option>
          <option value={16}>16</option>
          <option value={32}>32</option>
        </select>
      </label>
      <div>
        <button
          type="button"
          className="secondary-button"
          data-c-action="previous"
          disabled={page === 1}
          onClick={onPrevious}
        >
          Previous
        </button>
        <span>
          {page}
          {" / "}
          {pages}
        </span>
        <button
          type="button"
          className="secondary-button"
          data-c-action="next"
          disabled={page === pages}
          onClick={onNext}
        >
          Next
        </button>
      </div>
    </footer>
  );
}
