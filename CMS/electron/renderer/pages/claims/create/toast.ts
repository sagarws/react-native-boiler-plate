import { useContext, useEffect } from 'react'
import { ToastContext, type ToastApi } from '@renderer/components/feedback/ToastProvider'

/**
 * `toast.error(…)` from anywhere in the ported form.
 *
 * The app's toasts come from a React context, and the ported code calls them
 * from thirty places across twenty files — inside hooks, inside submit
 * handlers, inside callbacks that are not components. TrackVid-FE uses
 * react-hot-toast, which is a module you import and call; matching that call
 * shape is what lets those files stay comparable to the page they came from.
 *
 * So the page registers the real toast API here on mount, and this module
 * forwards to it. Nothing else may use this: a component has `useToast()`, and
 * reaching for a module-level singleton instead would put a second way of
 * saying the same thing into the app.
 *
 * BEFORE REGISTRATION IT IS SILENT, not an error. The only window in which that
 * can happen is the first paint of the page that does the registering, and a
 * dropped toast is better than a page that crashes on the way up.
 */

let sink: ToastApi | null = null

export const toast = {
  success: (message: string): void => sink?.success(message),
  error: (message: string): void => sink?.error(message),
  info: (message: string): void => sink?.info(message)
}

/** Called once, by the page. Clears the sink on unmount so nothing leaks. */
export const useToastBridge = (): void => {
  const api = useContext(ToastContext)

  useEffect(() => {
    sink = api

    return () => {
      // Only if it is still ours: a second Create Claim mounting and unmounting
      // must not silence the one still on screen.
      if (sink === api) sink = null
    }
  }, [api])
}

export default toast
