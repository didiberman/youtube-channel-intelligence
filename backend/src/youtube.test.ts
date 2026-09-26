import assert from "node:assert/strict";
import test from "node:test";
import { isShortDuration } from "./youtube.js";

test("classifies videos up to three minutes as Shorts", () => {
  assert.equal(isShortDuration(0), true);
  assert.equal(isShortDuration(180), true);
  assert.equal(isShortDuration(181), false);
});
