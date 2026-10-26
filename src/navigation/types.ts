import type { NavigatorScreenParams } from '@react-navigation/native';

/** Pre-auth stack. */
export type AuthStackParamList = {
  Login: undefined;
};

/**
 * Post-auth stack: a dashboard behind a side drawer, with further screens
 * pushed on top of it.
 */
export type MainStackParamList = {
  Dashboard: undefined;
  Settings: undefined;
};

export type RootStackParamList = {
  Auth: NavigatorScreenParams<AuthStackParamList>;
  Main: NavigatorScreenParams<MainStackParamList>;
};

// A global root param list gives `useNavigation()` full inference without a
// per-call generic.
declare global {
  namespace ReactNavigation {
    interface RootParamList extends RootStackParamList, MainStackParamList {}
  }
}
