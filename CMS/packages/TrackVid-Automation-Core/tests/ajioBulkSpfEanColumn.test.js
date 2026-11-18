const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");

/**
 * A sheet that names its articles under a bare "EAN" column.
 *
 * One row per article, three articles on one return. Read without `eanAsSku`
 * there is no SKU column, rows de-duplicate on the return number, and the three
 * become one — which AJIO then refused as ambiguous, the other two never
 * appearing anywhere. The option is opt-in, so both halves are pinned: passing
 * nothing must read exactly as before (the server narrows master data by seller
 * SKU, which an EAN never equals).
 */

const { readRows } = require("../platforms/ajio/claim-management/api-based-flow/bulkSpfExcel");

const writeSheet = (rows) => {
    const XLSX = require("xlsx");
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "bulk-ean-")), "sheet.xlsx");
    const workbook = XLSX.utils.book_new();

    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), "Sheet1");
    XLSX.writeFile(workbook, file);

    return file;
};

const sheet = () =>
    writeSheet([
        ["RETURN ORDER NUMBER", "EAN", "POB ID"],
        ["RT1", "8900000000001", "DV1"],
        ["RT1", "8900000000002", "DV1"],
        ["RT1", "8900000000003", "DV1"],
        ["RT2", "8900000000004", "DV2"],
        ["RT2", "8900000000004", "DV2"],
    ]);

test("eanAsSku reads one row per article, still de-duplicating a repeated article", () => {
    const { rows, skuHeader } = readRows(sheet(), { claimType: "NDR", eanAsSku: true });

    assert.equal(skuHeader, "EAN");
    assert.deepEqual(
        rows.map((row) => `${row.ron}/${row.sku}/${row.pobid}`),
        ["RT1/8900000000001/DV1", "RT1/8900000000002/DV1", "RT1/8900000000003/DV1", "RT2/8900000000004/DV2"]
    );
});

test("without eanAsSku the reader is unchanged — EAN is not a SKU column", () => {
    const { rows, skuHeader } = readRows(sheet(), { claimType: "NDR" });

    assert.equal(skuHeader, null);
    assert.deepEqual(rows.map((row) => `${row.ron}/${row.sku}`), ["RT1/", "RT2/"]);
});

test("a real SKU column still wins over EAN", () => {
    const file = writeSheet([
        ["Return Order No", "EAN", "Seller SKU"],
        ["RT1", "8900000000001", "SKU-A"],
    ]);

    assert.equal(readRows(file, { eanAsSku: true }).skuHeader, "Seller SKU");
});

test("a header merely containing the letters 'ean' is not an EAN column", () => {
    const file = writeSheet([
        ["Return Order No", "Clean Remarks"],
        ["RT1", "x"],
    ]);

    assert.equal(readRows(file, { eanAsSku: true }).skuHeader, null);
});

test("every row read but not returned comes back in `dropped`, with its sheet row and why", () => {
    const file = writeSheet([
        ["Return Order No", "Seller SKU", "POB ID"],
        ["RT1", "A", "DV1"],
        ["RT1", "A", "DV1"],
        ["", "B", "DV1"],
        ["", "", ""],
        ["RT2", "C", "DV2"],
    ]);
    const { rows, dropped } = readRows(file, { claimType: "DDR" });

    assert.deepEqual(rows.map((row) => row.id), ["RT1", "RT2"]);
    assert.deepEqual(
        dropped.map(({ rowNumber, id, sku, kind, claimType }) => ({ rowNumber, id, sku, kind, claimType })),
        [
            { rowNumber: 3, id: "RT1", sku: "A", kind: "duplicate", claimType: "DDR" },
            { rowNumber: 4, id: "", sku: "B", kind: "noId", claimType: "DDR" },
        ]
    );
    assert.match(dropped[0].reason, /sheet row 2/);
    assert.match(dropped[1].reason, /sheet row 4/);
});
