import assert from "node:assert/strict";
import test from "node:test";

import {
  countAutomatedFindingBatches,
  isRepositoryStatusComment,
  isTrustedExactHeadReviewRequest,
} from "../main/github.js";

test("countAutomatedFindingBatches groups root bot findings by review", () => {
  const batches = countAutomatedFindingBatches({
    comments: [{
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
    }],
    reviews: [
      {
        active: true,
        actionable: false,
        reviewerLogin: "cursor[bot]",
        reviewId: 11,
      },
      {
        active: true,
        actionable: true,
        reviewerLogin: "chatgpt-codex-connector[bot]",
        reviewId: 10,
      },
      {
        active: true,
        actionable: true,
        reviewerLogin: "chatgpt-codex-connector[bot]",
        reviewId: 13,
      },
      {
        active: true,
        actionable: true,
        reviewerLogin: "chatgpt-codex-connector[bot]",
        reviewId: 14,
      },
    ],
  });

  assert.equal(batches, 4);
});

test("countAutomatedFindingBatches excludes dismissed review comments", () => {
  const batches = countAutomatedFindingBatches({
    comments: [
      {
        isReply: false,
        reviewerLogin: "chatgpt-codex-connector[bot]",
        reviewId: 10,
      },
      {
        isReply: false,
        reviewerLogin: "chatgpt-codex-connector[bot]",
        reviewId: 11,
      },
    ],
    reviews: [
      {
        active: false,
        actionable: false,
        reviewerLogin: "chatgpt-codex-connector[bot]",
        reviewId: 10,
      },
      {
        active: true,
        actionable: false,
        reviewerLogin: "chatgpt-codex-connector[bot]",
        reviewId: 11,
      },
    ],
  });

  assert.equal(batches, 1);
});

test("exact-head iteration markers require a trusted exact request", () => {
  const marker = "<!-- nook-codex-review:head-sha -->";
  assert.equal(
    isTrustedExactHeadReviewRequest({
      authorAssociation: "OWNER",
      body: `@codex review\n\n${marker}`,
      marker,
    }),
    true,
  );
  assert.equal(
    isTrustedExactHeadReviewRequest({
      authorAssociation: "NONE",
      body: `@codex review\n\n${marker}`,
      marker,
    }),
    false,
  );
  assert.equal(
    isTrustedExactHeadReviewRequest({
      authorAssociation: "OWNER",
      body: `Quoted marker: ${marker}`,
      marker,
    }),
    false,
  );
});

test("only a trusted canonical request marker is repository status", () => {
  const marker = "<!-- nook-codex-review:head-sha -->";
  assert.equal(
    isRepositoryStatusComment({
      authorAssociation: "OWNER",
      body: `@codex review\n\n${marker}`,
      cursorMarker: "<!-- nook-cursor-review:head-sha -->",
      marker,
    }),
    true,
  );
  assert.equal(
    isRepositoryStatusComment({
      authorAssociation: "OWNER",
      body: `Finding quoting ${marker}`,
      cursorMarker: "<!-- nook-cursor-review:head-sha -->",
      marker,
    }),
    false,
  );
  assert.equal(
    isRepositoryStatusComment({
      authorAssociation: "NONE",
      body: `@codex review\n\n${marker}`,
      cursorMarker: "<!-- nook-cursor-review:head-sha -->",
      marker,
    }),
    false,
  );
});
