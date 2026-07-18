import assert from "node:assert/strict";
import test from "node:test";
import {
  canonicalizeZpayParams,
  signZpayParams,
  verifyZpaySignature,
} from "./zpay-signature.js";

test("canonicalizes ZPAY parameters in ASCII key order", () => {
  assert.equal(
    canonicalizeZpayParams({
      type: "alipay",
      empty: "",
      c: "d",
      sign_type: "MD5",
      a: "b",
      sign: "ignored",
    }),
    "a=b&c=d&type=alipay",
  );
});

test("signs decoded Unicode values without URL encoding", () => {
  const params = {
    money: "5.67",
    name: "商品",
    out_trade_no: "123",
    pid: "1001",
    type: "alipay",
    sign_type: "MD5",
  };
  assert.equal(
    signZpayParams(params, "merchant-key"),
    "ad1726b65acad9e2a2dd36f2250bcefe",
  );
});

test("verifies signatures and rejects tampered parameters", () => {
  const params = { a: "b", c: "d", sign_type: "MD5" };
  const sign = signZpayParams(params, "secret");
  assert.equal(sign, "1ab8f8f68f35c55d22cc13e912e0a022");
  assert.equal(verifyZpaySignature({ ...params, sign }, "secret"), true);
  assert.equal(
    verifyZpaySignature({ ...params, c: "changed", sign }, "secret"),
    false,
  );
  assert.equal(verifyZpaySignature({ ...params, sign: "bad" }, "secret"), false);
});

