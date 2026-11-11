import test from "node:test";
import assert from "node:assert/strict";
import { byteBlocks, fileCharge, projectRunCharge, enforceFreeByteLimit, projectDetails, PROJECT_RATES } from "../src/lib/project-policy";
test("file billing rounds decimal byte blocks and aggregates retained storage", () => {
  assert.equal(byteBlocks(0), 0);
  assert.equal(fileCharge(100_000_000, "upload"), 1);
  assert.equal(fileCharge(100_000_001, "upload"), 2);
  assert.equal(fileCharge(150_000_000, "deletion"), 2);
  assert.equal(fileCharge(150_000_000 + 100_000_000 + 50_000_000, "storageMonthly"), 15);
  assert.equal(fileCharge(50_000_000, "download"), 40);
  for (const bytes of [-1, NaN, Infinity, 1.5, Number.MAX_SAFE_INTEGER + 1])
    assert.throws(() => byteBlocks(bytes), /Invalid file size/);
});
test("annual credit revenue covers common and higher priced downloads at over 80 percent margin", () => {
  const annualCreditRevenue = 10 / 12 / 200;
  const blockGiB = 100_000_000 / 1024 ** 3;
  for (const destinationRate of [0.12, 0.19, 0.23])
    assert.ok(1 - blockGiB * destinationRate / (PROJECT_RATES.download * annualCreditRevenue) >= 0.8);
  assert.ok(1 - blockGiB * 0.02 / (PROJECT_RATES.storageMonthly * annualCreditRevenue) >= 0.9);
});
test("run fees have no base charge and round up per 5,000 alternate alleles", () => {
  for (const [variants, charge] of [[1, 1], [1000, 1], [5000, 1], [5001, 2], [100000, 20], [1000000, 200]])
    assert.equal(projectRunCharge(variants), charge);
  assert.throws(() => projectRunCharge(0));
});
test("free byte allowances cannot be exceeded with partial or oversized transfers", () => {
  assert.doesNotThrow(() => enforceFreeByteLimit(50_000_000, 50_000_000, 100_000_000));
  assert.throws(() => enforceFreeByteLimit(50_000_000, 50_000_001, 100_000_000), /allowance/);
  assert.throws(() => enforceFreeByteLimit(0, 100_000_001, 100_000_000), /allowance/);
  assert.throws(() => enforceFreeByteLimit(-1, 1, 100_000_000));
});
test("project metadata is bounded and normalized", () => {
  assert.deepEqual(projectDetails({ name: "  Study A  " }), { name: "Study A", description: "" });
  for (const input of [null, [], {}, { name: " " }, { name: "a".repeat(101) }, { name: "A", description: "a".repeat(1001) }])
    assert.throws(() => projectDetails(input));
});

test("free projects expire exactly at the next UTC month boundary", async () => {
  const { freeProjectExpiry, projectExpiry, FREE_PROJECT_LIMITS } = await import("../src/lib/project-policy");
  assert.equal(freeProjectExpiry(Date.UTC(2026, 10, 1)), Date.UTC(2026, 11, 1));
  assert.equal(freeProjectExpiry(Date.UTC(2026, 10, 30, 23, 59, 59)), Date.UTC(2026, 11, 1));
  assert.equal(freeProjectExpiry(Date.UTC(2026, 11, 31)), Date.UTC(2027, 0, 1));
  assert.equal(freeProjectExpiry(Date.UTC(2028, 1, 29)), Date.UTC(2028, 2, 1));
  const legacy = { createdAt: Date.UTC(2026, 10, 3) };
  assert.equal(projectExpiry(legacy, true), Date.UTC(2026, 11, 1));
  assert.equal(projectExpiry({ ...legacy, expiresAt: null }, true), null);
  assert.equal(FREE_PROJECT_LIMITS.uploadFileBytes, 100_000_000);
});
