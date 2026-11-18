// AJIO — the non-cookie half of a captured session.
//
// AJIO's ingest endpoint rejects a jar on its own. It also needs:
//
//   userId   the seller's activeSellerProfileId. Every AJIO API URL is built
//            around it (/sellers/<userId>/...), so a session without it cannot
//            make a single call.
//   pobIds   the seller's places of business. The download API needs at least
//            one, and a seller can have many.
//
// Neither is a cookie. `userId` lives in localStorage and `pobIds` comes from
// an authenticated API call, so both have to be read from inside a signed-in
// page — which is why this is a script rather than a function.
//
// Logic mirrors getUserId + getPobIds in
// ../master-import/api-based-flow/apiReportFlow.js, which is the authority and
// is what the server uses through Puppeteer's page.evaluate. Expressed as a
// string here because Trackvid-CMS has no Puppeteer: it evaluates this in an
// Electron BrowserWindow via webContents.executeJavaScript, which resolves a
// returned Promise the same way page.evaluate does.
//
// See common/sessionExtras.js for the contract.

const PAGE_SCRIPT = `(async () => {
  const GUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // The SPA hydrates localStorage a beat after the SSO callback, so this polls
  // rather than reading once. Same reason the server polls.
  const readUserId = () => {
    try {
      const direct = localStorage.getItem("activeSellerProfileId");
      if (direct && GUID.test(direct)) return direct.match(GUID)[0];
      const blobs = [];
      for (let i = 0; i < localStorage.length; i++) blobs.push(localStorage.getItem(localStorage.key(i)));
      for (let i = 0; i < sessionStorage.length; i++) blobs.push(sessionStorage.getItem(sessionStorage.key(i)));
      for (const b of blobs) { const m = (b || "").match(GUID); if (m) return m[0]; }
    } catch (e) { /* storage can be blocked mid-navigation */ }
    return null;
  };

  let userId = null;
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    userId = readUserId();
    if (userId) break;
    await sleep(500);
  }
  if (!userId) return { error: "activeSellerProfileId never appeared in browser storage" };

  // Places of business, paged. Guarded against runaway pagination.
  const all = [];
  let pageNum = 0;
  const size = 100;
  for (let guard = 0; guard < 20; guard++) {
    const url = "/malekith/nickfury/v1/sellers/" + userId + "/work-places?workPlaceType=POB&page=" + pageNum + "&size=" + size;
    let status = -1, text = "";
    try {
      const r = await fetch(url, { headers: { Accept: "application/json", "X-Tenant": "AJIO" } });
      status = r.status;
      text = (await r.text()).slice(0, 500000);
    } catch (e) {
      status = -1; text = String(e);
    }
    if (status < 200 || status >= 300) {
      if (pageNum === 0) return { userId, error: "work-places API failed: status=" + status + " body=" + text.slice(0, 200) };
      break;
    }
    let json;
    try { json = JSON.parse(text); }
    catch (e) { return { userId, error: "work-places API returned non-JSON: " + text.slice(0, 200) }; }
    const content = json.content || [];
    for (const c of content) if (c && c.id) all.push({ id: c.id, storeName: c.storeName });
    if (json.last === true || content.length < size || json.totalPages == null || pageNum >= json.totalPages - 1) break;
    pageNum++;
  }

  if (all.length === 0) return { userId, error: "the seller has no places of business" };

  return { userId, pobIds: all.map((s) => s.id), stores: all };
})()`;

module.exports = {
    platform: "ajio",
    /** Both fields are rejected by the ingest endpoint if absent, so both are required. */
    required: ["userId", "pobIds"],
    pageScript: PAGE_SCRIPT,
};

// -----------------------------------------------------------------------------
// The same two reads, as SHORT single-shot expressions
// -----------------------------------------------------------------------------
// PAGE_SCRIPT above polls for twenty seconds inside the page, which is fine for
// a caller holding a page that is standing still — the desktop app's manual
// sign-in window, where the operator has finished and nothing is navigating.
//
// It is wrong straight after a scripted sign-in. AJIO's login ends on an OAuth
// callback that begins the portal's own redirect chain, so a twenty-second read
// issued there is near-certain to be destroyed mid-flight and lose everything.
//
// These do one thing each and return immediately, so a caller can poll them
// from outside the browser and lose only a single unlucky attempt to a
// redirect. See common/pageEval.js.
// -----------------------------------------------------------------------------

/** The seller's activeSellerProfileId, or null if the SPA has not stored it yet. */
const USER_ID_EXPRESSION = `(function () {
  var GUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
  try {
    var direct = localStorage.getItem("activeSellerProfileId");
    if (direct && GUID.test(direct)) return direct.match(GUID)[0];
    var blobs = [];
    for (var i = 0; i < localStorage.length; i++) blobs.push(localStorage.getItem(localStorage.key(i)));
    for (var j = 0; j < sessionStorage.length; j++) blobs.push(sessionStorage.getItem(sessionStorage.key(j)));
    for (var k = 0; k < blobs.length; k++) {
      var m = (blobs[k] || "").match(GUID);
      if (m) return m[0];
    }
  } catch (e) { /* storage can be blocked mid-navigation */ }
  return null;
})()`;

/**
 * One page of the seller's places of business.
 *
 * Paged by the caller rather than looped in-page, for the same reason: a loop
 * here is a long read, and a long read is what the redirect chain destroys.
 */
function pobPageExpression(userId, pageNum = 0, size = 100) {
    const url = `/malekith/nickfury/v1/sellers/${userId}/work-places?workPlaceType=POB&page=${pageNum}&size=${size}`;
    return `(async function () {
  try {
    var r = await fetch(${JSON.stringify(url)}, { headers: { Accept: "application/json", "X-Tenant": "AJIO" } });
    var text = (await r.text()).slice(0, 500000);
    return { status: r.status, text: text };
  } catch (e) {
    return { status: -1, text: String(e) };
  }
})()`;
}

module.exports.USER_ID_EXPRESSION = USER_ID_EXPRESSION;
module.exports.pobPageExpression = pobPageExpression;
module.exports.POB_PAGE_SIZE = 100;
