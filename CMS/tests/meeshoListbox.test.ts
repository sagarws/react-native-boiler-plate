import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'

/**
 * Picking a value from one of Meesho's dropdowns.
 *
 * Meesho rebuilt these controls. The old code found them by hunting for
 * `.MuiBox-root` and a `.css-ie6h5v` arrow; those classes no longer exist, so
 * every claim died at "Could not click State of packet dropdown" — and then at
 * Submit, several steps from the cause.
 *
 * The replacement navigates by ROLE and LABEL. `aria-haspopup`, `role="option"`
 * and the label's `for` are contract — what a screen reader uses — and they
 * survive a redesign that renames every class in the file. These tests pin that
 * behaviour against the real DOM Meesho now serves.
 */

const require_ = createRequire(import.meta.url)

const { selectFromLabelledListbox } = require_(
  '@trackvid/automation-core/platforms/meesho/claim-management/common/utils'
) as {
  selectFromLabelledListbox: (page: unknown, label: string, option: string) => Promise<void>
}

/**
 * A page stub that runs the real in-page functions against a fake DOM.
 *
 * `state.value` stands in for what the button displays after a pick — the thing
 * the verification step reads.
 */
const makePage = (options: {
  labelText?: string
  optionTexts?: string[]
  /** Simulates a control that re-renders and drops the click. */
  acceptsPick?: boolean
  disabled?: string[]
}) => {
  const state = { opened: false, value: '', picked: null as string | null }
  const labelText = options.labelText ?? 'State of the packet*'
  const optionTexts = options.optionTexts ?? ['Intact', 'Tampered']
  const acceptsPick = options.acceptsPick ?? true

  const button = {
    getAttribute: () => null,
    scrollIntoView: () => undefined,
    click: () => {
      state.opened = true
    },
    get textContent() {
      return state.value
    }
  }

  const label = {
    textContent: labelText,
    querySelector: (sel: string) => (sel.includes('aria-haspopup') ? button : null),
    parentElement: null
  }

  const optionNodes = optionTexts.map(text => ({
    textContent: text,
    getAttribute: (name: string) =>
      name === 'aria-disabled' && options.disabled?.includes(text) ? 'true' : null,
    scrollIntoView: () => undefined,
    click: () => {
      state.picked = text
      if (acceptsPick) state.value = text
    }
  }))

  const document = {
    querySelectorAll: (selector: string) => {
      if (selector === 'label') return [label]
      if (selector.includes('role="option"')) return state.opened ? optionNodes : []

      return []
    }
  }

  return {
    state,
    evaluate: (fn: (...args: unknown[]) => unknown, ...args: unknown[]) => {
      ;(globalThis as { document?: unknown }).document = document

      return Promise.resolve(fn(...args))
    },
    waitForFunction: (fn: (...args: unknown[]) => unknown, _opts: unknown, ...args: unknown[]) => {
      ;(globalThis as { document?: unknown }).document = document

      return fn(...args) ? Promise.resolve(true) : Promise.reject(new Error('timed out'))
    }
  }
}

describe('selectFromLabelledListbox', () => {
  it('opens the control under the label and picks the option', async () => {
    const page = makePage({})

    await expect(selectFromLabelledListbox(page, 'State of the packet', 'Intact')).resolves
      .toBeUndefined()

    expect(page.state.picked).toBe('Intact')
  })

  it('matches the label even though the DOM appends the required asterisk', async () => {
    // The rendered label is "State of the packet *" — an exact match finds
    // nothing, which is the sort of thing that costs an afternoon.
    const page = makePage({ labelText: 'State of the packet *' })

    await selectFromLabelledListbox(page, 'State of the packet', 'Tampered')
    expect(page.state.picked).toBe('Tampered')
  })

  it('says the dropdown never listed the option, rather than timing out silently', async () => {
    const page = makePage({ optionTexts: ['Intact'] })

    await expect(selectFromLabelledListbox(page, 'State of the packet', 'Tampered')).rejects
      .toThrow(/never listed "Tampered"/)
  })

  it('refuses a disabled option instead of reporting a pick that did nothing', async () => {
    const page = makePage({ disabled: ['Intact'] })

    await expect(
      selectFromLabelledListbox(page, 'State of the packet', 'Intact')
    ).rejects.toThrow(/Could not click "Intact"/)
  })

  it('catches a click the control re-rendered away', async () => {
    // Clicking is not the same as the form accepting it. Without this the run
    // continues with an empty required field and fails at Submit instead.
    const page = makePage({ acceptsPick: false })

    await expect(selectFromLabelledListbox(page, 'State of the packet', 'Intact')).rejects
      .toThrow(/did not take it/)
  })

  it('names the label when there is no such control on the page', async () => {
    const page = makePage({ labelText: 'Something else' })

    await expect(selectFromLabelledListbox(page, 'State of the packet', 'Intact')).rejects
      .toThrow(/Could not open the "State of the packet" dropdown/)
  })
})

/**
 * "Ticket <id> has already been raised for this issue."
 *
 * Meesho answers this inline the moment the AWB is entered. Pushing past it
 * either gets the form rejected or — worse — raises a SECOND ticket for one
 * return, which nobody can undo. The number it shows is the useful part: the
 * CMS row was missing exactly that.
 */
const { readAlreadyRaisedTicket } = require_(
  '@trackvid/automation-core/platforms/meesho/claim-management/common/utils'
) as {
  readAlreadyRaisedTicket: (
    page: unknown,
    options?: { waitMs?: number; intervalMs?: number }
  ) => Promise<{ ticketId: string; message: string } | null>
}

/**
 * Drives the real in-page function against the markup Meesho actually serves.
 *
 * `appearsAfter` models the thing that broke it in the real world: Meesho
 * validates the AWB on its server, so the message renders a second or two after
 * the field is filled — not when typing finishes.
 */
const pageWith = (nodes: { text: string; button?: string }[], appearsAfter = 0) => {
  let reads = 0
  const elements = nodes.map(node => ({
    innerText: node.text,
    textContent: node.text,
    querySelector: (sel: string) =>
      sel === 'button' && node.button !== undefined
        ? { innerText: node.button, textContent: node.button }
        : null
  }))

  return {
    get reads() {
      return reads
    },
    evaluate: (fn: () => unknown) => {
      const visible = reads++ >= appearsAfter ? elements : []

      ;(globalThis as { document?: unknown }).document = {
        querySelectorAll: () => visible
      }

      return Promise.resolve(fn())
    }
  }
}

const RAISED =
  'Ticket 7788934011637 has already been raised for this issue. Please reply on the same ticket.'

describe('readAlreadyRaisedTicket', () => {
  it('reads the id out of the button Meesho renders it in', async () => {
    const found = await readAlreadyRaisedTicket(pageWith([{ text: RAISED, button: '7788934011637' }]))

    expect(found?.ticketId).toBe('7788934011637')
  })

  it('falls back to the digits in the sentence when the markup changes', async () => {
    // The button is a link to the ticket; losing it should cost the link, not
    // the number.
    const found = await readAlreadyRaisedTicket(pageWith([{ text: RAISED }]))

    expect(found?.ticketId).toBe('7788934011637')
  })

  it('picks the smallest element carrying the sentence', async () => {
    // A wider container holds half the form — and the wrong button with it.
    const found = await readAlreadyRaisedTicket(
      pageWith([
        { text: `Some outer wrapper ${RAISED} and more form below`, button: '999' },
        { text: RAISED, button: '7788934011637' }
      ])
    )

    expect(found?.ticketId).toBe('7788934011637')
  })

  it('says nothing when the form is simply fine', async () => {
    await expect(
      readAlreadyRaisedTicket(pageWith([{ text: 'Please enter a valid sub order number' }]))
    ).resolves.toBeNull()
  })

  it('waits for a verdict that arrives late, which is what broke it live', async () => {
    // A single read the moment typing finishes found an empty form and the run
    // sailed past into a claim that could never be submitted.
    const page = pageWith([{ text: RAISED, button: '7788934011637' }], 3)

    const found = await readAlreadyRaisedTicket(page, { waitMs: 3000, intervalMs: 1 })

    expect(found?.ticketId).toBe('7788934011637')
    expect(page.reads).toBeGreaterThan(3)
  })

  it('reads once when asked to, for the gate right before submit', async () => {
    const page = pageWith([{ text: RAISED, button: '7788934011637' }])

    await readAlreadyRaisedTicket(page)

    expect(page.reads).toBe(1)
  })
})
