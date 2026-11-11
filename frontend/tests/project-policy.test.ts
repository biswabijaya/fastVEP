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
test("run fees retain the base charge and round only the variable charge", () => {
  assert.equal(projectRunCharge(1), 151);
  assert.equal(projectRunCharge(100), 151);
  assert.equal(projectRunCharge(101), 152);
  assert.equal(projectRunCharge(1000), 160);
  assert.equal(projectRunCharge(100000), 1150);
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
