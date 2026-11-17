interface TablePaginationProps {
  total: number;
  page: number;
  size: number;
  sizes?: readonly number[];
  onPageChange: (page: number) => void;
  onSizeChange: (size: number) => void;
}

/** Template `c-pagination` footer (1-based page). */
export function TablePagination({ total, page, size, sizes = [10, 25, 50, 100], onPageChange, onSizeChange }: TablePaginationProps) {
  const pages = Math.max(1, Math.ceil(total / size));
  const first = total ? (page - 1) * size + 1 : 0;
  const last = Math.min(page * size, total);
  return (
    <footer className="c-pagination">
      <span>
        {first}–{last} of {total} records
      </span>
      <label>
        {"Per page "}
        <select value={size} onChange={(e) => onSizeChange(Number(e.currentTarget.value))}>
          {sizes.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </label>
      <div>
        <button type="button" className="secondary-button" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>
          Previous
        </button>
        <span>
          {page} / {pages}
        </span>
        <button type="button" className="secondary-button" disabled={page >= pages} onClick={() => onPageChange(page + 1)}>
          Next
        </button>
      </div>
    </footer>
  );
}
