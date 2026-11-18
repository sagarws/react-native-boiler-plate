import { useCallback, useMemo, useRef, useState } from 'react'

/**
 * The Create Claim form's state, with Formik's shape and none of Formik.
 *
 * WHY NOT FORMIK. The form itself is ported from TrackVid-FE, where it is a
 * Formik form, and every one of its eleven platform components reads
 * `formik.values`, writes `formik.setFieldValue('otherClaimDetails.domestic', …)`
 * and renders `formik.touched.x && formik.errors.x`. Keeping that shape means
 * those components port across unchanged, which is the whole point: the two
 * surfaces must file identical claims, and a rewritten form is a form that
 * drifts.
 *
 * Formik itself is not here, though. It is a dependency this app does not have,
 * its last release is some way back, and the parts of it this form uses are the
 * ones below — nested paths, a validator, touched-on-blur and a submit that
 * marks everything touched. That is a hook, not a package.
 *
 * THE VALIDATOR IS A FUNCTION, not a schema: `validate(values)` returns an
 * error tree shaped like the values. See `validation.ts`, which is the same
 * port of the same rules.
 */

/**
 * An error tree: the values' shape, with messages at the leaves.
 *
 * Typed loosely on purpose, as Formik types its own. The form's real shape is
 * `ICms`, which is fully checked where it matters — in `shared/`, in the
 * validator, and in the payload the main process builds. An error tree is read
 * by hundreds of `touched.a?.b && errors.a?.b` expressions in the ported forms,
 * and a precise mapped type over a structure with optional bundles and arrays
 * makes every one of them a cast.
 */
export type FormErrors = Record<string, any>
/** A touched tree: the values' shape, with booleans at the leaves. */
export type FormTouched = Record<string, any>

export interface ClaimFormConfig<T extends object> {
  initialValues: T
  validate: (values: T) => FormErrors
  onSubmit: (values: T) => void | Promise<void>
}

export interface ClaimForm<T extends object> {
  values: T
  errors: FormErrors
  touched: FormTouched
  initialValues: T
  setFieldValue: (path: string, value: unknown) => void
  setFieldError: (path: string, message: string | undefined) => void
  setFieldTouched: (path: string, isTouched?: boolean, shouldValidate?: boolean) => void
  handleChange: (event: { target: { name?: string; value?: unknown; type?: string; checked?: boolean } }) => void
  handleBlur: (event: { target: { name?: string } }) => void
  handleSubmit: (event?: { preventDefault?: () => void }) => void
  resetForm: (next?: { values?: T }) => void
  validateForm: () => FormErrors
}

/** `a.b.0.c` → `['a','b','0','c']`, tolerating `a.b[0].c` as Formik does. */
const segmentsOf = (path: string): string[] =>
  path
    .replace(/\[(\d+)\]/g, '.$1')
    .split('.')
    .filter((segment) => segment.length > 0)

/**
 * A copy of `source` with `path` set to `value`.
 *
 * Copies only the nodes along the path, so a change to one packing image does
 * not give React a new identity for every other branch of the form.
 */
const setIn = <T,>(source: T, path: string, value: unknown): T => {
  const segments = segmentsOf(path)

  if (segments.length === 0) return source

  const write = (node: unknown, depth: number): unknown => {
    const key = segments[depth] as string
    const last = depth === segments.length - 1
    // An array index only where the container already IS an array. Creating one
    // from a numeric key would turn `values['0']` into a list on a typo.
    const isIndex = Array.isArray(node)

    if (isIndex) {
      const copy = [...(node as unknown[])]
      const index = Number(key)

      copy[index] = last ? value : write(copy[index], depth + 1)

      return copy
    }

    const record = node && typeof node === 'object' ? { ...(node as Record<string, unknown>) } : {}

    record[key] = last ? value : write(record[key], depth + 1)

    return record
  }

  return write(source, 0) as T
}

const getIn = (source: unknown, path: string): unknown => {
  let node: unknown = source

  for (const key of segmentsOf(path)) {
    if (node === null || node === undefined) return undefined
    node = (node as Record<string, unknown>)[key]
  }

  return node
}

/**
 * Every leaf of `values`, marked.
 *
 * Submit has to mark the whole form touched or a required field the operator
 * never visited stays silent — the error is computed but nothing renders it,
 * and the operator is told "fix the form" with nothing highlighted.
 */
const touchAll = (values: unknown): unknown => {
  if (Array.isArray(values)) return values.map((entry) => touchAll(entry))

  if (values && typeof values === 'object') {
    const out: Record<string, unknown> = {}

    for (const [key, value] of Object.entries(values as Record<string, unknown>)) {
      out[key] = touchAll(value)
    }

    return out
  }

  return true
}

/** Is there a message anywhere in the tree? */
export const hasErrors = (errors: unknown): boolean => {
  if (typeof errors === 'string') return errors.length > 0
  if (Array.isArray(errors)) return errors.some((entry) => hasErrors(entry))

  if (errors && typeof errors === 'object') {
    return Object.values(errors as Record<string, unknown>).some((entry) => hasErrors(entry))
  }

  return false
}

export const useClaimForm = <T extends object>(
  config: ClaimFormConfig<T>
): ClaimForm<T> => {
  const [values, setValues] = useState<T>(config.initialValues)
  const [touched, setTouched] = useState<FormTouched>({})
  /**
   * Errors the VALIDATOR produced, and errors set by hand, kept apart.
   *
   * `setFieldError` is how the submit reports things a validator cannot see —
   * a six-side PDF that failed to upload, an additional-field pair with one
   * half filled. Those must survive the next validation pass, and a single
   * merged object loses them the moment anything re-validates.
   */
  const [manualErrors, setManualErrors] = useState<Record<string, string | undefined>>({})

  // Held in a ref so `handleSubmit` and `validateForm` can stay identity-stable
  // while still calling the CURRENT validator — it is rebuilt whenever the
  // platform changes, and a stale one would validate the previous platform's
  // rules against this platform's form.
  const configRef = useRef(config)
  configRef.current = config

  const validated = useMemo(() => config.validate(values), [config, values])

  const errors = useMemo(() => {
    let merged: FormErrors = validated

    for (const [path, message] of Object.entries(manualErrors)) {
      if (message === undefined) continue
      merged = setIn(merged, path, message)
    }

    return merged
  }, [validated, manualErrors])

  const setFieldValue = useCallback((path: string, value: unknown) => {
    setValues((current) => setIn(current, path, value))
    // A field the operator has just changed no longer carries a hand-set error
    // about its previous value.
    setManualErrors((current) => (path in current ? { ...current, [path]: undefined } : current))
  }, [])

  const setFieldError = useCallback((path: string, message: string | undefined) => {
    setManualErrors((current) => ({ ...current, [path]: message }))
  }, [])

  const setFieldTouched = useCallback((path: string, isTouched = true) => {
    setTouched((current) => setIn(current, path, isTouched))
  }, [])

  const handleChange = useCallback(
    (event: { target: { name?: string; value?: unknown; type?: string; checked?: boolean } }) => {
      const name = event.target.name

      if (!name) return

      const next = event.target.type === 'checkbox' ? event.target.checked : event.target.value

      setFieldValue(name, next)
    },
    [setFieldValue]
  )

  const handleBlur = useCallback(
    (event: { target: { name?: string } }) => {
      const name = event.target.name

      if (!name) return

      setFieldTouched(name, true)
    },
    [setFieldTouched]
  )

  const validateForm = useCallback((): FormErrors => configRef.current.validate(values), [values])

  const handleSubmit = useCallback(
    (event?: { preventDefault?: () => void }) => {
      event?.preventDefault?.()

      const current = configRef.current
      const found = current.validate(values)

      setTouched(touchAll(values) as FormTouched)

      if (hasErrors(found)) return

      void current.onSubmit(values)
    },
    [values]
  )

  const resetForm = useCallback(
    (next?: { values?: T }) => {
      setValues(next?.values ?? configRef.current.initialValues)
      setTouched({})
      setManualErrors({})
    },
    []
  )

  return {
    values,
    errors,
    touched,
    initialValues: config.initialValues,
    setFieldValue,
    setFieldError,
    setFieldTouched,
    handleChange,
    handleBlur,
    handleSubmit,
    resetForm,
    validateForm
  }
}

export { getIn, setIn }
