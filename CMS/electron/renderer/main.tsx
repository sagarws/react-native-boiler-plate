import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

const container = document.getElementById('root')
if (!container) throw new Error('Root container #root is missing from index.html')

/*
 * P1 ONLY — the ported design system, behind a hash nobody reaches by accident.
 *
 * `#ui-preview` mounts Monitor's theme over a page of its components instead of
 * the app. It exists so the port can be looked at and screenshotted while the
 * app it will replace carries on working untouched, and it comes out at P2 when
 * the shell moves over for real. The import is dynamic so that none of the
 * ported stylesheets — which redefine the Tailwind layers — are ever loaded by
 * the app itself.
 */
if (window.location.hash === '#ui-preview') {
  void import('./preview/PreviewRoot').then(({ PreviewRoot }) => {
    createRoot(container).render(
      <StrictMode>
        <PreviewRoot />
      </StrictMode>
    )
  })
} else if (window.location.hash.startsWith('#dialog-gallery')) {
  // Preview only: one dialog at a time, open, with static sample props.
  void import('./preview/DialogGallery').then(({ DialogGallery }) => {
    createRoot(container).render(
      <StrictMode>
        <DialogGallery />
      </StrictMode>
    )
  })
} else {
  void import('./AppRoot').then(({ AppRoot }) => {
    createRoot(container).render(
      <StrictMode>
        <AppRoot />
      </StrictMode>
    )
  })
}
