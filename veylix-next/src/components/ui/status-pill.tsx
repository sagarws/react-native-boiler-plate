// @ts-nocheck

function getStatusTone(e) {
  return /active|paid|published|enabled|delivered|approved|succeeded|resolved|received/i.test(
    e,
  )
    ? "green"
    : /pending|draft|requested|scheduled|processing|ready/i.test(e)
      ? "amber"
      : /failed|reject|cancel|suspend|delay|hold/i.test(e)
        ? "red"
        : "blue";
}

export function StatusPill({ value = "Not set" }) {
  return (
    <span className={`c-status ${getStatusTone(value)}`}>
      {value || "Not set"}
    </span>
  );
}
