#!/usr/bin/env node

const { execFileSync } = require('node:child_process')
const { lstatSync, readFileSync, readlinkSync } = require('node:fs')
const { extname } = require('node:path')

const INITIAL_PR_LIMIT = 2_000
const REVIEW_GROWTH_STOP = 3_000

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

function emptySummary() {
  return {
    authoredLines: 0,
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
    summary.authoredLines += changedLines
  }
}

function summarizeNumstat(numstat) {
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

function addUntracked(summary, paths) {
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

function countTextLines(text) {
  if (text.length === 0) return 0
  const terminators = text.match(/\n/gu)?.length ?? 0
  return terminators + (text.endsWith('\n') ? 0 : 1)
}

function evaluateBudget({ authoredLines, prNumber, verifiedReviewContext }) {
  if (authoredLines >= REVIEW_GROWTH_STOP) {
    return {
      ok: false,
      message: `authored diff reached the 3,000-line review-growth stop: ${authoredLines}`,
    }
  }
  if (authoredLines <= INITIAL_PR_LIMIT) return { ok: true, mode: 'initial' }
  if (!prNumber) {
    return {
      ok: false,
      message: `authored diff exceeds 2,000 lines without PR-verified review-fix context: ${authoredLines}`,
    }
  }
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

function reviewBatchMatches({
  pr, threads, reviews, comments, changedPaths, publishedAt,
  hasNextPage,
}) {
  if (hasNextPage || changedPaths.length === 0) return false
  const currentPaths = new Set(
    threads
      .filter((thread) => !thread.isResolved)
      .map((thread) => thread.path),
  )
  const inlineMatch = changedPaths.some((path) => currentPaths.has(path))
  const reviewBodyMatch = reviews.some(
    (review) => ['COMMENTED', 'CHANGES_REQUESTED'].includes(review.state) &&
      review.body.trim() && !/^### 💡 Codex Review/u.test(review.body.trim()),
  )
  const publishedTime = Date.parse(publishedAt)
  const commentMatch = comments.some((comment) =>
    Number.isFinite(publishedTime) && Date.parse(comment.createdAt) > publishedTime &&
    comment.body.trim() &&
    !/^(?:<!--|@codex (?:review|security review)|### (?:Preview deployed|Web research preview))/u.test(comment.body.trim()) &&
    !/^@\S+ this workflow assigned you PR #\d+\. Continue only this PR's recorded scope through review, exact-head validation, and squash merge\.$/u.test(comment.body.trim()),
  )
  return Boolean(inlineMatch || reviewBodyMatch || commentMatch)
}

function verifyReviewContext(prNumber) {
  if (!/^[1-9]\d*$/.test(prNumber)) return false
  const branch = runGit(['branch', '--show-current'])
  if (!branch) return false
  const pr = JSON.parse(runGh([
    'pr', 'view', prNumber, '--json', 'baseRefName,headRefName,headRefOid,state',
  ]))
  if (pr.state !== 'OPEN' || pr.baseRefName !== 'main' || pr.headRefName !== branch) {
    return false
  }
  const repository = runGh(['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner'])
  const [owner, name] = repository.split('/')
  const review = JSON.parse(runGh([
    'api', 'graphql',
    '-f', 'query=query($owner:String!,$name:String!,$number:Int!,$head:GitObjectID!){repository(owner:$owner,name:$name){pullRequest(number:$number){reviewThreads(first:100){pageInfo{hasNextPage}nodes{isResolved isOutdated path}}reviews(last:100){pageInfo{hasPreviousPage}nodes{body state}}comments(last:100){pageInfo{hasPreviousPage}nodes{body createdAt}}}object(oid:$head){... on Commit{checkSuites(first:100){pageInfo{hasNextPage}nodes{createdAt}}}}}}',
    '-f', `owner=${owner}`, '-f', `name=${name}`, '-F', `number=${prNumber}`,
    '-f', `head=${pr.headRefOid}`,
  ])).data.repository
  const changedPaths = runGit(['diff', '--name-only', '--no-renames', '-z', pr.headRefOid])
    .split('\0')
    .concat(runGit(['ls-files', '--others', '--exclude-standard', '-z']).split('\0'))
    .filter(Boolean)
  return reviewBatchMatches({
    pr,
    threads: review.pullRequest.reviewThreads.nodes,
    reviews: review.pullRequest.reviews.nodes,
    comments: review.pullRequest.comments.nodes,
    changedPaths,
    publishedAt: review.object.checkSuites.nodes.map(({ createdAt }) => createdAt).sort()[0] ?? '',
    hasNextPage: review.pullRequest.reviewThreads.pageInfo.hasNextPage ||
      review.pullRequest.reviews.pageInfo.hasPreviousPage ||
      review.pullRequest.comments.pageInfo.hasPreviousPage ||
      review.object.checkSuites.pageInfo.hasNextPage,
  })
}

function main() {
  const reviewFixPr = process.argv[2]?.trim() ?? ''
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
  const needsReviewContext = summary.authoredLines > INITIAL_PR_LIMIT &&
    summary.authoredLines < REVIEW_GROWTH_STOP
  const result = evaluateBudget({
    authoredLines: summary.authoredLines,
    prNumber: reviewFixPr,
    verifiedReviewContext: needsReviewContext && verifyReviewContext(reviewFixPr),
  })
  console.log(`Authored PR diff: ${summary.authoredLines} lines`)
  console.log(`Reported-only diff: ${JSON.stringify(summary)}`)
  if (!result.ok) throw new Error(result.message)
  console.log(`PR authored-line budget passed in ${result.mode} mode`)
}

if (require.main === module) {
  try {
    main()
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  }
}

module.exports = {
  addUntracked, countTextLines, evaluateBudget, reviewBatchMatches, summarizeNumstat,
}
