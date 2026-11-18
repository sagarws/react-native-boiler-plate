const test = require("node:test");
const assert = require("node:assert");

const {
    toListRow,
    downloadUrl,
    isReady,
    reportConfig,
} = require("../platforms/flipkart/master-import/api-based-flow/apiReportFlow");

// Shapes from a real Report Centre capture.
const RAW = {
    request_id: "e4a7e2dc-dd5f-46fd-9ca4-85c62aae34a0",
    report_name: "Orders",
    created_at: 1791553720000,
    status: "FILE_STORED",
    filters: [
        { name: "date", value: ["2026-06-01", "2026-06-30"], operator: "RANGE" },
        { name: "seller_id", value: ["2cef4c459111461f"], operator: "EQ" },
    ],
};

test("a list row keeps its id, window and seller", () => {
    const row = toListRow(RAW);
    assert.strictEqual(row.requestId, RAW.request_id);
    assert.strictEqual(row.from, "2026-06-01");
    assert.strictEqual(row.to, "2026-06-30");
    assert.strictEqual(row.sellerId, "2cef4c459111461f");
    assert.ok(isReady(row));
    assert.ok(!isReady(toListRow({ ...RAW, status: "QUERY_SUBMITTED" })));
});

test("the download URL is the one the portal links to", () => {
    const row = toListRow(RAW);
    assert.strictEqual(
        downloadUrl(row, row.sellerId),
        "https://seller.flipkart.com/napi/metrics/bizReport/downloadReport/" +
            "e4a7e2dc-dd5f-46fd-9ca4-85c62aae34a0_1791553720000.xlsx" +
            "?token=e4a7e2dc-dd5f-46fd-9ca4-85c62aae34a0&sellerId=2cef4c459111461f"
    );
});

test("the two reports map to the portal's names", () => {
    assert.strictEqual(reportConfig("forward").reportName, "Orders");
    assert.strictEqual(reportConfig("return").reportName, "Returns");
    assert.throws(() => reportConfig("other"));
});
