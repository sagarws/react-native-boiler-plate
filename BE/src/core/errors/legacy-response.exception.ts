/**
 * Thrown by guards/handlers to answer with an exact legacy status + body
 * (e.g. `{ isSuccess: false, message, displayMessage }`). The global filter sends it verbatim.
 */
export class LegacyResponseException extends Error {
  constructor(
    public readonly status: number,
    public readonly body: unknown,
    public readonly headers: Record<string, string> = {},
  ) {
    super(typeof body === 'object' && body && 'message' in (body as any) ? String((body as any).message) : `HTTP ${status}`);
  }
}
