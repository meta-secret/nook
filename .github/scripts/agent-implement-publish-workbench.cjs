'use strict'

const fs = require('node:fs')
const { validateAgentRecord } = require('./workbench-records.cjs')

/**
 * Publish the trusted Workbench worklog and, for issue-backed runs, progress
 * the claimed issue. The GitHub Script runtime supplies the authenticated API
 * client and execution context; all other inputs remain workflow environment.
 *
 * @param {{ github: object, context: object, core: object }} runtime
 * @returns {Promise<void>}
 */
module.exports = async function publishWorkbenchResult({ github, context, core }) {
  const env = process.env
  const [owner, repo] = env.WORKBENCH_REPOSITORY.split('/')
  const issuePath = env.ISSUE_PATH.trim()
  const feature = issuePath ? issuePath.split('/')[1] : 'unplanned'
  const now = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')
  const timestamp = now.replaceAll('-', '').replaceAll(':', '')
  const runUrl = `${context.serverUrl}/${context.repo.owner}/${context.repo.repo}/actions/runs/${context.runId}`
  const { data: workflowRun } = await github.rest.actions.getWorkflowRun({
    ...context.repo,
    run_id: context.runId,
  })
  const publishedBranch = env.PUBLISHED_BRANCH.trim()
  const publishedHead = env.PUBLISHED_HEAD_SHA.trim()
  const success = env.IMPLEMENT_OUTCOME === 'success' &&
    /^[0-9a-f]{40}$/.test(publishedHead) && Boolean(publishedBranch)
  const implementationSummaryPath = `${env.IMPLEMENTATION_REPO_ROOT}/${env.WORKBENCH_SUMMARY_FILE}`
  const planningSummaryPath = `${env.GITHUB_WORKSPACE}/${env.WORKBENCH_SUMMARY_FILE}`
  const implementationSummaryExists = fs.existsSync(implementationSummaryPath)
  if (implementationSummaryExists) {
    const artifact = fs.lstatSync(implementationSummaryPath)
    if (!artifact.isFile() || artifact.isSymbolicLink() || artifact.size > 65536) {
      core.setFailed('Rejected unsafe implementation worklog artifact.')
      return
    }
  }
  const summaryPath = implementationSummaryExists
    ? implementationSummaryPath
    : planningSummaryPath
  const fallbackSummary = [
        '# Automated agent work summary',
        '',
        '## Outcome',
        '',
        success ? `Published feature branch \`${publishedBranch}\` at \`${publishedHead}\`; the feature Gizmo owns remote compilation and local dev landing.` : 'The bounded implementation run did not publish a feature branch.',
        '',
        '## Progress',
        '',
        '- See the linked workflow run for the execution boundary.',
        '',
        '## Implementation problems',
        '',
        success ? '- No problem summary was emitted by the bounded worker.' : '- The workflow or agent stopped before publishing a feature branch.',
        '',
        '## Decisions',
        '',
        '- None recorded.',
        '',
        '## Validation',
        '',
        `- [Agent implement run ${context.runId}](${runUrl})`,
        '',
        '## Remaining work',
        '',
        success ? `- Feature Gizmo must dispatch exact-head remote build-only compilation, then land \`${publishedBranch}\` into local dev.` : '- Inspect the workflow failure and return the issue to ready after correcting the blocker.',
      ].join('\n')
  let summary = fallbackSummary
  if (fs.existsSync(summaryPath)) {
    const candidate = fs.readFileSync(summaryPath, 'utf8').trim()
    const secrets = [env.CURSOR_SECRET, env.NOOK_SECRET]
    const rejection = validateAgentRecord(candidate, 'worklog', secrets, env.AGENT_PROMPT)
    if (rejection) {
      core.warning(`Rejected agent-authored Workbench summary: ${rejection}; publishing trusted fallback metadata.`)
    } else {
      summary = candidate
    }
  }
  const budgetBlocker = env.BUDGET_BLOCKER_B64
    ? Buffer.from(env.BUDGET_BLOCKER_B64, 'base64').toString('utf8')
    : ''
  const budgetMatch = budgetBlocker.match(/^Implemented diff exceeds the 2000 authored-addition budget: (\d+)$/)
  if (budgetMatch) {
    summary = [
      '# Automated agent work summary',
      '',
      '## Outcome',
      '',
      `Blocked before publication: the trusted formatter measured ${budgetMatch[1]} authored changed lines, above the 2,000-line branch publication limit.`,
      '',
      '## Progress',
      '',
      '- The bounded agent completed editing and trusted formatting, but no feature branch was published.',
      '',
      '## Implementation problems',
      '',
      `- ${budgetBlocker}. The accepted plan underestimated the final formatted diff.`,
      '',
      '## Decisions',
      '',
      '- Delivery stopped at the trusted authored-line budget; no successor branch was created before the current slice could be redesigned.',
      '',
      '## Validation',
      '',
      `- [Agent implement run ${context.runId}](${runUrl})`,
      '',
      '## Remaining work',
      '',
      '- Simplify or redesign the task. If necessary scope remains oversized, publish a sequential plan before returning only its first slice to ready.',
    ].join('\n')
  }
  const worklogPath = `worklogs/${feature}/${timestamp}-run-${context.runId}.md`
  const worklog = [
    '---',
    `title: ${JSON.stringify(env.ISSUE_TITLE || `Manual agent run ${context.runId}`)}`,
    `feature: ${feature}`,
    `issue: ${issuePath || 'null'}`,
    `plan: ${env.PLAN_PATH || 'null'}`,
    `originMainSha: ${env.ORIGIN_MAIN_SHA}`,
    `pinnedLocalDevSha: ${env.PINNED_LOCAL_DEV_SHA}`,
    `featureHeadSha: ${env.FEATURE_HEAD_SHA}`,
    `published_branch: ${publishedBranch || 'null'}`,
    `published_head_sha: ${publishedHead || 'null'}`,
    `status: ${success ? 'in_progress' : 'blocked'}`,
    `started_at: ${workflowRun.created_at || now}`,
    `finished_at: ${now}`,
    'agent: cursor',
    '---',
    '',
    summary,
    '',
  ].join('\n')
  const publishedWorklog = await github.rest.repos.createOrUpdateFileContents({
    owner,
    repo,
    path: worklogPath,
    branch: 'main',
    message: `worklog: agent run ${context.runId}`,
    content: Buffer.from(worklog).toString('base64'),
  })
  const worklogUrl = `https://github.com/${owner}/${repo}/blob/${publishedWorklog.data.commit.sha}/${worklogPath}`
  if (!issuePath) return
  const { data } = await github.rest.repos.getContent({ owner, repo, path: issuePath, ref: 'main' })
  if (Array.isArray(data) || data.type !== 'file') {
    core.setFailed(`Workbench issue is not a file: ${issuePath}`)
    return
  }
  let body = Buffer.from(data.content, 'base64').toString('utf8')
    .replace(/^updated_at:\s*.+$/m, `updated_at: ${now}`)
  if (!success) body = body.replace(/^status:\s*in_progress$/m, 'status: blocked')
  const progressOutcome = success
    ? `published feature branch \`${publishedBranch}\` at \`${publishedHead}\``
    : 'stopped before publishing a feature branch'
  const progress = `- ${now}: [Agent run ${context.runId}](${runUrl}) ${progressOutcome}; [worklog](${worklogUrl}).`
  body = body.replace(/^## Progress\s*$/m, `## Progress\n\n${progress}`)
  await github.rest.repos.createOrUpdateFileContents({
    owner,
    repo,
    path: issuePath,
    branch: 'main',
    sha: data.sha,
    message: `${success ? 'progress' : 'block'}: ${issuePath}`,
    content: Buffer.from(body).toString('base64'),
  })
}
