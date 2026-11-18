import type { DomainRule } from '../types';

/**
 * RequestInterceptor + ResponseInterceptor: the script that runs inside each
 * allowed page, before the page's own scripts.
 *
 * - Android: registered with `addDocumentStartJavaScript`, which Chromium
 *   loads only into frames whose origin matches the allowed domains.
 * - iOS: a document-start WKUserScript in every frame; the script checks its
 *   own frame's host against the same rules and does nothing elsewhere.
 *
 * It wraps `fetch`, `XMLHttpRequest` and `navigator.sendBeacon`. The page's
 * call is made first and unchanged — the wrapper returns the page's own
 * promise / lets the XHR run — and recording happens on the side: response
 * bodies are read from a clone (fetch) or after `loadend` (XHR). Every
 * recording step is in try/catch, so a capture bug can't break the site.
 *
 * Browser-added request headers (User-Agent, Accept-Language, Origin,
 * Referer, sec-ch-ua*, sec-fetch-*, default Accept) are invisible to page
 * JavaScript, so the script fills them in the way Chromium/WebKit would
 * send them and lists their names in `added`; the page's own headers always
 * win. `cred` says whether the browser attaches cookies to the request
 * (credentials mode + same-origin), so the app can read them natively.
 *
 * Events are batched (≈200 ms) into one postMessage carrying the session
 * [token]; the app drops anything without it. Body text is capped at
 * [bodyLimitBytes] and marked truncated.
 *
 * This is page JavaScript, kept ES2017 and dependency-free. The domain check
 * here mirrors `domainFilter.ts`; both are covered by tests.
 */

export interface CaptureScriptConfig {
  token: string;
  rules: readonly DomainRule[];
  bodyLimitBytes: number;
  /**
   * Send `document.cookie` with same-origin requests. Only where the app
   * can't read the WebView's cookie store natively (iOS): it misses
   * HttpOnly cookies, which the native store has.
   */
  pageCookies?: boolean;
}

/** Wire protocol version; bump when the event shape changes. */
export const CAPTURE_PROTOCOL = 1;

const SCRIPT = String.raw`
(function (window) {
  'use strict';
  var CFG = __CONFIG__;
  var FLAG = '__aksharNetInspector';
  try {
    if (window[FLAG]) return;
    var loc = window.location;
    if (!loc || (loc.protocol !== 'https:' && loc.protocol !== 'http:')) return;
    var host = String(loc.hostname || '').toLowerCase().replace(/\.$/, '');
    var port = String(loc.port || '');
    var allowed = CFG.rules.some(function (r) {
      var i = r.host.lastIndexOf(':');
      var rh = i < 0 ? r.host : r.host.slice(0, i);
      var rp = i < 0 ? '' : r.host.slice(i + 1);
      if (rp !== port) return false;
      return host === rh || (r.includeSubdomains && host.slice(-rh.length - 1) === '.' + rh);
    });
    if (!allowed) return;
    Object.defineProperty(window, FLAG, { value: true });
  } catch (e) { return; }

  // Originals, taken before any page script can replace them.
  var stringify = JSON.stringify;
  var parse = JSON.parse;
  var now = Date.now;
  var setT = window.setTimeout;
  var Enc = window.TextEncoder;
  var Dec = window.TextDecoder;
  var btoaFn = window.btoa;
  var isTop = (function () { try { return window.top === window; } catch (e) { return false; } })();
  var bridge = null, bridgePost = null;
  function resolveBridge() {
    try {
      var wk = window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.ReactNativeWebView;
      if (wk && typeof wk.postMessage === 'function') { bridge = wk; bridgePost = wk.postMessage; return; }
      var rn = window.ReactNativeWebView;
      if (rn && typeof rn.postMessage === 'function') { bridge = rn; bridgePost = rn.postMessage; }
    } catch (e) { /* no bridge yet */ }
  }
  resolveBridge();

  var LIMIT = CFG.bodyLimitBytes;
  var active = true;
  var pageId = now().toString(36) + Math.random().toString(36).slice(2, 8);
  var counter = 0;
  var inflight = {};
  var queue = [];
  var queuedBytes = 0;
  var timer = null;

  Object.defineProperty(window, '__aksharNetInspectorSetActive', {
    value: function (on) { active = !!on; },
  });

  function flush() {
    timer = null;
    if (!queue.length) return;
    if (!bridgePost) resolveBridge();
    if (!bridgePost) return;
    var events = queue;
    queue = [];
    queuedBytes = 0;
    try {
      bridgePost.call(bridge, stringify({ ni: CFG.token, v: ${CAPTURE_PROTOCOL}, events: events }));
    } catch (e) { /* page is going away */ }
  }
  function emit(event, bytes) {
    queue.push(event);
    queuedBytes += bytes || 256;
    if (queuedBytes > 512 * 1024) flush();
    else if (!timer) timer = setT(flush, 200);
  }

  // ---- browser-added request headers (reconstructed; see top comment) ----
  var navi = window.navigator || {};
  var UA = typeof navi.userAgent === 'string' && navi.userAgent ? navi.userAgent : null;
  var LANG = (function () {
    try {
      var langs = navi.languages && navi.languages.length ? navi.languages : navi.language ? [navi.language] : [];
      var list = [];
      langs.slice(0, 10).forEach(function (l, i) {
        l = String(l);
        if (list.indexOf(l) < 0) list.push(l);
        // Chromium adds the base language after its regional variants.
        var base = l.split('-')[0];
        var next = langs[i + 1] ? String(langs[i + 1]).split('-')[0] : null;
        if (base !== l && next !== base && list.indexOf(base) < 0 && langs.indexOf(base) < 0) list.push(base);
      });
      return list.map(function (l, i) {
        return i === 0 ? l : l + ';q=' + (Math.max(1, 10 - i) / 10).toFixed(1);
      }).join(',') || null;
    } catch (e) { return null; }
  })();
  var CH = (function () {
    try {
      var d = navi.userAgentData;
      if (!d || !d.brands || !d.brands.length) return null;
      return {
        ua: d.brands.map(function (b) { return '"' + b.brand + '";v="' + b.version + '"'; }).join(', '),
        mobile: d.mobile ? '?1' : '?0',
        platform: '"' + String(d.platform || '') + '"',
      };
    } catch (e) { return null; }
  })();
  var POLICIES = ['no-referrer', 'no-referrer-when-downgrade', 'origin', 'origin-when-cross-origin',
    'same-origin', 'strict-origin', 'strict-origin-when-cross-origin', 'unsafe-url'];
  function pagePolicy() {
    try {
      var m = window.document.querySelector('meta[name="referrer"]');
      return m ? String(m.getAttribute('content') || '').toLowerCase().trim() : '';
    } catch (e) { return ''; }
  }
  function refererFor(target, same, o) {
    if (o.referrer === '' || o.referrer === 'no-referrer') return null;
    var policy = String(o.policy || pagePolicy());
    if (POLICIES.indexOf(policy) < 0) policy = 'strict-origin-when-cross-origin';
    var full;
    try { var u = new window.URL(loc.href); u.hash = ''; u.username = ''; u.password = ''; full = u.href; } catch (e) { full = String(loc.href).split('#')[0]; }
    var originOnly = loc.origin + '/';
    var downgrade = loc.protocol === 'https:' && target.protocol !== 'https:';
    switch (policy) {
      case 'no-referrer': return null;
      case 'unsafe-url': return full;
      case 'no-referrer-when-downgrade': return downgrade ? null : full;
      case 'origin': return originOnly;
      case 'same-origin': return same ? full : null;
      case 'strict-origin': return downgrade ? null : originOnly;
      case 'origin-when-cross-origin': return same ? full : originOnly;
      default: return same ? full : downgrade ? null : originOnly;
    }
  }
  // Registrable domain, approximately (no public-suffix list in the page).
  function siteOf(h) {
    var p = String(h).split('.');
    if (p.length <= 2 || /^\d+$/.test(p[p.length - 1])) return h;
    var n = p[p.length - 1].length === 2 && /^(co|com|net|org|gov|ac|edu|gen|firm|ind|nic|res)$/.test(p[p.length - 2]) ? 3 : 2;
    return p.slice(-n).join('.');
  }
  // o: { mode, credentials, referrer, policy }
  function addBrowserHeaders(rec, o) {
    var added = [];
    rec.cred = false;
    try {
      var t = new window.URL(rec.url);
      var same = t.origin === loc.origin;
      var h = rec.headers;
      var put = function (name, value) {
        if (value && headerValue(h, name) === null) { h[name] = String(value); added.push(name); }
      };
      var unsafe = rec.method !== 'GET' && rec.method !== 'HEAD';
      put('Accept', '*/*');
      put('Accept-Language', LANG);
      if (unsafe || (!same && o.mode !== 'no-cors')) put('Origin', loc.origin);
      put('Referer', refererFor(t, same, o));
      put('User-Agent', UA);
      if (t.protocol === 'https:') {
        if (CH) { put('sec-ch-ua', CH.ua); put('sec-ch-ua-mobile', CH.mobile); put('sec-ch-ua-platform', CH.platform); }
        put('sec-fetch-dest', 'empty');
        put('sec-fetch-mode', o.mode || 'cors');
        put('sec-fetch-site', same ? 'same-origin'
          : t.protocol === loc.protocol && siteOf(t.hostname) === siteOf(loc.hostname) ? 'same-site' : 'cross-site');
      }
      var c = o.credentials || 'same-origin';
      rec.cred = c === 'include' || (c === 'same-origin' && same);
      if (rec.cred && same && CFG.pageCookies) {
        try { var dc = window.document.cookie; if (dc) rec.ck = String(dc); } catch (e) { /* no cookie access */ }
      }
    } catch (e) { /* unparsable URL: keep the page's headers only */ }
    rec.added = added;
  }

  function absolute(url) {
    try { return new window.URL(String(url), window.document.baseURI).href; } catch (e) { return String(url); }
  }
  function headerObject(h) {
    var out = {};
    if (!h) return out;
    try {
      if (typeof h.forEach === 'function' && !Array.isArray(h)) {
        h.forEach(function (v, k) { out[k] = String(v); });
      } else if (Array.isArray(h)) {
        h.forEach(function (p) { if (p && p.length >= 2) out[String(p[0])] = String(p[1]); });
      } else if (typeof h === 'object') {
        Object.keys(h).forEach(function (k) { out[k] = String(h[k]); });
      }
    } catch (e) { /* unreadable headers */ }
    return out;
  }
  function headerValue(headers, name) {
    var want = name.toLowerCase();
    for (var k in headers) if (k.toLowerCase() === want) return headers[k];
    return null;
  }
  function parseRawHeaders(raw) {
    var out = {};
    String(raw || '').split(/\r?\n/).forEach(function (line) {
      var i = line.indexOf(':');
      if (i > 0) {
        var k = line.slice(0, i).trim();
        var v = line.slice(i + 1).trim();
        out[k] = out[k] ? out[k] + ', ' + v : v;
      }
    });
    return out;
  }
  function utf8Size(text) {
    try { return new Enc().encode(text).length; } catch (e) { return text.length; }
  }
  function toBase64(bytes) {
    var s = '';
    for (var i = 0; i < bytes.length; i += 0x8000) {
      s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    }
    return btoaFn(s);
  }
  function classify(mime) {
    var m = String(mime || '').toLowerCase();
    if (!m) return 'sniff';
    if (m.indexOf('event-stream') >= 0) return 'stream';
    if (/[/+]json\b/.test(m)) return 'json';
    if (/^text\/|javascript|ecmascript|[/+]xml\b|x-www-form-urlencoded|graphql/.test(m)) return 'text';
    return 'binary';
  }
  function textBody(text, kind, sizeBytes) {
    var size = sizeBytes != null ? sizeBytes : utf8Size(text);
    var truncated = size > LIMIT;
    if (truncated) {
      try { text = new Dec('utf-8').decode(new Enc().encode(text).subarray(0, LIMIT)); } catch (e) { text = text.slice(0, LIMIT); }
    }
    if (kind === 'json' || (kind === 'sniff' && /^\s*[{[]/.test(text))) {
      if (!truncated) {
        try { return { kind: 'json', value: parse(text), truncated: false, sizeBytes: size }; } catch (e) { /* not JSON */ }
      }
    }
    return { kind: 'text', value: text, truncated: truncated, sizeBytes: size };
  }
  function bytesBody(bytes, kind, total) {
    var size = total != null ? total : bytes.length;
    var truncated = size > LIMIT || bytes.length > LIMIT;
    var head = bytes.length > LIMIT ? bytes.subarray(0, LIMIT) : bytes;
    if (kind !== 'binary') {
      var text = null;
      try { text = new Dec('utf-8', { fatal: kind === 'sniff' }).decode(head); } catch (e) { text = null; }
      if (text !== null) {
        var b = textBody(text, kind, size);
        b.truncated = b.truncated || truncated;
        if (truncated && b.kind === 'json') { b.kind = 'text'; b.value = text; }
        return b;
      }
    }
    if (truncated) return { kind: 'binary', value: null, truncated: true, sizeBytes: size };
    try { return { kind: 'binary', value: toBase64(head), encoding: 'base64', truncated: false, sizeBytes: size }; } catch (e) {
      return { kind: 'binary', value: null, truncated: true, sizeBytes: size };
    }
  }
  function formBody(fd) {
    var entries = [];
    fd.forEach(function (v, k) {
      if (typeof v === 'string') entries.push({ name: k, value: v });
      else entries.push({ name: k, value: null, fileName: v && v.name || null, type: v && v.type || null, sizeBytes: v && v.size != null ? v.size : null });
    });
    return { kind: 'formData', value: entries, truncated: false, sizeBytes: null };
  }
  // Request body → Promise<CapturedBody|null>. Never consumes the page's body.
  function requestBody(body, headers) {
    try {
      if (body == null) return Promise.resolve(null);
      var ct = headerValue(headers, 'content-type');
      if (typeof body === 'string') {
        if (!ct) headers['Content-Type'] = 'text/plain;charset=UTF-8';
        return Promise.resolve(textBody(body, classify(ct) === 'json' ? 'json' : 'sniff'));
      }
      if (window.URLSearchParams && body instanceof window.URLSearchParams) {
        if (!ct) headers['Content-Type'] = 'application/x-www-form-urlencoded;charset=UTF-8';
        return Promise.resolve(textBody(body.toString(), 'text'));
      }
      if (window.FormData && body instanceof window.FormData) return Promise.resolve(formBody(body));
      if (window.Blob && body instanceof window.Blob) {
        if (body.size > LIMIT) return Promise.resolve({ kind: 'binary', value: null, truncated: true, sizeBytes: body.size });
        return body.arrayBuffer().then(function (buf) { return bytesBody(new Uint8Array(buf), classify(body.type || ct), body.size); });
      }
      if (body instanceof ArrayBuffer) return Promise.resolve(bytesBody(new Uint8Array(body), classify(ct)));
      if (ArrayBuffer.isView(body)) return Promise.resolve(bytesBody(new Uint8Array(body.buffer, body.byteOffset, body.byteLength), classify(ct)));
      return Promise.resolve({ kind: 'unknown', value: 'stream or unsupported body type', truncated: false, sizeBytes: null });
    } catch (e) {
      return Promise.resolve({ kind: 'unknown', value: null, truncated: false, sizeBytes: null });
    }
  }
  // Reads at most LIMIT bytes from a cloned response, then cancels the clone.
  function readLimited(res) {
    if (!res.body || typeof res.body.getReader !== 'function') {
      return res.arrayBuffer().then(function (buf) { var u = new Uint8Array(buf); return { bytes: u, total: u.length, more: false }; });
    }
    var reader = res.body.getReader();
    var chunks = [], got = 0;
    function pump() {
      return reader.read().then(function (r) {
        if (r.done) return false;
        chunks.push(r.value);
        got += r.value.length;
        if (got > LIMIT) { try { reader.cancel(); } catch (e) { /* ignore */ } return true; }
        return pump();
      });
    }
    return pump().then(function (more) {
      var out = new Uint8Array(got), off = 0;
      chunks.forEach(function (c) { out.set(c, off); off += c.length; });
      return { bytes: out, total: more ? null : got, more: more };
    });
  }

  function start(rec) {
    inflight[rec.id] = true;
    emit({ t: 's', id: rec.id, ts: rec.ts, method: rec.method, url: rec.url, headers: rec.headers, body: rec.body, type: rec.type, page: loc.href, frame: isTop ? null : loc.href,
      added: rec.added || [], cred: !!rec.cred, ck: rec.ck || null },
      rec.body && rec.body.sizeBytes ? rec.body.sizeBytes : 512);
  }
  function end(rec, data) {
    delete inflight[rec.id];
    data.t = 'e';
    data.id = rec.id;
    data.ts = now();
    emit(data, data.body && data.body.sizeBytes ? Math.min(data.body.sizeBytes, LIMIT) : 512);
  }
  function newRecord(type, method, url, headers) {
    return { id: pageId + ':' + (++counter), ts: now(), type: type, method: String(method || 'GET').toUpperCase(), url: absolute(url), headers: headers };
  }

  // ---- fetch ----
  var origFetch = window.fetch;
  var ReqCls = window.Request;
  if (typeof origFetch === 'function') {
    var cloneResponse = window.Response && window.Response.prototype.clone;
    var cloneRequest = ReqCls && ReqCls.prototype.clone;
    var wrapped = function fetch(input, init) {
      if (!active) return origFetch.apply(this, arguments);
      var rec = null, bodyPromise = null;
      try {
        var isReq = ReqCls && input instanceof ReqCls;
        var method = (init && init.method) || (isReq ? input.method : 'GET');
        var headers = headerObject(isReq ? input.headers : null);
        var extra = headerObject(init && init.headers);
        for (var k in extra) headers[k] = extra[k];
        rec = newRecord('Fetch', method, isReq ? input.url : input, headers);
        addBrowserHeaders(rec, {
          mode: (init && init.mode) || (isReq ? input.mode : null) || 'cors',
          credentials: (init && init.credentials) || (isReq ? input.credentials : null) || 'same-origin',
          referrer: init && init.referrer != null ? String(init.referrer) : isReq ? input.referrer : null,
          policy: (init && init.referrerPolicy) || (isReq ? input.referrerPolicy : '') || '',
        });
        if (init && init.body != null) bodyPromise = requestBody(init.body, headers);
        else if (isReq && rec.method !== 'GET' && rec.method !== 'HEAD' && input.body && !input.bodyUsed) {
          var copy = cloneRequest.call(input);
          bodyPromise = copy.arrayBuffer().then(function (buf) {
            return bytesBody(new Uint8Array(buf), classify(headerValue(headers, 'content-type')));
          });
        }
      } catch (e) { rec = null; }
      var promise = origFetch.apply(this, arguments);
      if (!rec) return promise;
      var ready = (bodyPromise || Promise.resolve(null)).then(function (b) { rec.body = b; }, function () { rec.body = null; }).then(function () { start(rec); });
      promise.then(function (res) {
        var meta = { status: res.status, statusText: res.statusText || null, headers: headerObject(res.headers), mime: null, body: null, error: null };
        meta.mime = headerValue(meta.headers, 'content-type');
        var kind = classify(meta.mime);
        var readBody;
        if (res.type === 'opaque' || res.type === 'opaqueredirect') {
          readBody = Promise.resolve({ kind: 'unknown', value: 'opaque response (no-cors): not readable', truncated: false, sizeBytes: null });
        } else if (rec.method === 'HEAD' || res.status === 204 || res.status === 304 || !res.body && res.body !== undefined) {
          readBody = Promise.resolve(null);
        } else if (kind === 'stream') {
          readBody = Promise.resolve({ kind: 'unknown', value: 'streaming response (' + meta.mime + ') not captured', truncated: false, sizeBytes: null });
        } else {
          var copy;
          try { copy = cloneResponse.call(res); } catch (e) { copy = null; }
          readBody = copy ? readLimited(copy).then(function (r) {
            var total = r.total;
            if (total == null) { var cl = Number(headerValue(meta.headers, 'content-length')); total = cl > 0 ? cl : null; }
            var b = bytesBody(r.bytes, kind, total);
            if (r.more) { b.truncated = true; if (b.kind === 'json') b.kind = 'text'; }
            return b;
          }) : Promise.resolve({ kind: 'unknown', value: 'body already used', truncated: false, sizeBytes: null });
        }
        return readBody.then(function (b) { meta.body = b; }, function (err) {
          meta.body = { kind: 'unknown', value: 'body read failed: ' + (err && err.name || 'error'), truncated: false, sizeBytes: null };
        }).then(function () { return ready; }).then(function () { end(rec, meta); });
      }, function (err) {
        ready.then(function () {
          var aborted = err && err.name === 'AbortError';
          end(rec, { status: null, statusText: null, headers: {}, mime: null, body: null, error: aborted ? 'Cancelled (aborted by the page)' : String(err && err.message || err || 'Network error') });
        });
      }).catch(function () { /* recording failure never surfaces to the page */ });
      return promise;
    };
    try { window.fetch = wrapped; } catch (e) { /* non-writable fetch */ }
  }

  // ---- XMLHttpRequest ----
  var XHR = window.XMLHttpRequest;
  if (XHR && XHR.prototype) {
    var XP = XHR.prototype;
    var KEY = typeof Symbol === 'function' ? Symbol('ni') : '__ni';
    var oOpen = XP.open, oSend = XP.send, oSet = XP.setRequestHeader;
    XP.open = function (method, url) {
      try { this[KEY] = { method: method, url: url, headers: {}, fail: null }; } catch (e) { /* ignore */ }
      return oOpen.apply(this, arguments);
    };
    XP.setRequestHeader = function (name, value) {
      try {
        var s = this[KEY];
        if (s) { var k = String(name); s.headers[k] = s.headers[k] ? s.headers[k] + ', ' + String(value) : String(value); }
      } catch (e) { /* ignore */ }
      return oSet.apply(this, arguments);
    };
    XP.send = function (body) {
      var xhr = this, s = this[KEY];
      if (s && active) {
        try {
          var rec = newRecord('XHR', s.method, s.url, s.headers);
          addBrowserHeaders(rec, { mode: 'cors', credentials: xhr.withCredentials ? 'include' : 'same-origin' });
          var ready = requestBody(body, rec.headers).then(function (b) { rec.body = b; }, function () { rec.body = null; }).then(function () { start(rec); });
          var markFail = function (msg) { return function () { s.fail = msg; }; };
          xhr.addEventListener('error', markFail('Network error'));
          xhr.addEventListener('abort', markFail('Cancelled (aborted by the page)'));
          xhr.addEventListener('timeout', markFail('Timed out'));
          xhr.addEventListener('loadend', function () {
            var meta;
            try {
              if (s.fail) {
                meta = { status: null, statusText: null, headers: {}, mime: null, body: null, error: s.fail };
              } else {
                var headers = parseRawHeaders(xhr.getAllResponseHeaders());
                var mime = headerValue(headers, 'content-type');
                meta = { status: xhr.status, statusText: xhr.statusText || null, headers: headers, mime: mime, body: null, error: null };
                var rt = xhr.responseType;
                var kind = classify(mime);
                if (rec.method === 'HEAD' || xhr.status === 204 || xhr.status === 304) meta.body = null;
                else if (rt === '' || rt === 'text') meta.body = textBody(String(xhr.responseText || ''), kind === 'binary' ? 'sniff' : kind);
                else if (rt === 'json') meta.body = xhr.response == null ? null : textBody(stringify(xhr.response), 'json');
                else if (rt === 'arraybuffer' && xhr.response) meta.body = bytesBody(new Uint8Array(xhr.response), kind);
                else if (rt === 'blob' && xhr.response) {
                  var blob = xhr.response;
                  var p = blob.size > LIMIT ? Promise.resolve({ kind: 'binary', value: null, truncated: true, sizeBytes: blob.size })
                    : blob.arrayBuffer().then(function (buf) { return bytesBody(new Uint8Array(buf), classify(blob.type || mime), blob.size); });
                  p.then(function (b) { meta.body = b; }, function () { meta.body = null; }).then(function () { return ready; }).then(function () { end(rec, meta); });
                  return;
                } else meta.body = { kind: 'unknown', value: 'responseType ' + rt + ' not captured', truncated: false, sizeBytes: null };
              }
            } catch (e) {
              meta = meta || { status: null, statusText: null, headers: {}, mime: null, body: null, error: 'Capture failed' };
            }
            ready.then(function () { end(rec, meta); });
          });
        } catch (e) { /* never break the page's request */ }
      }
      return oSend.apply(this, arguments);
    };
  }

  // ---- sendBeacon (fire-and-forget: the response is never observable) ----
  var nav = window.navigator;
  if (nav && typeof nav.sendBeacon === 'function') {
    var oBeacon = nav.sendBeacon;
    try {
      nav.sendBeacon = function (url, data) {
        var queued = oBeacon.apply(nav, arguments);
        if (active) {
          try {
            var rec = newRecord('Beacon', 'POST', url, {});
            addBrowserHeaders(rec, { mode: 'no-cors', credentials: 'include' });
            requestBody(data, rec.headers).then(function (b) { rec.body = b; }, function () { rec.body = null; }).then(function () {
              start(rec);
              end(rec, { status: null, statusText: null, headers: {}, mime: null, body: null, error: queued ? null : 'Beacon was not queued', beacon: true });
            });
          } catch (e) { /* ignore */ }
        }
        return queued;
      };
    } catch (e) { /* read-only navigator */ }
  }

  // Leaving the page: report what never finished, then send the batch now.
  window.addEventListener('pagehide', function () {
    var ids = Object.keys(inflight);
    if (ids.length) queue.push({ t: 'u', ids: ids, ts: now() });
    flush();
  });
})(window);
`;

/** The script with [config] baked in. */
export function buildCaptureScript(config: CaptureScriptConfig): string {
  const json = JSON.stringify({
    token: config.token,
    rules: config.rules.map(r => ({
      host: r.host,
      includeSubdomains: r.includeSubdomains,
    })),
    bodyLimitBytes: Math.max(1024, Math.floor(config.bodyLimitBytes)),
    pageCookies: config.pageCookies === true,
  })
    // Safe inside a <script>-like context and a JS string.
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
  return SCRIPT.replace('__CONFIG__', json);
}

/** Main-frame snippet that pauses/resumes reading bodies in the page. */
export function setActiveSnippet(on: boolean): string {
  return `try{window.__aksharNetInspectorSetActive&&window.__aksharNetInspectorSetActive(${
    on ? 'true' : 'false'
  })}catch(e){}true;`;
}
