import { DIRECT_DIAL_TIMEOUT_MS } from '../core/constants';
import { isWebSocketRelay } from '../core/ids';
import { dialThroughRelay, type OpenStream } from '../core/relay';
import type { ByteStream } from '../core/stream';
import { WebSocketStream } from '../core/wsStream';
import { dialTcp } from './tcp';

/** How to reach a host: straight over the LAN, or through the relay. */
export type Route =
  | { kind: 'direct'; host: string; port: number }
  | { kind: 'relay'; relay: string; deviceId: string };

/** A fresh connection to the relay (WebSocket or plain TCP). */
export const relayOpener =
  (relay: string): OpenStream =>
  (timeoutMs: number) => {
    if (isWebSocketRelay(relay)) return WebSocketStream.open(relay, timeoutMs);
    const index = relay.lastIndexOf(':');
    const host = relay.slice(0, index).replace(/^\[|\]$/g, '');
    return dialTcp(host, Number(relay.slice(index + 1)), timeoutMs);
  };

export const dial = (route: Route, timeoutMs = 4000): Promise<ByteStream> =>
  route.kind === 'direct'
    ? dialTcp(route.host, route.port, timeoutMs)
    : dialThroughRelay(relayOpener(route.relay), route.deviceId);

/**
 * The routes to try for a device ID, in order: found on this network → last
 * known LAN address → the relay.
 */
export const routesFor = (
  id: string,
  lan: { address: string; port: number } | null,
  last: { address: string; port: number } | null,
  relay: string,
): { route: Route; timeoutMs: number }[] => {
  const out: { route: Route; timeoutMs: number }[] = [];
  if (lan)
    out.push({
      route: { kind: 'direct', host: lan.address, port: lan.port },
      timeoutMs: 4000,
    });
  if (last?.address && last.address !== lan?.address)
    out.push({
      route: { kind: 'direct', host: last.address, port: last.port },
      timeoutMs: DIRECT_DIAL_TIMEOUT_MS,
    });
  if (relay)
    out.push({
      route: { kind: 'relay', relay, deviceId: id },
      timeoutMs: 15_000,
    });
  return out;
};
