const FAILURE_CONCLUSIONS = new Set([
  'action_required',
  'failure',
  'startup_failure',
  'timed_out',
])
const REPAIR_JOB_CONCLUSIONS = new Set([...FAILURE_CONCLUSIONS, 'cancelled'])

// Kept only to reopen incidents retired by the former E2E suppression policy.
const DEFERRED_E2E_RETIREMENT_MARKER = '<!-- hive-retired:deferred-e2e -->'

function requireString(value, label) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${label} must be a non-empty string`)
  }
  return value
}

function requireInteger(value, label) {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${label} must be a positive integer`)
  }
  return value
}

function requireTimestamp(value, label) {
  const timestamp = requireString(value, label)
  if (!Number.isFinite(Date.parse(timestamp))) {
    throw new Error(`${label} must be an ISO timestamp`)
  }
  return timestamp
}

function requireMainFailure(run) {
  if (!run || typeof run !== 'object') throw new Error('run must be an object')
  if (run.name !== 'Main') throw new Error(`expected Main workflow, got ${run.name}`)
  if (run.event !== 'push') throw new Error(`expected push event, got ${run.event}`)
  if (run.head_branch !== 'main') {
    throw new Error(`expected main branch, got ${run.head_branch}`)
  }
  if (!FAILURE_CONCLUSIONS.has(run.conclusion)) {
    throw new Error(`expected unsuccessful conclusion, got ${run.conclusion}`)
  }
  requireInteger(run.id, 'run.id')
  requireInteger(run.run_attempt, 'run.run_attempt')
  requireString(run.html_url, 'run.html_url')
  const headSha = requireString(run.head_sha, 'run.head_sha')
  if (!/^[0-9a-f]{40}$/i.test(headSha)) throw new Error('run.head_sha must be a full commit SHA')
  return headSha.toLowerCase()
}

function incidentPathForRun(run) {
  const headSha = requireMainFailure(run)
  return `issues/hive-isolated-agent-platform/main-failure-${headSha}.md`
}

function safeInline(value) {
  return String(value)
    .replace(/[\r\n]+/g, ' ')
    .replace(/[<>]/g, '')
    .trim()
    .slice(0, 200)
}

function failedJobNames(jobs) {
  if (!Array.isArray(jobs)) throw new Error('jobs must be an array')
  const names = jobs
    .filter((job) => REPAIR_JOB_CONCLUSIONS.has(job.conclusion))
    .map((job) => safeInline(requireString(job.name, 'job.name')))
    .filter(Boolean)
  return [...new Set(names)].sort((left, right) => left.localeCompare(right))
}

function pullRequestNumbers(sourcePullRequests) {
  if (!Array.isArray(sourcePullRequests)) {
    throw new Error('sourcePullRequests must be an array')
  }
  return [
    ...new Set(
      sourcePullRequests.map((pullRequest) =>
        requireInteger(pullRequest.number, 'sourcePullRequest.number'),
      ),
    ),
  ].sort((left, right) => left - right)
}

function parseNumberList(body, field) {
  const match = body.match(new RegExp(`^${field}:\\s*\\[([^\\]]*)\\]$`, 'm'))
  if (!match || match[1].trim() === '') return []
  return match[1]
    .split(',')
    .map((value) => Number.parseInt(value.trim(), 10))
    .filter((value) => Number.isInteger(value) && value > 0)
}

function replaceFrontmatterField(body, field, value) {
  const pattern = new RegExp(`^${field}:.*$`, 'm')
  if (!pattern.test(body)) throw new Error(`existing issue is missing ${field}`)
  return body.replace(pattern, `${field}: ${value}`)
}

function clearDeliveryCompletion(body) {
  if (!body.includes('<!-- hive-delivery-complete -->')) return body
  return body.replace(/\n\n## Completion\n[\s\S]*$/, '').replace(/- \[x\]/g, '- [ ]')
}

function progressEntry({ run, recordedAt, failures }) {
  const marker = `<!-- main-run:${run.id}:attempt:${run.run_attempt} -->`
  const jobs = failures.length === 0 ? 'workflow-level failure' : failures.join(', ')
  return [
    marker,
    `- ${recordedAt}: Main run [${run.id} attempt ${run.run_attempt}](${run.html_url})`,
    `  failed for \`${run.head_sha}\`. Failed jobs: ${jobs}.`,
  ].join('\n')
}

function latestMainAttempt(body, runId) {
  if (typeof body !== 'string') return undefined
  const attempts = [...body.matchAll(/<!-- main-run:(\d+):attempt:(\d+) -->/g)]
    .filter((match) => Number.parseInt(match[1], 10) === runId)
    .map((match) => Number.parseInt(match[2], 10))
  return attempts.length === 0 ? undefined : Math.max(...attempts)
}

function isStaleMainAttempt(body, run) {
  requireMainFailure(run)
  const latest = latestMainAttempt(body, run.id)
  return latest !== undefined && run.run_attempt < latest
}

function newIssue({ run, recordedAt, failures, relatedPrs }) {
  const shortSha = run.head_sha.slice(0, 12)
  const progress = progressEntry({ run, recordedAt, failures })
  return `---
title: Restore failed Main verification for ${shortSha}
status: ready
priority: p1
automation: hive
owner: unassigned
created_at: ${recordedAt}
updated_at: ${recordedAt}
source_issues: []
related_prs: [${relatedPrs.join(', ')}]
depends_on: []
---

# Restore failed Main verification for ${shortSha}

## Context

The trusted Main workflow failed after a push to the default branch. This
incident belongs to the [Hive isolated agent platform](README.md) because a
ready automated Workbench record is the durable handoff into the agent worker.

## Outcome

Restore the latest Main integration state with a normal, reviewed Nook pull
request while preserving the failing revision and workflow evidence.

## Scope

- Diagnose the failed Main jobs from the linked workflow run and its retained
  artifacts.
- Implement the smallest root-cause fix with behavior-focused regression
  coverage.
- Add the \`ci:full-e2e\` label because the problem was observed on Main.
- Do not bypass checks, weaken cache isolation, or push directly to Main.

## Acceptance criteria

- [ ] The failure is explained and fixed with targeted regression coverage.
- [ ] The fix PR passes exact-head repository-owned checks, including the
  Main-equivalent browser suites.
- [ ] The fix is squash-merged and the incident records its PR and validation.

## Progress

${progress}

## Findings and decisions

- Main failure records include job names and workflow links, never raw logs or
  credentials.

## References

- [Failed Main run](${run.html_url})
`
}

function updateExistingIssue({ body, run, recordedAt, failures, relatedPrs }) {
  if (typeof body !== 'string' || body.length === 0) {
    throw new Error('existing issue body must be non-empty')
  }
  if (!/^automation:\s*hive$/m.test(body)) {
    throw new Error('existing Main failure issue must remain Hive-automated')
  }

  const marker = `<!-- main-run:${run.id}:attempt:${run.run_attempt} -->`
  const existingPrs = parseNumberList(body, 'related_prs')
  const mergedPrs = [...new Set([...existingPrs, ...relatedPrs])].sort(
    (left, right) => left - right,
  )
  if (
    body.includes(marker) &&
    mergedPrs.length === existingPrs.length &&
    mergedPrs.every((value, index) => value === existingPrs[index])
  ) {
    return body
  }

  let updated = replaceFrontmatterField(body, 'updated_at', recordedAt)
  updated = replaceFrontmatterField(updated, 'related_prs', `[${mergedPrs.join(', ')}]`)

  if (!updated.includes(marker)) {
    const entry = progressEntry({ run, recordedAt, failures })
    const findingsHeading = '\n## Findings and decisions\n'
    if (!updated.includes(findingsHeading)) {
      throw new Error('existing issue is missing Findings and decisions')
    }
    updated = updated.replace(findingsHeading, `\n${entry}\n${findingsHeading}`)
  }
  return updated
}

function buildMainFailureIssue({
  run,
  jobs,
  sourcePullRequests = [],
  recordedAt,
  existingBody,
}) {
  requireMainFailure(run)
  const timestamp = requireTimestamp(recordedAt, 'recordedAt')
  const failures = failedJobNames(jobs)
  const relatedPrs = pullRequestNumbers(sourcePullRequests)
  const actionableExistingBody = existingBody?.includes(DEFERRED_E2E_RETIREMENT_MARKER)
    ? replaceFrontmatterField(
        replaceFrontmatterField(
          clearDeliveryCompletion(
            existingBody.replace(`${DEFERRED_E2E_RETIREMENT_MARKER}\n\n`, ''),
          ),
          'status',
          'ready',
        ),
        'owner',
        'unassigned',
      )
    : existingBody
  const body = actionableExistingBody
    ? updateExistingIssue({
        body: actionableExistingBody,
        run,
        recordedAt: timestamp,
        failures,
        relatedPrs,
      })
    : newIssue({
        run,
        recordedAt: timestamp,
        failures,
        relatedPrs,
      })
  return {
    path: incidentPathForRun(run),
    body,
    failedJobs: failures,
  }
}

module.exports = {
  buildMainFailureIssue,
  failedJobNames,
  incidentPathForRun,
  isStaleMainAttempt,
  requireMainFailure,
}
