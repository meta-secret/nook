import assert from "node:assert/strict";
import test from "node:test";

import { countAutomatedFindingBatches } from "../main/github.js";

test("countAutomatedFindingBatches groups root bot findings by review", () => {
  const batches = countAutomatedFindingBatches([
    {
      isReply: false,
      reviewerLogin: "chatgpt-codex-connector[bot]",
      reviewId: 10,
    },
    {
      isReply: false,
      reviewerLogin: "chatgpt-codex-connector[bot]",
      reviewId: 10,
    },
    {
      isReply: false,
      reviewerLogin: "cursor[bot]",
      reviewId: 11,
    },
    {
      isReply: true,
      reviewerLogin: "cypherkitty",
      reviewId: 10,
    },
    {
      isReply: false,
      reviewerLogin: "human-reviewer",
      reviewId: 12,
    },
  ]);

  assert.equal(batches, 2);
});
