import assert from "node:assert/strict";
import test from "node:test";
import {
  createWelcomeMessage,
  shouldHandleTelegramMessage,
} from "./telegram-webhook.js";

test("welcome message lists channels and excludes past reports", () => {
  const message = createWelcomeMessage(["Benjamin Cowen", "Bob Loukas"]);

  assert.match(message, /• Benjamin Cowen/);
  assert.match(message, /• Bob Loukas/);
  assert.match(message, /Past analyses will not be sent/);
});

test("only handles private Telegram messages", () => {
  const from = { id: 1 };
  assert.equal(
    shouldHandleTelegramMessage({
      text: "/subscribe password",
      chat: { id: 123, type: "private" },
      from,
    }),
    true,
  );
  assert.equal(
    shouldHandleTelegramMessage({
      text: "/subscribe password",
      chat: { id: -100123, type: "supergroup" },
      from,
    }),
    false,
  );
  assert.equal(
    shouldHandleTelegramMessage({
      chat: { id: 123, type: "private" },
      from,
    }),
    false,
  );
});
