import { apiClient } from '@/services/api';
import { logger } from '@/shared/utils';
import { appVersion } from '@/shared/utils/appVersion';
import { sessionStore } from './session.store';
import type { Session } from './session.types';

export interface LoginPayload {
  email: string;
  password: string;
}

/**
 * POST /api/auth/login → persists the session so the API client's token
 * provider picks it up on the next request. Replace the path and payload with
 * your backend's contract.
 *
 * `versionName` is reported so support can see which build a user runs.
 */
export async function login(payload: LoginPayload): Promise<Session> {
  const session = await apiClient.postData<Session>('/api/auth/login', {
    ...payload,
    versionName: appVersion,
  });
  sessionStore.write(session);
  return session;
}

/**
 * Clears local state so the UI flips to signed-out immediately. If your
 * backend has a logout/revoke endpoint, call it here before clearing — but
 * never block the local sign-out on the network.
 */
export function signOut(): void {
  logger.info('signOut: clearing local session');
  sessionStore.clear();
}
