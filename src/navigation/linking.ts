import type { LinkingOptions } from '@react-navigation/native';
import { ROUTES } from './routes';
import type { RootStackParamList } from './types';

/**
 * Deep links. The only one is fired by the native floating button on long
 * press — rnboilerplate://capture/latest — and opens the latest capture. The
 * intent filter is not BROWSABLE, so web pages cannot trigger it.
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
        },
      },
    },
  },
};
