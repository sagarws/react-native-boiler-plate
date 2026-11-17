export type StatusTone = "green" | "amber" | "red" | "blue";

/** Same tone rules as the template, extended with TrackVid claim / order statuses. */
export function getStatusTone(value: string): StatusTone {
  if (/active|paid|published|enabled|delivered|approved|succeeded|success|resolved|received|good|completed|verified|connected|credited|closed|done/i.test(value))
    return "green";
  if (/pending|draft|requested|scheduled|processing|ready|review|progress|queued|running|awaiting|invited|hold|open|un ?attended|partial/i.test(value))
    return "amber";
  if (/failed|reject|cancel|suspend|delay|bad|error|expired|disconnected|dispute|not delivered|disabled|debited|missing/i.test(value)) return "red";
  return "blue";
}

export function StatusPill({ value, tone }: { value: string | null | undefined; tone?: StatusTone }) {
  const label = value || "Not set";
  return <span className={`c-status ${tone ?? getStatusTone(label)}`}>{label}</span>;
}
