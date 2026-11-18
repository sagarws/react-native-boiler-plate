/* Pure UI rules of the Flipkart VMS mirror, shared so they are unit-tested under tests/vms/partnerVms. */
/**
 * Whether a MUI dialog, menu or popover is open over the app.
 *
 * Flipkart's page is a native view, not part of the React tree, so it paints ON
 * TOP of everything the renderer draws — z-index cannot reach it. A dialog
 * opened while the tab is showing would be hidden behind their page (TrackVid-
 * App's FlipkartVmsPage watched the DOM for exactly this). CMS: modals that are
 * mounted but closed (`.MuiModal-hidden`) do not count.
 */
export const BLOCKING_OVERLAY_SELECTOR = '.MuiDialog-root, .MuiModal-root, .MuiPopover-root, [role="dialog"]'

interface OverlayElement {
  closest: (selector: string) => unknown
  getClientRects?: () => { length: number }
}

interface OverlayRoot {
  querySelectorAll: (selector: string) => ArrayLike<OverlayElement>
}

export const isBlockingOverlayOpen = (root: OverlayRoot): boolean => {
  const found = Array.from(root.querySelectorAll(BLOCKING_OVERLAY_SELECTOR))
  return found.some((el) => {
    if (el.closest('.MuiModal-hidden')) return false
    // Rendered with no box at all (display: none): not on screen.
    if (el.getClientRects && el.getClientRects().length === 0) return false
    return true
  })
}
