import {
  CODEX_AVAILABILITY_PROBE,
  DEFAULT_REVIEW_CLOCK,
  requestExactHeadReview,
} from "./github-review.js";
import { createOctokit, parseRepository } from "./github.js";
import { prettyJson } from "./json.js";

export async function runPrReviewRequest(): Promise<void> {
  const repository = process.env.GITHUB_REPOSITORY?.trim();
  if (!repository) {
    throw new Error("GITHUB_REPOSITORY is required");
  }
  const rawPrNumber = process.env.PR_NUMBER?.trim() ?? "";
  const prNumber = Number(rawPrNumber);
  if (!Number.isInteger(prNumber) || prNumber <= 0) {
    throw new Error(
      `PR_NUMBER must be a positive integer (received ${rawPrNumber || "empty"})`,
    );
  }

  const availability = {
    clock: DEFAULT_REVIEW_CLOCK,
    probe: CODEX_AVAILABILITY_PROBE,
  };
  const result = await requestExactHeadReview(
    createOctokit(),
    parseRepository(repository),
    prNumber,
    availability,
  );
  console.log(prettyJson({ number: prNumber, repository, ...result }));
}
