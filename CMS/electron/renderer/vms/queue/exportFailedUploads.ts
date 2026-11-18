import type { QueueEntry } from '@shared/vms/queue'

/**
 * The failed-uploads list as a PDF the operator can hand to support. Ported
 * from Argos Watch's exportFailedOrders: the same A4 table (AWB, type,
 * attempts, error) under a header with the feed, the operator and the time.
 *
 * jspdf is imported when the operator presses Export, so the dialog does not
 * carry it. `doc.save` hands the file to the window's download, as the CMS's
 * other PDF exports do.
 */
interface ExportContext {
  feedName?: string | undefined
  operatorName?: string | undefined
}

const PAGE_MARGIN = 12
const HEADER_HEIGHT = 22
const ROW_HEIGHT = 8
const FONT_HEADER = 10
const FONT_BODY = 9

export const exportFailedUploadsPdf = async (rows: QueueEntry[], context: ExportContext = {}): Promise<void> => {
  const { jsPDF } = await import('jspdf')
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  const pageWidth = doc.internal.pageSize.getWidth()
  const pageHeight = doc.internal.pageSize.getHeight()
  const now = new Date()

  doc.setFontSize(14)
  doc.setFont('helvetica', 'bold')
  doc.text('TrackVid VMS — Failed uploads', PAGE_MARGIN, PAGE_MARGIN + 4)

  doc.setFontSize(9)
  doc.setFont('helvetica', 'normal')
  const meta = [
    context.feedName ? `Feed: ${context.feedName}` : null,
    context.operatorName ? `Operator: ${context.operatorName}` : null,
    `Generated: ${now.toISOString()}`,
    `Rows: ${rows.length}`
  ]
    .filter(Boolean)
    .join('   ')
  doc.text(meta, PAGE_MARGIN, PAGE_MARGIN + 10)

  const cols = [
    { label: 'AWB', x: PAGE_MARGIN, w: 55 },
    { label: 'Type', x: PAGE_MARGIN + 58, w: 18 },
    { label: 'Att.', x: PAGE_MARGIN + 79, w: 10 },
    { label: 'Error', x: PAGE_MARGIN + 92, w: pageWidth - PAGE_MARGIN - 92 - PAGE_MARGIN }
  ] as const

  let y = PAGE_MARGIN + HEADER_HEIGHT
  doc.setFontSize(FONT_HEADER)
  doc.setFont('helvetica', 'bold')
  for (const col of cols) doc.text(col.label, col.x, y)
  doc.setLineWidth(0.15)
  doc.line(PAGE_MARGIN, y + 1.5, pageWidth - PAGE_MARGIN, y + 1.5)
  y += ROW_HEIGHT

  doc.setFontSize(FONT_BODY)
  doc.setFont('helvetica', 'normal')

  for (const row of rows) {
    if (y > pageHeight - PAGE_MARGIN) {
      doc.addPage()
      y = PAGE_MARGIN + 6
    }
    doc.text(row.trackingId, cols[0].x, y, { maxWidth: cols[0].w })
    doc.text(row.orderType || '—', cols[1].x, y, { maxWidth: cols[1].w })
    doc.text(String(row.retryCount), cols[2].x + cols[2].w, y, { align: 'right' })
    // An error can wrap; give jspdf the column width so it does not overflow.
    const errorLines = doc.splitTextToSize(row.errorMessage || '—', cols[3].w) as string[]
    errorLines.forEach((line, i) => doc.text(line, cols[3].x, y + i * (ROW_HEIGHT - 3)))
    y += Math.max(ROW_HEIGHT, errorLines.length * (ROW_HEIGHT - 3) + 2)
  }

  const stamp = now.toISOString().slice(0, 19).replace(/[T:]/g, '-')
  doc.save(`trackvid-failed-uploads-${stamp}.pdf`)
}
