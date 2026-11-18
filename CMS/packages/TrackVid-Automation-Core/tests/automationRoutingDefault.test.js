const test = require("node:test");
const assert = require("node:assert");

const { DEFAULT_API_FLOW, useApiBasedFlow } = require("../common/automationRouting");

// No company id means no settings read, so these exercise the env + default
// tiers alone. Trackvid-CMS holds a copy of DEFAULT_API_FLOW and compares it
// against this file's source.

test("an unconfigured company runs AJIO on the API flow", async () => {
	assert.strictEqual(await useApiBasedFlow(undefined, "ajio", "masterImport"), true);
	assert.strictEqual(await useApiBasedFlow(undefined, "AJIO", "claim"), true);
});

test("every other platform defaults to the script flow", async () => {
	const saved = process.env.SNAPDEAL_APIBASE_AUTOMATION;
	delete process.env.SNAPDEAL_APIBASE_AUTOMATION;

	try {
		assert.strictEqual(await useApiBasedFlow(undefined, "snapdeal", "masterImport"), false);
	} finally {
		if (saved !== undefined) process.env.SNAPDEAL_APIBASE_AUTOMATION = saved;
	}

	assert.deepStrictEqual(
		Object.keys(DEFAULT_API_FLOW).filter((platform) => DEFAULT_API_FLOW[platform]),
		["ajio"]
	);
});

test("an explicit fallback still wins over the platform default", async () => {
	assert.strictEqual(await useApiBasedFlow(undefined, "ajio", "claim", false), false);
});
