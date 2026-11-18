import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * The background-work panel must be MOUNTED by the shell the app renders.
 *
 * THE BUG THIS PINS. The panel lived in `layouts/AppLayout`. `layout/AppShell`
 * replaced that layout and did not bring it across, so the component was
 * rendered by nobody — and nothing anywhere failed. Create Ticket still ran in
 * the main process, still broadcast every tick on `claim-queue:batch-progress`,
 * and there was simply no listener mounted to draw them. An operator selected
 * their claims, pressed the button, and got per-claim toasts and no progress.
 *
 * WHY THIS IS A SOURCE TEST. There is no jsdom here, so nothing can be
 * rendered, and the failure has no other signature: an unrendered component
 * type-checks, lints and unit-tests clean. The only observable fact is that
 * nothing imports it. That is what these read.
 */

const renderer = join(__dirname, '..', 'electron', 'renderer')
const read = (...parts: string[]): string => readFileSync(join(renderer, ...parts), 'utf8')

describe('the background-work panel is reachable', () => {
  it('is mounted by the shell App renders', () => {
    // App wraps it locally, so follow the import rather than trusting the name.
    expect(read('App.tsx')).toMatch(/from '\.\/layout\/AppShell'/)

    const shell = read('layout', 'AppShell.tsx')

    expect(shell).toMatch(/import \{ BackgroundWork \}/)
    expect(shell).toMatch(/<BackgroundWork \/>/)
  })

  it('is fixed to the window, not parked in the scrolling content', () => {
    // Automations outlive the screen they were started from. Inside
    // VerticalLayout the panel takes that layout's scroll container and
    // scrolls away with the page, which reads to an operator as "gone".
    const shell = read('layout', 'AppShell.tsx')
    const mount = shell.indexOf('<BackgroundWork />')
    const layoutCloses = shell.indexOf('</VerticalLayout>')

    expect(layoutCloses).toBeGreaterThan(-1)
    expect(mount).toBeGreaterThan(layoutCloses)
    expect(read('components', 'BackgroundWork.tsx')).toMatch(/'fixed bottom-4 right-4 z-40/)
  })

  it('draws a card for a Create Ticket batch, and listens for its ticks', () => {
    // The two halves that have to agree for the panel to say anything about a
    // batch: the subscription, and the card it feeds.
    const panel = read('components', 'BackgroundWork.tsx')

    expect(panel).toMatch(/onClaimBatchProgress\(/)
    // The card's KEY, not its title: the title is display copy ("Ticket
    // creation · Myntra") and was reworded once already; the key is what makes
    // it the batch's card.
    expect(panel).toMatch(/key: 'create-ticket'/)
  })
})
