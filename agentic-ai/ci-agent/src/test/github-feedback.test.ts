import assert from "node:assert/strict";
import test from "node:test";

import {
  AutomatedFindingHistory,
  ReviewBodyClassification,
  GitHubIsRepositoryStatusComment,
  GitHubReviewIsTrustedExactHeadReviewRequest,
} from "../main/github.js";

void test("countAutomatedFindingBatches groups root bot findings by review", () => {
  const batches = new AutomatedFindingHistory({
    comments: [
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
    ],
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
  }).countBatches();

  assert.equal(batches, 4);
});

void test("countAutomatedFindingBatches excludes dismissed review comments", () => {
  const batches = new AutomatedFindingHistory({
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
  }).countBatches();

  assert.equal(batches, 1);
});

void test("exact-head iteration markers require a trusted exact request", () => {
  const marker = "<!-- nook-codex-review:head-sha -->";
  assert.equal(
    new GitHubReviewIsTrustedExactHeadReviewRequest({
      authorAssociation: "OWNER",
      body: `@codex review\n\n${marker}`,
      marker,
      user: { login: "cypherkitty" },
    }).execute(),
    true,
  );
  assert.equal(
    new GitHubReviewIsTrustedExactHeadReviewRequest({
      authorAssociation: "NONE",
      body: `@codex review\n\n${marker}`,
      marker,
      user: { login: "reviewer" },
    }).execute(),
    false,
  );
  assert.equal(
    new GitHubReviewIsTrustedExactHeadReviewRequest({
      authorAssociation: "OWNER",
      body: `Quoted marker: ${marker}`,
      marker,
      user: { login: "cypherkitty" },
    }).execute(),
    false,
  );
  assert.equal(
    new GitHubReviewIsTrustedExactHeadReviewRequest({
      authorAssociation: "CONTRIBUTOR",
      body: `@codex review\n\n${marker}`,
      marker,
      user: { login: "github-actions[bot]" },
    }).execute(),
    true,
  );
});

void test("only a trusted canonical request marker is repository status", () => {
  const marker = "<!-- nook-codex-review:head-sha -->";
  assert.equal(
    new GitHubIsRepositoryStatusComment({
      authorAssociation: "OWNER",
      body: `@codex review\n\n${marker}`,
      cursorMarker: "<!-- nook-cursor-review:head-sha -->",
      marker,
      user: { login: "cypherkitty" },
    }).execute(),
    true,
  );
  assert.equal(
    new GitHubIsRepositoryStatusComment({
      authorAssociation: "OWNER",
      body: `Finding quoting ${marker}`,
      cursorMarker: "<!-- nook-cursor-review:head-sha -->",
      marker,
      user: { login: "cypherkitty" },
    }).execute(),
    false,
  );
  assert.equal(
    new GitHubIsRepositoryStatusComment({
      authorAssociation: "NONE",
      body: `@codex review\n\n${marker}`,
      cursorMarker: "<!-- nook-cursor-review:head-sha -->",
      marker,
      user: { login: "cypherkitty" },
    }).execute(),
    false,
  );
  assert.equal(
    new GitHubIsRepositoryStatusComment({
      authorAssociation: "OWNER",
      body: "@codex review\n\n<!-- nook-codex-review:older-head -->",
      cursorMarker: "<!-- nook-cursor-review:head-sha -->",
      marker,
      user: { login: "cypherkitty" },
    }).execute(),
    true,
  );
});

void test("provider status text is authenticated before exclusion", () => {
  const status =
    "You have reached your Codex usage limits for code reviews. Try later.";
  const base = {
    authorAssociation: "NONE",
    body: status,
    cursorMarker: "<!-- nook-cursor-review:head-sha -->",
    marker: "<!-- nook-codex-review:head-sha -->",
  };
  assert.equal(
    new GitHubIsRepositoryStatusComment({
      ...base,
      user: { login: "chatgpt-codex-connector[bot]" },
    }).execute(),
    true,
  );
  assert.equal(
    new GitHubIsRepositoryStatusComment({
      ...base,
      user: { login: "human-reviewer" },
    }).execute(),
    false,
  );
});

void test("Codex review summary status is authenticated by exact actor and marker", () => {
  const base = {
    authorAssociation: "NONE",
    cursorMarker: "<!-- nook-cursor-review:head-sha -->",
    marker: "<!-- nook-codex-review:head-sha -->",
  };
  const summary = [
    "<!-- codex-pull-request-review-summary -->",
    "",
    "## Codex Review Summary",
  ].join("\n");

  assert.equal(
    new GitHubIsRepositoryStatusComment({
      ...base,
      body: summary,
      user: { login: "chatgpt-codex-connector[bot]" },
    }).execute(),
    true,
  );
  assert.equal(
    new GitHubIsRepositoryStatusComment({
      ...base,
      body: summary,
      user: { login: "human-reviewer" },
    }).execute(),
    false,
  );
  assert.equal(
    new GitHubIsRepositoryStatusComment({
      ...base,
      body: summary,
      user: { login: "chatgpt-codex-connector" },
    }).execute(),
    false,
  );
  assert.equal(
    new GitHubIsRepositoryStatusComment({
      ...base,
      body: "<!-- codex-pull-request-review-summary-lookalike -->",
      user: { login: "chatgpt-codex-connector[bot]" },
    }).execute(),
    false,
  );
  assert.equal(
    new GitHubIsRepositoryStatusComment({
      ...base,
      body: `Actionable finding\n\n${summary}`,
      user: { login: "chatgpt-codex-connector[bot]" },
    }).execute(),
    false,
  );
});

void test("workflow status markers are authenticated before exclusion", () => {
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
      new GitHubIsRepositoryStatusComment({
        ...base,
        body,
        user: { login: "github-actions[bot]" },
      }).execute(),
      true,
    );
    assert.equal(
      new GitHubIsRepositoryStatusComment({
        ...base,
        body,
        user: { login: "human-reviewer" },
      }).execute(),
      false,
    );
  }
});

void test("common praise is non-actionable", () => {
  assert.equal(
    new ReviewBodyClassification("Looks good to me.").isNonActionable(),
    true,
  );
  assert.equal(
    new ReviewBodyClassification("No issues found!").isNonActionable(),
    true,
  );
  assert.equal(
    new ReviewBodyClassification(
      "This drops the head guard.",
    ).isNonActionable(),
    false,
  );
});
