/**
 * A minimal stand-in for redux-toolkit's `createSlice`, so the VMS state code
 * ported from Argos Watch keeps its exact shape (`setOrderType(...)` action
 * creators, reducers that "mutate" a draft) without bringing redux, react-redux
 * or immer into the CMS. See VMS_MERGE_PLAN.md §2.
 *
 * Reducers receive a structured clone of their slice and may mutate it; the
 * clone becomes the new slice state, so every changed path gets a new
 * reference and selectors re-render exactly as they would under immer.
 * Dispatch is rare (user actions, queue counts), so the clone is cheap.
 */
export interface PayloadAction<P = void> {
  type: string
  payload: P
}

export interface AnyAction {
  type: string
  payload?: unknown
}

type CaseReducer<S, P> = (state: S, action: PayloadAction<P>) => void

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type CaseReducers<S> = Record<string, CaseReducer<S, any>>

type ActionCreators<S, R extends CaseReducers<S>> = {
  [K in keyof R]: R[K] extends (state: S) => void
    ? () => AnyAction
    : R[K] extends CaseReducer<S, infer P>
      ? (payload: P) => PayloadAction<P>
      : never
}

export interface Slice<S, R extends CaseReducers<S>> {
  name: string
  actions: ActionCreators<S, R>
  reducer: (state: S | undefined, action: AnyAction) => S
}

export const createSlice = <S, R extends CaseReducers<S>>(options: {
  name: string
  initialState: S
  reducers: R
}): Slice<S, R> => {
  const { name, initialState, reducers } = options
  const actions = {} as Record<string, (payload?: unknown) => AnyAction>

  for (const key of Object.keys(reducers)) {
    actions[key] = (payload?: unknown) => ({ type: `${name}/${key}`, payload })
  }

  const reducer = (state: S | undefined, action: AnyAction): S => {
    const current = state ?? initialState
    const prefix = `${name}/`
    if (!action.type.startsWith(prefix)) return current

    const handler = reducers[action.type.slice(prefix.length)]
    if (!handler) return current

    const draft = structuredClone(current)
    handler(draft, action as PayloadAction<unknown>)
    return draft
  }

  return { name, actions: actions as ActionCreators<S, R>, reducer }
}
