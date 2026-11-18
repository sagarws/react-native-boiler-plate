import type { DomainRule } from '../types';
import { parseUrl } from './url';

/**
 * DomainFilterService: which pages and requests may be recorded.
 *
 * Matching is by exact host label, never by substring: with
 * `seller.example.com` allowed, `seller.example.com.attacker.com` and
 * `evilseller.example.com` don't match. Subdomains match only when the rule
 * says so. A rule without a port matches the scheme's default port only.
 */

const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

function validHostname(host: string): boolean {
  if (host.length > 253) return false;
  const ip = IPV4.exec(host);
  if (ip) return ip.slice(1).every(part => Number(part) <= 255);
  if (host === 'localhost') return true;
  const labels = host.split('.');
  return (
    labels.length >= 2 &&
    labels.every(label => LABEL.test(label)) &&
    // A top-level label is never all digits.
    !/^\d+$/.test(labels[labels.length - 1])
  );
}

/**
 * Parses what the user typed — `seller.example.com`, a full URL, or
 * `*.example.com` (= example.com with subdomains). null when invalid.
 */
export function parseDomainInput(
  input: string,
  includeSubdomains = false,
): DomainRule | null {
  let text = input.trim().toLowerCase();
  if (!text) return null;
  let subdomains = includeSubdomains;
  if (text.startsWith('*.')) {
    subdomains = true;
    text = text.slice(2);
  }
  const url = parseUrl(
    /^[a-z][a-z0-9+.-]*:\/\//.test(text) ? text : `https://${text}`,
  );
  if (!url || (url.scheme !== 'http' && url.scheme !== 'https')) return null;
  if (!validHostname(url.hostname)) return null;
  if (url.port && !(Number(url.port) >= 1 && Number(url.port) <= 65535)) {
    return null;
  }
  // IP addresses and localhost have no subdomains.
  const noSubs = IPV4.test(url.hostname) || url.hostname === 'localhost';
  return {
    host: `${url.hostname}${url.port ? `:${url.port}` : ''}`,
    includeSubdomains: subdomains && !noSubs,
  };
}

function splitHost(hostWithPort: string): { name: string; port: string } {
  const colon = hostWithPort.lastIndexOf(':');
  return colon < 0 || hostWithPort.startsWith('[')
    ? { name: hostWithPort, port: '' }
    : {
        name: hostWithPort.slice(0, colon),
        port: hostWithPort.slice(colon + 1),
      };
}

/** Does `host[:port]` (as from `hostOf`) satisfy [rule]? */
export function hostMatchesRule(
  hostWithPort: string,
  rule: DomainRule,
): boolean {
  const host = splitHost(hostWithPort.toLowerCase());
  const want = splitHost(rule.host);
  if (host.port !== want.port || !host.name) return false;
  if (host.name === want.name) return true;
  return rule.includeSubdomains && host.name.endsWith(`.${want.name}`);
}

/** Is [url] an http(s) URL on one of the allowed domains? */
export function isUrlAllowed(
  url: string,
  rules: readonly DomainRule[],
): boolean {
  const parsed = parseUrl(url);
  if (!parsed || (parsed.scheme !== 'http' && parsed.scheme !== 'https')) {
    return false;
  }
  const host = `${parsed.hostname}${parsed.port ? `:${parsed.port}` : ''}`;
  return rules.some(rule => hostMatchesRule(host, rule));
}

/**
 * Chromium origin rules for `addDocumentStartJavaScript` (Android): the
 * capture script only ever loads into frames from these origins.
 */
export function toOriginRules(rules: readonly DomainRule[]): string[] {
  const out = new Set<string>();
  for (const rule of rules) {
    for (const scheme of ['https', 'http']) {
      out.add(`${scheme}://${rule.host}`);
      if (rule.includeSubdomains) out.add(`${scheme}://*.${rule.host}`);
    }
  }
  return [...out];
}

export function sameRule(a: DomainRule, b: DomainRule): boolean {
  return a.host === b.host;
}
