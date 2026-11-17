// @ts-nocheck

export function parseCsv(e) {
  const t = String(e || "").replace(/^\uFEFF/, "");
  const n = [];
  let r = [];
  let i = "";
  let a = false;
  for (let e = 0; e <= t.length; e++) {
    const o = t[e] ?? "\n";
    if (a) {
      if (o === '"' && t[e + 1] === '"') {
        i += '"';
        e++;
      } else if (o === '"') {
        a = false;
      } else {
        i += o;
      }
    } else if (o === '"') {
      a = true;
    } else if (o === ",") {
      r.push(i);
      i = "";
    } else if (o === "\n") {
      r.push(i.replace(/\r$/, ""));
      i = "";
      if (r.some((e) => String(e).trim())) {
        n.push(r);
      }
      r = [];
    } else {
      i += o;
    }
  }
  if (a) throw Error("The CSV has an unclosed quoted value.");
  return n;
}

export function normalizeCsvHeader(e) {
  return String(e || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

export function buildCsv(e, t, n = t) {
  const r = (e) =>
    `"${String(e ?? "")
      .replace(/^[=+@\-\t\r]/, "'$&")
      .replaceAll('"', '""')}"`;
  return [n, ...e.map((e) => t.map((t) => e[t]))]
    .map((e) => e.map(r).join(","))
    .join("\r\n");
}

export function downloadFile(e, t, n = "text/csv;charset=utf-8") {
  const r = URL.createObjectURL(
    new Blob([t], {
      type: n,
    }),
  );
  const i = document.createElement("a");
  i.href = r;
  i.download = e;
  i.click();
  setTimeout(() => URL.revokeObjectURL(r), 1e3);
}
