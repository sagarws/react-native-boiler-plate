/**
 * Minimal text-only PDF writer (Helvetica, A4 landscape or portrait). Stands in for `jspdf`, which this UI does not
 * ship: TrackVid uses jsPDF for the bulk-claim results export and the six-side image PDF.
 */

export interface PdfLine {
  text: string;
  size?: number;
  bold?: boolean;
  /** Grey text. */
  muted?: boolean;
}

const escapePdf = (s: string): string =>
  s
    .replace(/[^\x20-\x7e]/g, "?")
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");

/** Lays the lines out top to bottom, starting a new page when one fills. */
export function buildTextPdf(lines: PdfLine[], landscape = true): Blob {
  const width = landscape ? 842 : 595;
  const height = landscape ? 595 : 842;
  const margin = 36;
  const pages: string[] = [];
  let ops: string[] = [];
  let y = height - margin;
  const flush = () => {
    pages.push(ops.join("\n"));
    ops = [];
    y = height - margin;
  };
  for (const line of lines) {
    const size = line.size ?? 9;
    const lead = size + 5;
    if (y - lead < margin) flush();
    y -= lead;
    const font = line.bold ? "F2" : "F1";
    const grey = line.muted ? "0.45 g" : "0 g";
    ops.push(`BT ${grey} /${font} ${size} Tf ${margin} ${y} Td (${escapePdf(line.text)}) Tj ET`);
  }
  if (ops.length || !pages.length) flush();

  const objects: string[] = [];
  objects.push("<< /Type /Catalog /Pages 2 0 R >>");
  const kids = pages.map((_, i) => `${5 + i * 2} 0 R`).join(" ");
  objects.push(`<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`);
  objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>");
  pages.forEach((content, i) => {
    const contentId = 6 + i * 2;
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentId} 0 R >>`);
    objects.push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
  });

  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) out += `${String(off).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new Blob([out], { type: "application/pdf" });
}

/** Pads / truncates a cell so columns line up in the monospace-free text PDF. */
export const cell = (value: string, width: number): string => (value.length > width ? `${value.slice(0, Math.max(0, width - 1))}~` : value.padEnd(width, " "));
