import test from "node:test";
import assert from "node:assert/strict";
import {
  signature,
  verifySignature,
  parseFields,
  capturedPayment,
} from "../src/server/aps";
test("APS signs sorted fields and detects tampering without trusting redirect status", () => {
  const fields = {
    merchant_reference: "test",
    amount: "2000",
    currency: "USD",
  };
  const signed = {
    ...fields,
    signature: signature(fields, "test-only-phrase"),
  };
  assert.equal(verifySignature(signed, "test-only-phrase"), true);
  assert.equal(
    signature({ ...fields, currency: "USD" }, "test-only-phrase"),
    signature(
      { currency: "USD", amount: "2000", merchant_reference: "test" },
      "test-only-phrase",
    ),
  );
  assert.equal(
    verifySignature({ ...signed, amount: "1" }, "test-only-phrase"),
    false,
  );
  assert.equal(
    verifySignature({ ...signed, signature: "xyz" }, "test-only-phrase"),
    false,
  );
  assert.equal(verifySignature(signed, "wrong-phrase"), false);
});
test("only an exact captured amount with no refunds qualifies", () => {
  const fields = {
    response_code: "12000",
    transaction_code: "14000",
    captured_amount: "2000",
    refunded_amount: "0",
    fort_id: "123",
  };
  assert.equal(capturedPayment(fields, 2000), true);
  for (const changed of [
    { captured_amount: "1999" },
    { transaction_code: "02000" },
    { refunded_amount: "1" },
    { fort_id: "" },
    { response_code: "00008" },
  ])
    assert.equal(capturedPayment({ ...fields, ...changed }, 2000), false);
});
test("payment payloads reject nested values and preserve canonical scalar strings", () => {
  assert.deepEqual(parseFields({ amount: 2000, empty: "", optional: null }), {
    amount: "2000",
    empty: "",
  });
  assert.throws(() => parseFields({ amount: { value: 2000 } }), /Invalid/);
});

test("SAR settlement preserves USD catalog prices and the exact captured charge", async () => {
  const { paymentPrice, displayPayment } =
    await import("../src/server/payment-pricing");
  assert.deepEqual(paymentPrice("monthly", "research-20"), {
    amount: 7500,
    currency: "SAR",
    displayAmount: 2000,
    displayCurrency: "USD",
  });
  assert.deepEqual(paymentPrice("annual", "research-20"), {
    amount: 75000,
    currency: "SAR",
    displayAmount: 20000,
    displayCurrency: "USD",
  });
  assert.deepEqual(
    displayPayment({
      cadence: "monthly",
      ...paymentPrice("monthly", "research-20"),
    }),
    { amount: 2000, currency: "USD" },
  );
  assert.deepEqual(
    displayPayment({ cadence: "annual", amount: 24000, currency: "USD" }),
    { amount: 24000, currency: "USD" },
  );
  assert.equal(
    capturedPayment(
      {
        response_code: "12000",
        transaction_code: "14000",
        captured_amount: "7500",
        refunded_amount: "0",
        fort_id: "123",
      },
      7500,
    ),
    true,
  );
  assert.equal(
    capturedPayment(
      {
        response_code: "12000",
        transaction_code: "14000",
        captured_amount: "2000",
        refunded_amount: "0",
        fort_id: "123",
      },
      7500,
    ),
    false,
  );
});
