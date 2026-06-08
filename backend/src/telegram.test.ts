import assert from "node:assert/strict";
import test from "node:test";
import { markdownToTelegramHtml } from "./telegram.js";

test("converts common Markdown to Telegram HTML", () => {
  const result = markdownToTelegramHtml(
    "# Summary\n\n**Bullish** move\n- First point\n- Second `code`\n[Source](https://example.com?a=1&b=2)",
  );

  assert.equal(
    result,
    '<b>Summary</b>\n\n<b>Bullish</b> move\n• First point\n• Second <code>code</code>\n<a href="https://example.com?a=1&amp;b=2">Source</a>',
  );
});

test("escapes unsupported HTML from model output", () => {
  assert.equal(
    markdownToTelegramHtml("<script>alert('x')</script>"),
    "&lt;script&gt;alert('x')&lt;/script&gt;",
  );
});
