/**
 * RFC 4122 version-4 UUID. Hermes has no `crypto.randomUUID`, and these ids
 * only need to be unique on this device (they never leave it except inside
 * the user's own export), so Math.random is sufficient.
 */
export function uuidV4(): string {
  const hex: string[] = [];
  for (let i = 0; i < 16; i++) {
    let byte = Math.floor(Math.random() * 256);
    if (i === 6) byte = (byte % 16) + 0x40; // version 4: 0100xxxx
    if (i === 8) byte = (byte % 64) + 0x80; // RFC 4122 variant: 10xxxxxx
    hex.push(byte.toString(16).padStart(2, '0'));
  }
  return [
    hex.slice(0, 4).join(''),
    hex.slice(4, 6).join(''),
    hex.slice(6, 8).join(''),
    hex.slice(8, 10).join(''),
    hex.slice(10).join(''),
  ].join('-');
}

/** A random token for one browser session's capture messages. */
export function randomToken(): string {
  return uuidV4().replace(/-/g, '');
}
