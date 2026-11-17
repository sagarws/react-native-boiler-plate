import { readStored, removeStored, writeStored } from "@/lib/storage";

/** Mock session kept in localStorage (`trackvid-ui:token`, `trackvid-ui:impersonator`). */
export const SessionStore = {
  getToken(): string | null {
    return readStored<string | null>("token", null);
  },
  setToken(token: string): void {
    writeStored("token", token);
  },
  clear(): void {
    removeStored("token");
    removeStored("impersonator");
  },
  getImpersonator(): string | null {
    return readStored<string | null>("impersonator", null);
  },
  setImpersonator(name: string | null): void {
    if (name) writeStored("impersonator", name);
    else removeStored("impersonator");
  },
};
