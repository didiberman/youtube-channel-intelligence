import assert from "node:assert/strict";
import test from "node:test";
import {
  maxTranscriptAttempts,
  shouldRetryTranscript,
  videosAfterBaseline,
} from "./pipeline.js";

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

test("videosAfterBaseline excludes Shorts", () => {
  const baseline = {
    videoId: "one",
    title: "One",
    publishedAt: "2026-01-01T00:00:00Z",
    url: "https://youtube.com/watch?v=one",
  };
  const result = videosAfterBaseline(
    [
      {
        videoId: "short",
        title: "Short",
        publishedAt: "2026-01-02T00:00:00Z",
        url: "https://youtube.com/shorts/short",
        isShort: true,
      },
      {
        videoId: "long",
        title: "Long",
        publishedAt: "2026-01-03T00:00:00Z",
        url: "https://youtube.com/watch?v=long",
        isShort: false,
      },
    ],
    baseline,
  );

  assert.deepEqual(result.map((video) => video.videoId), ["long"]);
});

test("retries unavailable transcripts four times after the first attempt", () => {
  assert.equal(maxTranscriptAttempts, 5);
  assert.equal(shouldRetryTranscript(1), true);
  assert.equal(shouldRetryTranscript(4), true);
  assert.equal(shouldRetryTranscript(5), false);
});
