import assert from "node:assert/strict";
import test from "node:test";

import { countAutomatedFindingBatches } from "../main/github.js";

test("countAutomatedFindingBatches groups root bot findings by review", () => {
  const batches = countAutomatedFindingBatches([
    {
      pull_request_review_id: 10,
      user: { login: "chatgpt-codex-connector" },
    },
    {
      pull_request_review_id: 10,
      user: { login: "chatgpt-codex-connector" },
    },
    {
      pull_request_review_id: 11,
      user: { login: "cursor[bot]" },
    },
    {
      in_reply_to_id: 1,
      pull_request_review_id: 10,
      user: { login: "cypherkitty" },
    },
    {
      pull_request_review_id: 12,
      user: { login: "human-reviewer" },
    },
  ]);

  assert.equal(batches, 2);
});
