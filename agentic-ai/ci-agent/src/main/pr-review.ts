import { createOctokit, parseRepository, requestCodexReview } from "./github.js";

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

  const result = await requestCodexReview(
    createOctokit(),
    parseRepository(repository),
    prNumber,
  );
  console.log(JSON.stringify({ number: prNumber, repository, ...result }, null, 2));
}
