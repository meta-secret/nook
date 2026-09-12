/** @typedef {'action_required' | 'failure' | 'startup_failure' | 'timed_out' | 'cancelled' | 'success' | 'skipped'} WorkflowConclusion */
/** @typedef {{ id: number, run_attempt: number, name: string, event: string, head_branch: string, head_sha: string, conclusion: WorkflowConclusion, html_url: string }} MainRun */
/** @typedef {{ name: string, conclusion: WorkflowConclusion }} MainJob */
/** @typedef {{ number: number }} SourcePullRequest */
/** @typedef {{ run: MainRun, recordedAt: string, failures: string[] }} ProgressEntryInput */
/** @typedef {{ body?: string, run: MainRun, recordedAt: string }} RetireSuccessfulIssueInput */
/** @typedef {{ body: string, run: MainRun, recordedAt: string, failures: string[], relatedPrs: number[] }} UpdateExistingIssueInput */
/** @typedef {{ run: MainRun, jobs: MainJob[], sourcePullRequests?: SourcePullRequest[], recordedAt: string, existingBody?: string }} BuildMainFailureIssueInput */
/** @typedef {{ path: string, body: string, failedJobs: string[] }} MainFailureIssue */

const FAILURE_CONCLUSIONS = new Set([
  'action_required',
  'failure',
  'startup_failure',
  'timed_out',
])
const REPAIR_JOB_CONCLUSIONS = new Set([...FAILURE_CONCLUSIONS, 'cancelled'])

// Kept only to reopen incidents retired by the former E2E suppression policy.
const DEFERRED_E2E_RETIREMENT_MARKER = '<!-- hive-retired:deferred-e2e -->'
const SUCCESSFUL_RERUN_RETIREMENT_MARKER = '<!-- hive-retired:successful-rerun -->'

/** @param {unknown} value @param {string} label @returns {string} */
function requireString(value, label) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${label} must be a non-empty string`)
  }
  return value
}

/** @param {unknown} value @param {string} label @returns {number} */
function requireInteger(value, label) {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${label} must be a positive integer`)
  }
  return /** @type {number} */ (value)
}

/** @param {unknown} value @param {string} label @returns {string} */
function requireTimestamp(value, label) {
  const timestamp = requireString(value, label)
  if (!Number.isFinite(Date.parse(timestamp))) {
    throw new Error(`${label} must be an ISO timestamp`)
  }
  return timestamp
}

/** @param {MainRun} run @returns {string} */
function requireMainRun(run) {
  if (!run || typeof run !== 'object') throw new Error('run must be an object')
  if (run.name !== 'CI') throw new Error(`expected CI workflow, got ${run.name}`)
  if (run.event !== 'push') throw new Error(`expected push event, got ${run.event}`)
  if (run.head_branch !== 'main') {
    throw new Error(`expected main branch, got ${run.head_branch}`)
  }
  requireInteger(run.id, 'run.id')
  requireInteger(run.run_attempt, 'run.run_attempt')
  requireString(run.html_url, 'run.html_url')
  const headSha = requireString(run.head_sha, 'run.head_sha')
  if (!/^[0-9a-f]{40}$/i.test(headSha)) throw new Error('run.head_sha must be a full commit SHA')
  return headSha.toLowerCase()
}

/** @param {MainRun} run @returns {string} */
function requireMainFailure(run) {
  const headSha = requireMainRun(run)
  if (!FAILURE_CONCLUSIONS.has(run.conclusion)) {
    throw new Error(`expected unsuccessful conclusion, got ${run.conclusion}`)
  }
  return headSha
}

/** @param {MainRun} run @returns {string} */
function incidentPathForRun(run) {
  const headSha = requireMainRun(run)
  return `issues/hive-isolated-agent-platform/main-failure-${headSha}.md`
}

/** @param {unknown} value @returns {string} */
function safeInline(value) {
  return String(value)
    .replace(/[\r\n]+/g, ' ')
    .replace(/[<>]/g, '')
    .trim()
    .slice(0, 200)
}

/** @param {MainJob[]} jobs @returns {string[]} */
function failedJobNames(jobs) {
  if (!Array.isArray(jobs)) throw new Error('jobs must be an array')
  const names = jobs
    .filter((job) => REPAIR_JOB_CONCLUSIONS.has(job.conclusion))
    .map((job) => safeInline(requireString(job.name, 'job.name')))
    .filter(Boolean)
  return [...new Set(names)].sort((left, right) => left.localeCompare(right))
}

/** @param {SourcePullRequest[]} sourcePullRequests @returns {number[]} */
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

/** @param {string} body @param {string} field @returns {number[]} */
function parseNumberList(body, field) {
  const match = body.match(new RegExp(`^${field}:\\s*\\[([^\\]]*)\\]$`, 'm'))
  const values = match?.[1]
  if (!values || values.trim() === '') return []
  return values
    .split(',')
    .map((value) => Number.parseInt(value.trim(), 10))
    .filter((value) => Number.isInteger(value) && value > 0)
}

/** @param {string} body @param {string} field @param {string} value @returns {string} */
function replaceFrontmatterField(body, field, value) {
  const pattern = new RegExp(`^${field}:.*$`, 'm')
  if (!pattern.test(body)) throw new Error(`existing issue is missing ${field}`)
  return body.replace(pattern, `${field}: ${value}`)
}

/** @param {string} body @returns {string} */
function clearDeliveryCompletion(body) {
  if (!body.includes('<!-- hive-delivery-complete -->')) return body
  return body.replace(/\n\n## Completion\n[\s\S]*$/, '').replace(/- \[x\]/g, '- [ ]')
}

/** @param {ProgressEntryInput} input @returns {string} */
function progressEntry({ run, recordedAt, failures }) {
  const marker = `<!-- main-run:${run.id}:attempt:${run.run_attempt} -->`
  const jobs = failures.length === 0 ? 'workflow-level failure' : failures.join(', ')
  return [
    marker,
    `- ${recordedAt}: Main run [${run.id} attempt ${run.run_attempt}](${run.html_url})`,
    `  failed for \`${run.head_sha}\`. Failed jobs: ${jobs}.`,
  ].join('\n')
}

/** @param {string} body @param {MainRun} run @returns {boolean} */
function isStaleMainAttempt(body, run) {
  requireMainRun(run)
  const recorded = []
  for (const match of body.matchAll(/<!-- main-run:(\d+):attempt:(\d+) -->/g)) {
    const runIdText = match[1]
    const attemptText = match[2]
    if (!runIdText || !attemptText) continue
    recorded.push({
      runId: Number.parseInt(runIdText, 10),
      attempt: Number.parseInt(attemptText, 10),
    })
  }
  return recorded.some(
    (entry) =>
      entry.runId > run.id || (entry.runId === run.id && entry.attempt > run.run_attempt),
  )
}

/** @param {RetireSuccessfulIssueInput} input @returns {string} */
function retireSuccessfulMainIssue({ body, run, recordedAt }) {
  requireMainRun(run)
  if (run.conclusion !== 'success') {
    throw new Error(`expected successful conclusion, got ${run.conclusion}`)
  }
  if (typeof body !== 'string' || body.length === 0) {
    const timestamp = requireTimestamp(recordedAt, 'recordedAt')
    const shortSha = run.head_sha.slice(0, 12)
    return `---
title: Main verification state for ${shortSha}
status: done
priority: p1
automation: hive
owner: unassigned
created_at: ${timestamp}
updated_at: ${timestamp}
source_issues: []
related_prs: []
depends_on: []
---

# Main verification state for ${shortSha}

## Context

The trusted Main workflow completed successfully before any older failed-run
handoff for this revision was recorded.

## Progress

<!-- main-run:${run.id}:attempt:${run.run_attempt} -->
- ${timestamp}: Main run [${run.id} attempt ${run.run_attempt}](${run.html_url})
  succeeded for \`${run.head_sha}\`.
${SUCCESSFUL_RERUN_RETIREMENT_MARKER}

## Findings and decisions

- This tombstone prevents an out-of-order older failure handoff from queuing an
  obsolete Hive repair.
`
  }
  if (isStaleMainAttempt(body, run)) return body
  const marker = `<!-- main-run:${run.id}:attempt:${run.run_attempt} -->`
  if (body.includes(marker) && body.includes(SUCCESSFUL_RERUN_RETIREMENT_MARKER)) return body
  const wasCompleted = /^status:\s*done$/m.test(body)
  let updated = replaceFrontmatterField(body, 'updated_at', requireTimestamp(recordedAt, 'recordedAt'))
  updated = replaceFrontmatterField(updated, 'status', 'done')
  if (!wasCompleted) {
    updated = replaceFrontmatterField(updated, 'owner', 'unassigned')
    updated = clearDeliveryCompletion(updated)
  }
  updated = updated.replace(`${DEFERRED_E2E_RETIREMENT_MARKER}\n\n`, '')
  const entry = [
    marker,
    `- ${recordedAt}: Main run [${run.id} attempt ${run.run_attempt}](${run.html_url})`,
    `  succeeded for \`${run.head_sha}\`; any active Hive repair is retired.`,
    SUCCESSFUL_RERUN_RETIREMENT_MARKER,
  ].join('\n')
  const findingsHeading = '\n## Findings and decisions\n'
  if (!updated.includes(findingsHeading)) {
    throw new Error('existing issue is missing Findings and decisions')
  }
  return updated.replace(findingsHeading, `\n${entry}\n${findingsHeading}`)
}

/** @param {ProgressEntryInput & { relatedPrs: number[] }} input @returns {string} */
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
- Follow the feature remote \`build:compile\` and local dev integration path; the dev manager owns the full dev PR promotion.
- Do not bypass checks, weaken cache isolation, or push directly to Main.

## Acceptance criteria

- [ ] The failure is explained and fixed with targeted regression coverage.
- [ ] The fix PR passes exact-head repository-owned checks, including the
  Main-equivalent browser suites.
- [ ] The fix is promoted through the dev PR after exact-head validation, and the incident records its PR and validation.

## Progress

${progress}

## Findings and decisions

- Main failure records include job names and workflow links, never raw logs or
  credentials.

## References

- [Failed Main run](${run.html_url})
`
}

/** @param {UpdateExistingIssueInput} input @returns {string} */
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

/** @param {BuildMainFailureIssueInput} input @returns {MainFailureIssue} */
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
  const marker = `<!-- main-run:${run.id}:attempt:${run.run_attempt} -->`
  const existingBodyText = existingBody || ''
  const hasNewAttempt =
    existingBodyText.length > 0 && !existingBodyText.includes(marker)
  const actionableExistingBody =
    hasNewAttempt ||
    existingBodyText.includes(DEFERRED_E2E_RETIREMENT_MARKER) ||
    existingBodyText.includes(SUCCESSFUL_RERUN_RETIREMENT_MARKER)
    ? replaceFrontmatterField(
        replaceFrontmatterField(
          clearDeliveryCompletion(
            existingBodyText
              .replace(`${DEFERRED_E2E_RETIREMENT_MARKER}\n\n`, '')
              .replaceAll(`${SUCCESSFUL_RERUN_RETIREMENT_MARKER}\n`, ''),
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
  retireSuccessfulMainIssue,
  requireMainFailure,
}
