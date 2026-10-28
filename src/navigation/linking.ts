import type { LinkingOptions } from '@react-navigation/native';
import { FOLLOW_UP_VIEWS, type FollowUpView } from '@/features/followup';
import { LIFE_TABS, type LifeTab } from '@/features/life';
import { ROUTES } from './routes';
import type { RootStackParamList } from './types';

/**
 * Deep links, fired only by the app's own native UI (the intent filters are
 * not BROWSABLE, so web pages cannot trigger them):
 * - rnboilerplate://capture/latest — floating button long press.
 * - rnboilerplate://life/today — the Manage Life home-screen widget.
 * - rnboilerplate://followup/contact/<id> · followup/view/<view> — Follow Up
 *   reminder notifications.
 */
export const linking: LinkingOptions<RootStackParamList> = {
  prefixes: ['rnboilerplate://'],
  config: {
    screens: {
      [ROUTES.MAIN]: {
        // Back from a deep-linked screen returns to home, not out of the app.
        initialRouteName: ROUTES.DASHBOARD,
        screens: {
          [ROUTES.EXTRACTED_TEXT]: {
            path: 'capture/:source',
            parse: { source: () => 'latest' as const },
          },
          [ROUTES.FOLLOW_UP_CONTACT]: { path: 'followup/contact/:contactId' },
          [ROUTES.FOLLOW_UP]: {
            path: 'followup/view/:view',
            parse: {
              view: (view: string) =>
                (FOLLOW_UP_VIEWS as readonly string[]).includes(view)
                  ? (view as FollowUpView)
                  : 'today',
            },
          },
          [ROUTES.MANAGE_LIFE]: {
            path: 'life/:tab',
            parse: {
              tab: (tab: string) =>
                (LIFE_TABS as readonly string[]).includes(tab)
                  ? (tab as LifeTab)
                  : 'today',
            },
          },
        },
      },
    },
  },
};
