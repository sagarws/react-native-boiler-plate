import { createContext, useContext, useMemo, type ReactNode } from 'react';

/**
 * Whether this is a new claim or an edit of one already filed.
 *
 * REPLACES the web app's `useLocation().pathname === ROUTE_URLS.CMS_UPDATE`.
 * There, the two screens are two URLs and any component can ask the router
 * which it is on. A desktop window has no address bar and this app has no
 * router — it has a screen id and a target — so the answer is passed down
 * instead of looked up.
 *
 * It matters to more than the heading. In update mode the VMS auto-fetch does
 * NOT reach out and re-place screenshots over slots the claim already has
 * filled, and the image previews hydrate from the stored claim rather than from
 * what the operator has captured this session. A component that got this wrong
 * would quietly replace filed evidence with a fresh screenshot.
 */

export interface ClaimFormModeApi {
  isUpdateMode: boolean;
  /** The claim's return AWB, when opening straight into an edit. */
  awb: string;
  /** The platform that claim is filed under. */
  platform: string;
  /** Back to the claim queue. Rendered only in update mode. */
  onBack?: () => void;
  /**
   * Where the AJIO Return Order Number lookup reads from — the header toggle.
   *
   * Carried on this context rather than passed down: the control is in the
   * page header and the lookup is deep inside the AJIO form, with several
   * platform-agnostic components between them that have no business knowing
   * about either.
   *
   * Absent means `api`, which is what the lookup did before the choice existed.
   */
  lookupSource?: 'api' | 'report';
}

const CREATE: ClaimFormModeApi = { isUpdateMode: false, awb: '', platform: '' };

const ClaimFormModeContext = createContext<ClaimFormModeApi>(CREATE);

export const ClaimFormModeProvider = ({
  value,
  children
}: {
  value: ClaimFormModeApi;
  children: ReactNode;
}) => {
  // Rebuilt only when one of the five actually changes. The caller passes a
  // fresh object literal on every render, which would otherwise re-render every
  // consumer of this context on every keystroke in the form.
  // `lookupSource` MUST be carried through: dropping it here made the header
  // toggle a no-op — every lookup fell back to `api` whatever was selected.
  /*
   * Rebuilt only when one of these actually changes. The caller passes a fresh
   * object literal on every render, which would otherwise re-render every
   * consumer of this context on every keystroke in the form.
   *
   * EVERY FIELD HAS TO BE LISTED HERE, THREE TIMES — destructured, returned,
   * and in the deps. A field added to `ClaimFormModeApi` and to the caller but
   * not to this memo is silently dropped: consumers read `undefined` and the
   * types say nothing, because the rebuilt object still satisfies the
   * interface when the field is optional.
   *
   * That is not hypothetical. `lookupSource` — the API/Report toggle — was
   * added to the interface and passed by the page, and this memo quietly threw
   * it away: the toggle moved, the log said REPORT, and every lookup still went
   * to AJIO because the form read `undefined`.
   */
  const { isUpdateMode, awb, platform, onBack, lookupSource } = value;
  const memoised = useMemo<ClaimFormModeApi>(
    () => ({ isUpdateMode, awb, platform, onBack, lookupSource }),
    [isUpdateMode, awb, platform, onBack, lookupSource]
  );

  return <ClaimFormModeContext.Provider value={memoised}>{children}</ClaimFormModeContext.Provider>;
};

export const useClaimFormMode = (): ClaimFormModeApi => useContext(ClaimFormModeContext);
