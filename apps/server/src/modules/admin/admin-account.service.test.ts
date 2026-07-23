import assert from "node:assert/strict";
import test from "node:test";
import {
  InvalidAccountFlagsError,
  resolveAccountFlags,
} from "./admin-account.service.js";

test("only administrator accounts can be new-user default follows", () => {
  assert.throws(
    () =>
      resolveAccountFlags(
        { isAdmin: false, isDefaultFollow: false },
        { isDefaultFollow: true },
      ),
    InvalidAccountFlagsError,
  );
  assert.deepEqual(
    resolveAccountFlags(
      { isAdmin: false, isDefaultFollow: false },
      { isAdmin: true, isDefaultFollow: true },
    ),
    { isAdmin: true, isDefaultFollow: true },
  );
});

test("demoting an administrator also clears default follow", () => {
  assert.deepEqual(
    resolveAccountFlags(
      { isAdmin: true, isDefaultFollow: true },
      { isAdmin: false },
    ),
    { isAdmin: false, isDefaultFollow: false },
  );
});
