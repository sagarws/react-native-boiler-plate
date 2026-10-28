import type { LinkingOptions } from '@react-navigation/native';
import { LIFE_TABS, type LifeTab } from '@/features/life';
import { ROUTES } from './routes';
import type { RootStackParamList } from './types';

/**
 * Deep links, fired only by the app's own native UI (the intent filters are
 * not BROWSABLE, so web pages cannot trigger them):
 * - rnboilerplate://capture/latest — floating button long press.
 * - rnboilerplate://life/today — the Manage Life home-screen widget.
 */
export const linking: LinkingOptions<RootStackParamList> = {
  prefixes: ['rnboilerplate://'],
  config: {
    screens: {
      [ROUTES.MAIN]: {
        screens: {
          [ROUTES.EXTRACTED_TEXT]: {
            path: 'capture/:source',
            parse: { source: () => 'latest' as const },
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
