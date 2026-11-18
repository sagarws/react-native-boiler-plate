import type { ReactNode } from 'react'
import { useId } from 'react'

export interface FormFieldProps {
  label: string
  error?: string | undefined
  hint?: string
  required?: boolean
  /** Receives the ids it must wire up for accessibility. */
  children: (props: { id: string; describedBy: string | undefined; invalid: boolean }) => ReactNode
}

export const FormField = ({ label, error, hint, required = false, children }: FormFieldProps) => {
  const id = useId()
  const errorId = `${id}-error`
  const hintId = `${id}-hint`
  const describedBy = error ? errorId : hint ? hintId : undefined

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-semibold text-body">
        {label}
        {required && (
          <span className="ml-0.5 text-muted" aria-hidden="true">
            *
          </span>
        )}
      </label>

      {children({ id, describedBy, invalid: Boolean(error) })}

      {error ? (
        <p id={errorId} role="alert" className="text-xs text-danger-fg">
          {error}
        </p>
      ) : hint ? (
        <p id={hintId} className="text-xs text-muted">
          {hint}
        </p>
      ) : null}
    </div>
  )
}
