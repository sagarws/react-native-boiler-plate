/**
 * Local, collision-resistant enough id for queue rows.
 *
 * These ids never leave the device — the globally unique identifier for an
 * order is the S3 object key the backend mints — so a timestamp plus entropy
 * is sufficient and avoids pulling in a uuid dependency.
 */
export function createLocalId(): string {
  const time = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 10);
  return `${time}-${rand}`;
}
