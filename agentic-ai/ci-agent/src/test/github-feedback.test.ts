import assert from "node:assert/strict";
import test from "node:test";

import {
  countAutomatedFindingBatches,
  isNonActionableReviewBody,
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
      user: { login: "cypherkitty" },
    }),
    true,
  );
  assert.equal(
    isTrustedExactHeadReviewRequest({
      authorAssociation: "NONE",
      body: `@codex review\n\n${marker}`,
      marker,
      user: { login: "reviewer" },
    }),
    false,
  );
  assert.equal(
    isTrustedExactHeadReviewRequest({
      authorAssociation: "OWNER",
      body: `Quoted marker: ${marker}`,
      marker,
      user: { login: "cypherkitty" },
    }),
    false,
  );
  assert.equal(
    isTrustedExactHeadReviewRequest({
      authorAssociation: "CONTRIBUTOR",
      body: `@codex review\n\n${marker}`,
      marker,
      user: { login: "github-actions[bot]" },
    }),
    true,
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
      user: { login: "cypherkitty" },
    }),
    true,
  );
  assert.equal(
    isRepositoryStatusComment({
      authorAssociation: "OWNER",
      body: `Finding quoting ${marker}`,
      cursorMarker: "<!-- nook-cursor-review:head-sha -->",
      marker,
      user: { login: "cypherkitty" },
    }),
    false,
  );
  assert.equal(
    isRepositoryStatusComment({
      authorAssociation: "NONE",
      body: `@codex review\n\n${marker}`,
      cursorMarker: "<!-- nook-cursor-review:head-sha -->",
      marker,
      user: { login: "cypherkitty" },
    }),
    false,
  );
  assert.equal(
    isRepositoryStatusComment({
      authorAssociation: "OWNER",
      body: "@codex review\n\n<!-- nook-codex-review:older-head -->",
      cursorMarker: "<!-- nook-cursor-review:head-sha -->",
      marker,
      user: { login: "cypherkitty" },
    }),
    true,
  );
});

test("provider status text is authenticated before exclusion", () => {
  const status =
    "You have reached your Codex usage limits for code reviews. Try later.";
  const base = {
    authorAssociation: "NONE",
    body: status,
    cursorMarker: "<!-- nook-cursor-review:head-sha -->",
    marker: "<!-- nook-codex-review:head-sha -->",
  };
  assert.equal(
    isRepositoryStatusComment({
      ...base,
      user: { login: "chatgpt-codex-connector[bot]" },
    }),
    true,
  );
  assert.equal(
    isRepositoryStatusComment({
      ...base,
      user: { login: "human-reviewer" },
    }),
    false,
  );
});

test("workflow status markers are authenticated before exclusion", () => {
  const base = {
    authorAssociation: "NONE",
    cursorMarker: "<!-- nook-cursor-review:head-sha -->",
    marker: "<!-- nook-codex-review:head-sha -->",
  };
  for (const body of [
    "### Preview deployed",
    "### Web research preview",
    "<!-- nook-ui-demo -->",
    "<!-- nook-core-coverage -->",
  ]) {
    assert.equal(
      isRepositoryStatusComment({
        ...base,
        body,
        user: { login: "github-actions[bot]" },
      }),
      true,
    );
    assert.equal(
      isRepositoryStatusComment({
        ...base,
        body,
        user: { login: "human-reviewer" },
      }),
      false,
    );
  }
});

test("common praise is non-actionable", () => {
  assert.equal(isNonActionableReviewBody("Looks good to me."), true);
  assert.equal(isNonActionableReviewBody("No issues found!"), true);
  assert.equal(isNonActionableReviewBody("This drops the head guard."), false);
});
