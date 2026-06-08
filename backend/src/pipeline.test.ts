import assert from "node:assert/strict";
import test from "node:test";
import { videosAfterBaseline } from "./pipeline.js";

test("videosAfterBaseline returns new videos oldest first", () => {
  const baseline = {
    videoId: "one",
    title: "One",
    publishedAt: "2026-01-01T00:00:00Z",
    url: "https://youtube.com/watch?v=one",
  };
  const result = videosAfterBaseline(
    [
      {
        videoId: "three",
        title: "Three",
        publishedAt: "2026-01-03T00:00:00Z",
        url: "https://youtube.com/watch?v=three",
      },
      baseline,
      {
        videoId: "two",
        title: "Two",
        publishedAt: "2026-01-02T00:00:00Z",
        url: "https://youtube.com/watch?v=two",
      },
    ],
    baseline,
  );
  assert.deepEqual(
    result.map((video) => video.videoId),
    ["two", "three"],
  );
});

