/**
 * String normalisers shared by every platform's session store and claim flow.
 *
 * Each of these existed as a per-platform copy that differed only in line
 * wrapping or a lambda parameter name.
 */

/** Credential usernames are matched case-insensitively and trimmed. */
function normalizeUsername(value) {
	return value ? String(value).toLowerCase().trim() : "";
}

/** Loose comparison key: lowercase, non-alphanumerics collapsed to single spaces. */
function normalizeLoose(value) {
	return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/** Escape a value for safe interpolation into a RegExp. */
function escapeRegex(value) {
	return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

module.exports = { normalizeUsername, normalizeLoose, escapeRegex };
