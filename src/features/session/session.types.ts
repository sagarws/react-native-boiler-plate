/**
 * The signed-in user, as returned by the login endpoint. Replace these fields
 * with whatever your backend actually sends — keep it in sync with the API
 * contract, not with what the UI happens to display.
 */
export interface User {
  id: string;
  name: string;
  email: string;
}

export interface Session {
  accessToken: string;
  user: User;
}
