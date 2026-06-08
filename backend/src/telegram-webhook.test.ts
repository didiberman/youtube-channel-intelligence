import assert from "node:assert/strict";
import test from "node:test";
import { createWelcomeMessage } from "./telegram-webhook.js";

test("welcome message lists channels and excludes past reports", () => {
  const message = createWelcomeMessage(["Benjamin Cowen", "Bob Loukas"]);

  assert.match(message, /• Benjamin Cowen/);
  assert.match(message, /• Bob Loukas/);
  assert.match(message, /Past analyses will not be sent/);
});
