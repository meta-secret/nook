export function substantiveReviewBodyFindingCount(body: string): number {
  const detailsIndex = body.indexOf('<details>');
  const summary = (
    detailsIndex < 0 ? body : body.slice(0, detailsIndex)
  ).trim();
  if (summary.length === 0) return 0;
  const statusOnly =
    summary.includes('Here are some automated review suggestions') &&
    /\*\*Reviewed commit:\*\* `?[0-9a-f]{7,40}`?\s*$/i.test(summary);
  return statusOnly ? 0 : 1;
}
