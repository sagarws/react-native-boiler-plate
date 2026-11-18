// -----------------------------------------------------------------------------
// Resource Saver — mirror every file automation uploads/imports to disk
// -----------------------------------------------------------------------------
// Gated by SAVE_RESOURCE=true. When enabled, every file the scripts are about
// to hand to a marketplace (claim evidence, shipping labels) OR ingest from a
// marketplace report download is copied into a browseable tree so ops can
// inspect exactly what a batch sent/received without pulling logs.
//
// Layout:
//   resource/Reports/{CompanyName}/{YYYY-MM-DD}/{AWBNumber}/{filename}
//     — one per-AWB folder for claim uploads
//   resource/Reports/{CompanyName}/{YYYY-MM-DD}/{Return|Forward}/{filename}
//     — one Return/Forward folder per master-data report
//
// Contract: best-effort. A save failure MUST NOT fail the batch it runs
// beside, so every public call swallows its own errors and logs a warning.
// -----------------------------------------------------------------------------

const fs = require("fs-extra");
const path = require("path");

const { connectDB } = require("./db.js");

const COMPANIES_COLLECTION = "companies";
const ROOT_DIR = path.resolve(__dirname, "..", "..", "resource", "Reports");

// companyId → resolved label, so a batch of 200 AWBs makes ONE DB round trip.
const companyLabelCache = new Map();

function isEnabled() {
    return String(process.env.SAVE_RESOURCE || "").toLowerCase() === "true";
}

// Replace characters that either can't appear in a path component on macOS/Linux
// or that would trip up shell tools ops uses to browse the tree.
function sanitizePathSegment(value, fallback = "unknown") {
    const s = String(value == null ? "" : value).trim();
    if (!s) return fallback;
    return s
        .replace(/[\\/:*?"<>|\x00-\x1f]/g, "_")
        .replace(/\s+/g, " ")
        .slice(0, 120) || fallback;
}

// Filename variant of the sanitiser: does the same character-scrubbing but
// truncates the STEM only, keeping the extension intact. S3 keys like
// "…-screenshot-3.png" are long enough (>120 chars) that a naive slice chops
// the ".png" off the end, so macOS/Finder no longer recognises the file type
// and previews it as "unsupported". Cap the extension itself too so a
// pathological ".mp4-something-huge" can't dodge the length budget.
function sanitizeFilename(value, fallback = "file") {
    const cleaned = String(value == null ? "" : value)
        .trim()
        .replace(/[\\/:*?"<>|\x00-\x1f]/g, "_")
        .replace(/\s+/g, " ");
    if (!cleaned) return fallback;

    const parsed = path.parse(cleaned);
    // path.parse treats a leading-dot name as extensionless (e.g. ".env" → ext="");
    // fine, we just cap the whole string in that case.
    const ext = parsed.ext.slice(0, 16);
    const stemBudget = 120 - ext.length;
    const stem = (parsed.name || fallback).slice(0, Math.max(1, stemBudget));
    return `${stem}${ext}` || fallback;
}

function toObjectIdOrNull(value) {
    if (!value) return null;
    // Required here, not at module scope: a consumer without the driver must
    // still be able to import this module. See CLAUDE.md.
    const { ObjectId } = require("mongodb");
    if (value instanceof ObjectId) return value;
    try {
        return new ObjectId(String(value));
    } catch (_) {
        return null;
    }
}

// Local YYYY-MM-DD — matches how ops describes "today's batch" in the run log,
// so the folder date lines up with the log lines they're cross-referencing.
function todayLocalDate() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
}

// Resolve a filesystem-safe company label. Prefers an explicit companyName the
// caller already has (avoids the DB round trip); otherwise looks up the
// companies collection by companyId, once per process.
async function resolveCompanyLabel({ companyId, companyName } = {}) {
    if (companyName && String(companyName).trim()) {
        return sanitizePathSegment(companyName, "unknown-company");
    }

    const key = companyId ? String(companyId) : null;
    if (!key) return "unknown-company";

    if (companyLabelCache.has(key)) return companyLabelCache.get(key);

    let label = `company_${key.slice(-6)}`;
    try {
        const oid = toObjectIdOrNull(key);
        if (oid) {
            const client = await connectDB();
            const doc = await client
                .db(process.env.DB_NAME)
                .collection(COMPANIES_COLLECTION)
                .findOne({ _id: oid }, { projection: { name: 1 } });
            if (doc?.name) label = sanitizePathSegment(doc.name, label);
        }
    } catch (err) {
        console.warn(`⚠️ [resourceSaver] company name lookup failed for ${key}: ${err.message}`);
    }
    companyLabelCache.set(key, label);
    return label;
}

// Copy `srcPath` to `destPath`, creating the parent directory. Existing target
// with the same basename is suffixed with a counter so the second attachment of
// the same name in one AWB doesn't clobber the first.
async function copyWithoutOverwrite(srcPath, destDir, filename) {
    await fs.ensureDir(destDir);
    const parsed = path.parse(filename);
    let candidate = path.join(destDir, filename);
    let i = 1;
    while (await fs.pathExists(candidate)) {
        candidate = path.join(destDir, `${parsed.name}_${i}${parsed.ext}`);
        i++;
    }
    await fs.copy(srcPath, candidate, { overwrite: false, errorOnExist: true });
    return candidate;
}

// -----------------------------------------------------------------------------
// Public — claim file (per AWB)
// -----------------------------------------------------------------------------
// srcPath      absolute path to the file already sitting in a temp dir
// companyId    Mongo _id (string or ObjectId) — used to look up company name
// companyName  optional; overrides companyId lookup when caller already has it
// awbNumber    per-AWB folder name
// filename     optional override; defaults to path.basename(srcPath)
async function saveClaimResource({ srcPath, companyId, companyName, awbNumber, filename } = {}) {
    if (!isEnabled() || !srcPath) return null;
    try {
        if (!await fs.pathExists(srcPath)) return null;
        const company = await resolveCompanyLabel({ companyId, companyName });
        const date = todayLocalDate();
        const awb = sanitizePathSegment(awbNumber, "unknown-awb");
        const name = sanitizeFilename(filename || path.basename(srcPath), "file");
        const destDir = path.join(ROOT_DIR, company, date, awb);
        const saved = await copyWithoutOverwrite(srcPath, destDir, name);
        console.log(`    💾 [SAVE_RESOURCE] ${company}/${date}/${awb}/${path.basename(saved)}`);
        return saved;
    } catch (err) {
        console.warn(`⚠️ [SAVE_RESOURCE] claim save failed (${awbNumber}): ${err.message}`);
        return null;
    }
}

// -----------------------------------------------------------------------------
// Public — master-data report file
// -----------------------------------------------------------------------------
// direction    "Return" | "Forward" — falls back to "Other" for anything else
// filename     optional override; defaults to path.basename(srcPath)
async function saveReportResource({ srcPath, companyId, companyName, direction, filename } = {}) {
    if (!isEnabled() || !srcPath) return null;
    try {
        if (!await fs.pathExists(srcPath)) return null;
        const company = await resolveCompanyLabel({ companyId, companyName });
        const date = todayLocalDate();
        const dir = normalizeDirection(direction);
        const name = sanitizeFilename(filename || path.basename(srcPath), "report");
        const destDir = path.join(ROOT_DIR, company, date, dir);
        const saved = await copyWithoutOverwrite(srcPath, destDir, name);
        console.log(`    💾 [SAVE_RESOURCE] ${company}/${date}/${dir}/${path.basename(saved)}`);
        return saved;
    } catch (err) {
        console.warn(`⚠️ [SAVE_RESOURCE] report save failed (${filename || srcPath}): ${err.message}`);
        return null;
    }
}

function normalizeDirection(direction) {
    const d = String(direction || "").trim().toLowerCase();
    if (["return", "returns", "reverse", "rev"].includes(d)) return "Return";
    if (["forward", "forwards", "fwd", "outward"].includes(d)) return "Forward";
    return sanitizePathSegment(direction, "Other");
}

module.exports = {
    isEnabled,
    saveClaimResource,
    saveReportResource,
    resolveCompanyLabel,
    // exported for tests / callers that need to build paths manually
    _internals: { sanitizePathSegment, sanitizeFilename, todayLocalDate, ROOT_DIR },
};
