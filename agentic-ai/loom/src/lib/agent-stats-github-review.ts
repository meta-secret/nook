export enum ReviewOutcome {
  Findings = 'findings',
  Clean = 'clean',
  Unavailable = 'unavailable',
}

const CODEX_REVIEW_HEADING = '### 💡 Codex Review';
const CODEX_REVIEW_INTRO =
  'Here are some automated review suggestions for this pull request.';
const CODEX_REVIEWED_COMMIT_ONLY_PATTERN =
  /^\*\*Reviewed commit:\*\*\s*`[0-9a-f]{10,40}`$/i;

const CANONICAL_CODEX_ABOUT_DETAILS = [
  '<details> <summary>ℹ️ About Codex in GitHub</summary>',
  '<br/>',
  '[Your team has set up Codex to review pull requests in this repo](https://chatgpt.com/codex/cloud/settings/general). Reviews are triggered when you',
  '- Open a pull request for review',
  '- Mark a draft as ready',
  '- Comment "@codex review".',
  'If Codex has suggestions, it will comment; otherwise it will react with 👍.',
  'Codex can also answer questions or update the PR. Try commenting "@codex address that feedback".',
  '</details>',
].join(' ');

export function substantiveReviewBodyFindingCount(body: string): number {
  const detailsIndex = body.indexOf('<details>');
  const detailsEnd = body.indexOf('</details>', detailsIndex) + 10;
  const details =
    detailsIndex < 0 || detailsEnd < 10
      ? ''
      : body.slice(detailsIndex, detailsEnd).replace(/\s+/g, ' ').trim();
  const summary =
    details === CANONICAL_CODEX_ABOUT_DETAILS
      ? `${body.slice(0, detailsIndex)}${body.slice(detailsEnd)}`.trim()
      : body.trim();
  if (summary.length === 0) return 0;
  const expectedPrefix = `${CODEX_REVIEW_HEADING}\n\n${CODEX_REVIEW_INTRO}\n\n`;
  const statusOnly =
    summary.startsWith(expectedPrefix) &&
    CODEX_REVIEWED_COMMIT_ONLY_PATTERN.test(
      summary.slice(expectedPrefix.length),
    );
  return statusOnly ? 0 : 1;
}
