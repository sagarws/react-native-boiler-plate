const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");

/**
 * The `email` field the master-import upload carries.
 *
 * THE FAILURE THIS PINS, from company 6911721d983e9cc5799ba7a6 on 2026-09-24.
 * An AJIO master import fetched its whole report — 209 KB of it, several
 * minutes of portal work — and then died on the upload with nothing but:
 *
 *     Request failed with status code 400
 *
 * The field is the credential's own portal login, sent so each imported row
 * can be tagged with the seller account it came from (`ajio_account_email`).
 * The backend validates it with `Joi.string().email()`, and Joi does not trim.
 * The stored login was "seller123@example.com " — with ONE TRAILING SPACE,
 * typed into the credential form at some point and never noticed — so the
 * request was rejected with `"email" must be a valid email` before the file
 * was looked at.
 *
 * WHY IT READ AS A BACKEND FAULT. Of the 396 stored AJIO logins, 392 are clean
 * and 4 carry whitespace. The same code path worked all day and failed for a
 * handful of accounts, and `importMasterData` logged only `error.message` —
 * never `error.response.data` — so the server's actual sentence never reached
 * a log. Four different 400s share that one message, and picking between them
 * meant reading the backend's source.
 *
 * Both uploaders are covered, because both had the identical line.
 */

const UPLOADERS = [
    ["ajio", "platforms/ajio/master-import/api-based-flow/trackvidFunctions.js"],
    ["meesho", "platforms/meesho/master-import/api-based-flow/trackvidFunctions.js"],
];

/**
 * The backend's rule, restated: Joi's `email()` with no `trim()`.
 *
 * Joi lives in TrackVid-BE, not here, so the constraint is re-expressed rather
 * than imported. Verified against the real schema — `"a@b.com "` and
 * `" a@b.com"` are both rejected, `""` is allowed.
 */
const passesBackendValidation = (value) =>
    value === "" || /^[^@\s]+@[^@\s]+\.[A-Za-z]{2,}$/.test(value);

/**
 * Reports are left for the process to clean up rather than deleted inline.
 *
 * `fs.createReadStream` opens on a LATER TICK, so removing the file in the
 * same tick as the call raced the open and surfaced as an ENOENT attributed to
 * whichever test had already finished.
 */
const reports = [];

process.on("exit", () => {
    for (const file of reports) fs.rmSync(file, { force: true });
});

/** Runs an uploader with its whole outside world stubbed, returning the form. */
const upload = async (file, username) => {
    const full = path.resolve(__dirname, "..", file);
    const appended = [];

    const seed = (id, exports) => {
        const resolved = require.resolve(id, { paths: [path.dirname(full)] });

        require.cache[resolved] = {
            id: resolved,
            filename: resolved,
            loaded: true,
            exports,
            children: [],
            paths: [],
        };
    };

    // A FormData that records rather than encodes — what is asserted is the
    // value handed to the field, which is the thing that was wrong.
    seed("form-data", class {
        append(name, value) {
            /*
             * The report is handed over as a read stream that OPENS ON A LATER
             * TICK, and the upload unlinks the file as soon as it succeeds. So
             * the open lands after the file is gone and raises an ENOENT with
             * no listener — reported against whichever test had already
             * finished. Closing it here is the only reachable handle: the real
             * axios would have consumed it, and this stub never does.
             */
            if (value && typeof value.destroy === "function") {
                value.on("error", () => {});
                value.destroy();
                appended.push([name, "<stream>"]);

                return;
            }

            appended.push([name, value]);
        }
        getHeaders() {
            return { "content-type": "multipart/form-data; boundary=x" };
        }
    });

    // `get` is the TrackVid profile lookup that runs first; `post` is the
    // upload itself. Both answer successfully so the run reaches the field.
    seed("axios", {
        get: async () => ({ data: { isSuccess: true, data: { accessToken: "t" } } }),
        post: async () => ({ data: { isSuccess: true, data: {} }, status: 200 }),
    });

    // Both uploaders sit four levels below the root, so this one relative
    // specifier resolves for each of them.
    seed("../../../../common/logger", { info() {}, warn() {}, error() {}, debug() {} });

    delete require.cache[require.resolve(full)];

    const mod = require(full);

    // A real file, because a successful upload unlinks the report. Without it
    // the run throws after the append and the assertions would be reading a
    // form the code never finished building.
    const report = path.join(
        os.tmpdir(),
        `master-import-email-${process.pid}-${reports.length}.xlsx`
    );

    fs.writeFileSync(report, "");
    reports.push(report);

    await mod.importMasterDataToTrackVid("Dropship Order Report", report, {
        trackVidEmail: "admin@trackvid.in",
        plateForm: "AJIO",
        username,
    }).catch(() => {});

    delete require.cache[require.resolve(full)];

    return Object.fromEntries(appended);
};

for (const [platform, file] of UPLOADERS) {
    test(`${platform}: sends a login with a trailing space as a valid email`, async () => {
        /*
         * THE EXACT CASE. Before the fix this sent "seller123@example.com "
         * and the backend answered 400 after the report had already been
         * fetched — the most expensive moment in the run to fail at.
         */
        const form = await upload(file, "seller123@example.com ");

        assert.equal(form.email, "seller123@example.com");
        assert.ok(
            passesBackendValidation(form.email),
            `the backend rejects ${JSON.stringify(form.email)} with "email" must be a valid email`
        );
    });

    test(`${platform}: leaves an already-clean login alone`, async () => {
        // The 392 that always worked must keep working — this is a repair, not
        // a rewrite of the field.
        const form = await upload(file, "seller123@example.com");

        assert.equal(form.email, "seller123@example.com");
    });

    test(`${platform}: sends nothing rather than the word "undefined"`, async () => {
        /*
         * A credential with no username at all appended the STRING "undefined",
         * which fails the same validation and reads in a log as though a value
         * was present. Empty is allowed by the schema and the backend drops the
         * tag, which is the honest outcome.
         */
        const form = await upload(file, undefined);

        assert.equal(form.email, "");
        assert.ok(passesBackendValidation(form.email));
    });
}

test("the backend rule this is checked against is the real one", () => {
    // Guards the restatement above: if these stop matching Joi's behaviour the
    // tests are measuring the wrong thing. Confirmed against the live schema.
    assert.equal(passesBackendValidation("a@b.com "), false);
    assert.equal(passesBackendValidation(" a@b.com"), false);
    assert.equal(passesBackendValidation("a@b.com"), true);
    assert.equal(passesBackendValidation(""), true);
});
