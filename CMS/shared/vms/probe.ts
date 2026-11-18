/**
 * Response payload for system:probe-api. The renderer opens a modal with the
 * body and status code regardless of HTTP result, so every field is filled
 * even when the transport rejected.
 */
export interface ApiProbeResult {
  /** Full URL that was hit. */
  url: string
  /**
   * HTTP status. 0 when the fetch threw before a response landed (DNS,
   * connection refused, TLS, timeout).
   */
  status: number
  /** HTTP status text ("OK", "Not Found", ...) or the JS error name. */
  statusText: string
  /** Response body as text, or the JS error message when status === 0. */
  body: string
  /** Content-Type header, if the server sent one. */
  contentType: string
  /** Round-trip time from just-before-fetch to just-after-response, ms. */
  latencyMs: number
  /** true when the transport completed (any HTTP response, 2xx-5xx). */
  reachable: boolean
}
