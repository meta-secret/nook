#!/usr/bin/env bun

import { execFileSync } from 'node:child_process'
import { lstatSync, readFileSync, readlinkSync } from 'node:fs'
import { extname } from 'node:path'

const INITIAL_PR_LIMIT = 2_000
const REVIEW_GROWTH_STOP = 3_000
const CODEX_REVIEW_PREFIX = '### 💡 Codex Review\n\nHere are some automated review suggestions for this pull request.\n\n'
const CODEX_ABOUT_DETAILS = [
  '<details> <summary>ℹ️ About Codex in GitHub</summary>', '<br/>',
  '[Your team has set up Codex to review pull requests in this repo](https://chatgpt.com/codex/cloud/settings/general). Reviews are triggered when you',
  '- Open a pull request for review', '- Mark a draft as ready',
  '- Comment "@codex review".',
  'If Codex has suggestions, it will comment; otherwise it will react with 👍.',
  'Codex can also answer questions or update the PR. Try commenting "@codex address that feedback".',
  '</details>',
].join(' ')

const reportedOnlyFilenames = new Set([
  'Cargo.lock',
  'bun.lock',
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock',
])
const generatedPaths = new Set([
  '/nook-app/nook-web/nook-web-app/src/landing/generated-message-keys.ts',
])
const authoredTextExtensions = new Set([
  '.bash', '.cjs', '.css', '.graphql', '.html', '.js', '.json', '.jsx',
  '.md', '.mjs', '.proto', '.rb', '.rs', '.scss', '.sh', '.sql', '.svelte',
  '.toml', '.ts', '.tsx', '.yaml', '.yml', '.zsh',
])

export function emptySummary() {
  return {
    authoredAdditions: 0,
    authoredDeletions: 0,
    binaryFiles: 0,
    generatedLines: 0,
    lockfileLines: 0,
    malformedRecords: 0,
    pureRenameFiles: 0,
    snapshotLines: 0,
    unmeasurableAuthoredFiles: 0,
    vendoredLines: 0,
  }
}

function classify(summary, path, added, deleted, renamed = false) {
  const normalizedPath = `/${path.replaceAll('\\', '/')}`
  const filename = normalizedPath.slice(normalizedPath.lastIndexOf('/') + 1)
  if (!Number.isInteger(added) || !Number.isInteger(deleted)) {
    if (authoredTextExtensions.has(extname(filename))) {
      summary.unmeasurableAuthoredFiles += 1
    } else {
      summary.binaryFiles += 1
    }
    return
  }
  const changedLines = added + deleted
  if (reportedOnlyFilenames.has(filename)) {
    summary.lockfileLines += changedLines
  } else if (normalizedPath.endsWith('.snap')) {
    summary.snapshotLines += changedLines
  } else if (
    normalizedPath.includes('/generated/') ||
    normalizedPath.includes('/dist/') ||
    generatedPaths.has(normalizedPath)
  ) {
    summary.generatedLines += changedLines
  } else if (normalizedPath.includes('/vendor/')) {
    summary.vendoredLines += changedLines
  } else if (renamed && changedLines === 0) {
    summary.pureRenameFiles += 1
  } else {
    summary.authoredAdditions += added
    summary.authoredDeletions += deleted
  }
}

export function summarizeNumstat(numstat) {
  const summary = emptySummary()
  const records = numstat.split('\0')
  for (let index = 0; index < records.length;) {
    const record = records[index]
    if (!record) break
    const firstTab = record.indexOf('\t')
    const secondTab = record.indexOf('\t', firstTab + 1)
    if (firstTab < 0 || secondTab < 0) {
      summary.malformedRecords += 1
      index += 1
      continue
    }
    const addedRaw = record.slice(0, firstTab)
    const deletedRaw = record.slice(firstTab + 1, secondTab)
    const inlinePath = record.slice(secondTab + 1)
    let path = inlinePath
    let renamed = false
    index += 1
    if (!inlinePath) {
      if (!records[index] || !records[index + 1]) {
        summary.malformedRecords += 1
        break
      }
      path = records[index + 1]
      renamed = true
      index += 2
    }
    classify(
      summary,
      path,
      /^\d+$/.test(addedRaw) ? Number(addedRaw) : Number.NaN,
      /^\d+$/.test(deletedRaw) ? Number(deletedRaw) : Number.NaN,
      renamed,
    )
  }
  return summary
}

export function addUntracked(summary, paths) {
  for (const path of paths) {
    if (!path) continue
    const status = lstatSync(path)
    if (!status.isFile() && !status.isSymbolicLink()) {
      summary.unmeasurableAuthoredFiles += 1
      continue
    }
    const content = status.isSymbolicLink()
      ? Buffer.from(readlinkSync(path, 'utf8'))
      : readFileSync(path)
    if (content.includes(0)) {
      classify(summary, path, Number.NaN, Number.NaN)
      continue
    }
    const text = content.toString('utf8')
    const lines = countTextLines(text)
    classify(summary, path, lines, 0)
  }
}

export function countTextLines(text) {
  if (text.length === 0) return 0
  const terminators = text.match(/\n/gu)?.length ?? 0
  return terminators + (text.endsWith('\n') ? 0 : 1)
}

export function evaluateBudget({ authoredAdditions, prNumber, verifiedReviewContext }) {
  if (authoredAdditions > INITIAL_PR_LIMIT && !prNumber) {
    return {
      ok: false,
      message: `authored diff exceeds 2,000 additions without PR-verified review-fix context: ${authoredAdditions}`,
    }
  }
  if (authoredAdditions >= REVIEW_GROWTH_STOP) {
    return {
      ok: false,
      message: `authored diff reached the 3,000-addition review-growth stop: ${authoredAdditions}`,
    }
  }
  if (authoredAdditions <= INITIAL_PR_LIMIT) return { ok: true, mode: 'initial' }
  if (!verifiedReviewContext) {
    return {
      ok: false,
      message: `PR #${prNumber} does not verify review-fix growth for this branch`,
    }
  }
  return { ok: true, mode: 'review-fix' }
}

function runGit(args) {
  return execFileSync('git', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()
}

function runGh(args) {
  return execFileSync('gh', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()
}

function botLoginMatches(actor, login) {
  return actor?.login === login || actor?.login === `${login}[bot]`
}

function isGitAncestor(ancestor, descendant) {
  try {
    execFileSync('git', ['merge-base', '--is-ancestor', ancestor, descendant], {
      stdio: 'ignore',
    })
    return true
  } catch {
    return false
  }
}

function isNonActionableReviewBody(body) {
  const normalized = body.trim().toLowerCase().replace(/[.!\s]+$/gu, '')
  return ['lgtm', 'looks good', 'looks good to me', 'nice work', 'no issues',
    'no issues found', 'thank you', 'thanks'].includes(normalized)
}

function isCodexStatusReviewBody(review) {
  if (!botLoginMatches(review.author, 'chatgpt-codex-connector')) return false
  const body = review.body.trim()
  const detailsIndex = body.indexOf('<details>')
  const summary = (detailsIndex < 0 ? body : body.slice(0, detailsIndex)).trim()
  if (detailsIndex >= 0) {
    const details = body.slice(detailsIndex).trim().replace(/\s+/gu, ' ')
    if (details !== CODEX_ABOUT_DETAILS) return false
  }
  return summary.startsWith(CODEX_REVIEW_PREFIX) &&
    /^\*\*Reviewed commit:\*\*\s*`[0-9a-f]{10,40}`$/u.test(summary.slice(CODEX_REVIEW_PREFIX.length))
}

export function reviewBatchMatches({
  threads, reviews, comments, changedPaths, publishedAt,
}) {
  if (changedPaths.length === 0) return false
  const currentPaths = new Set(
    threads
      .filter((thread) => !thread.isResolved)
      .map((thread) => thread.path),
  )
  const inlineMatch = changedPaths.some((path) => currentPaths.has(path))
  const publishedTime = Date.parse(publishedAt)
  const activeReviews = new Map()
  for (const review of reviews.toSorted(
    (left, right) => Date.parse(left.submittedAt) - Date.parse(right.submittedAt),
  )) {
    const login = review.author?.login
    if (!login || !review.submittedAt) continue
    if (['APPROVED', 'DISMISSED'].includes(review.state)) {
      activeReviews.delete(login)
    } else if (
      ['COMMENTED', 'CHANGES_REQUESTED'].includes(review.state) &&
      review.comments.totalCount === 0 && review.body.trim() &&
      !isNonActionableReviewBody(review.body) && !isCodexStatusReviewBody(review) &&
      !(botLoginMatches(review.author, 'cursor') && review.body.includes('<summary>Stale comment</summary>'))
    ) {
      activeReviews.set(login, review)
    }
  }
  const reviewBodyMatch = [...activeReviews.values()].some(
    (review) => Number.isFinite(publishedTime) &&
      Date.parse(review.submittedAt) > publishedTime,
  )
  const commentMatch = comments.some((comment) =>
    Number.isFinite(publishedTime) &&
    Date.parse(comment.updatedAt || comment.createdAt) > publishedTime &&
    comment.body.trim() &&
    !isNonActionableReviewBody(comment.body) &&
    !(
      botLoginMatches(comment.author, 'chatgpt-codex-connector') &&
      (
        comment.body.includes('Codex usage limits for code reviews') ||
        comment.body.trimStart().startsWith("Codex Review: Didn't find any major issues.")
      )
    ) &&
    !(botLoginMatches(comment.author, 'chatgpt-codex-connector') &&
      comment.body.startsWith('<!-- codex-pull-request-review-summary -->')) &&
    !(botLoginMatches(comment.author, 'github-actions') &&
      ['<!-- nook-core-coverage -->', '<!-- nook-ui-demo -->']
        .some((marker) => comment.body.startsWith(marker))) &&
    !/^(?:@codex (?:review|security review)|### (?:Preview deployed|Web research preview))/u.test(comment.body.trim()) &&
    !/^@\S+ this workflow assigned you PR #\d+\. Continue only this PR's recorded scope through review, exact-head validation, and squash merge\.$/u.test(comment.body.trim()),
  )
  return Boolean(inlineMatch || reviewBodyMatch || commentMatch)
}

function pagedPrNodes(owner, name, number, field, selection) {
  const query = `query($owner:String!,$name:String!,$number:Int!,$endCursor:String){repository(owner:$owner,name:$name){pullRequest(number:$number){${field}(first:100,after:$endCursor){nodes{${selection}}pageInfo{hasNextPage endCursor}}}}}`
  const pages = JSON.parse(runGh([
    'api', 'graphql', '--paginate', '--slurp', '-f', `query=${query}`,
    '-f', `owner=${owner}`, '-f', `name=${name}`, '-F', `number=${number}`,
  ]))
  return pages.flatMap((page) => page.data.repository.pullRequest[field].nodes)
}

function verifyReviewContext(prNumber) {
  if (!/^[1-9]\d*$/.test(prNumber)) return false
  const branch = runGit(['branch', '--show-current'])
  if (!branch) return false
  const repository = runGh(['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner'])
  const pr = JSON.parse(runGh([
    'pr', 'view', prNumber, '--json',
    'baseRefName,headRefName,headRefOid,headRepository,isCrossRepository,state',
  ]))
  if (
    pr.state !== 'OPEN' || pr.baseRefName !== 'main' || pr.headRefName !== branch ||
    pr.isCrossRepository || pr.headRepository?.nameWithOwner !== repository ||
    !isGitAncestor(pr.headRefOid, 'HEAD')
  ) {
    return false
  }
  const [owner, name] = repository.split('/')
  const publication = JSON.parse(runGh([
    'api', 'graphql',
    '-f', 'query=query($owner:String!,$name:String!,$head:GitObjectID!){repository(owner:$owner,name:$name){object(oid:$head){... on Commit{pushedDate}}}}',
    '-f', `owner=${owner}`, '-f', `name=${name}`,
    '-f', `head=${pr.headRefOid}`,
  ])).data.repository.object
  const threads = pagedPrNodes(owner, name, prNumber, 'reviewThreads', 'isResolved isOutdated path')
  const reviews = pagedPrNodes(owner, name, prNumber, 'reviews', 'author{login} body state submittedAt comments{totalCount}')
  const comments = pagedPrNodes(owner, name, prNumber, 'comments', 'author{login} body createdAt updatedAt')
  const changedPaths = runGit([
    'log', '--format=', '--name-only', '-z', '--no-renames', '--first-parent', '--no-merges',
    `${pr.headRefOid}..HEAD`,
  ]).split('\0')
    .concat(runGit(['diff', '--name-only', '--no-renames', '-z', 'HEAD']).split('\0'))
    .concat(runGit(['ls-files', '--others', '--exclude-standard', '-z']).split('\0'))
    .filter(Boolean)
  return reviewBatchMatches({
    threads,
    reviews,
    comments,
    changedPaths,
    publishedAt: publication.pushedDate ?? '',
  })
}

function main() {
  const reviewFixPr = process.argv[2]?.trim() ?? ''
  const stopOnly = process.argv[3] === '--stop-only'
  const mergeBase = runGit(['merge-base', 'HEAD', 'origin/main'])
  if (!/^[0-9a-f]{40}$/.test(mergeBase)) throw new Error('PR merge base is unavailable')
  const numstat = execFileSync('git', [
    'diff', '--no-ext-diff', '--numstat', '-z', '--find-renames', '-l0',
    mergeBase,
  ]).toString('utf8')
  const summary = summarizeNumstat(numstat)
  const untracked = execFileSync('git', [
    'ls-files', '--others', '--exclude-standard', '-z',
  ]).toString('utf8').split('\0')
  addUntracked(summary, untracked)
  if (summary.malformedRecords > 0 || summary.unmeasurableAuthoredFiles > 0) {
    throw new Error(`authored diff is not completely measurable: ${JSON.stringify(summary)}`)
  }
  console.log(`Authored PR additions: ${summary.authoredAdditions}`)
  console.log(`Authored PR deletions: ${summary.authoredDeletions}`)
  console.log(`Reported-only diff: ${JSON.stringify(summary)}`)
  if (stopOnly) {
    if (summary.authoredAdditions >= REVIEW_GROWTH_STOP) {
      throw new Error(`authored diff reached the 3,000-addition review-growth stop: ${summary.authoredAdditions}`)
    }
    console.log('PR authored-addition hard-stop precheck passed')
    return
  }
  const needsReviewContext = summary.authoredAdditions > INITIAL_PR_LIMIT &&
    summary.authoredAdditions < REVIEW_GROWTH_STOP
  const result = evaluateBudget({
    authoredAdditions: summary.authoredAdditions,
    prNumber: reviewFixPr,
    verifiedReviewContext: needsReviewContext && verifyReviewContext(reviewFixPr),
  })
  if (!result.ok) throw new Error(result.message)
  console.log(`PR authored-addition budget passed in ${result.mode} mode`)
}

if (import.meta.main) {
  try {
    main()
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  }
}
