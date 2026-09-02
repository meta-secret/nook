const crypto = require('node:crypto')
const fs = require('node:fs')

const { validateAgentRecord } = require('./workbench-records.cjs')

const gizmoIdPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const issuePathPattern = /^issues\/[a-z0-9-]+\/[a-z0-9-]+\.md$/

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function escapeMarkdown(value) {
  return value.replace(/([\\`*_[\]<>])/g, '\\$1')
}

function parseGizmoName(candidate, currentGizmoId) {
  const pattern = new RegExp(
    `^1\\.\\s+Gizmo ID:\\s*${escapeRegExp(currentGizmoId)}\\s*;\\s*Gizmo name:\\s*(.+?)\\s*;\\s*Predecessor Gizmo ID:`,
    'im',
  )
  return pattern.exec(candidate)?.[1].trim() || ''
}

function safeCapabilityTitle(value) {
  const title = value.trim()
  return (
    title.length >= 3 &&
    title.length <= 120 &&
    !/[\u0000-\u001f\u007f]/u.test(title)
  )
}

function withWorklogUrl(currentBody, worklogPath, worklogUrl) {
  if (!/^## Workbench authority\s*$/m.test(currentBody)) {
    throw new Error('PR body is missing Workbench authority metadata')
  }
  if (currentBody.includes(worklogUrl)) return currentBody
  const line = `- Immutable worklog: [\`${worklogPath}\`](${worklogUrl})`
  return currentBody.replace(
    /^## Workbench authority\s*$/m,
    (heading) => `${heading}\n\n${line}`,
  )
}

function planRecord({
  candidate,
  currentGizmoId,
  issuePath,
  startedAt,
  title,
}) {
  return [
    '---',
    `title: ${JSON.stringify(title)}`,
    `feature: ${issuePath ? issuePath.split('/')[1] : 'unplanned'}`,
    `issue: ${issuePath || 'null'}`,
    `gizmo_id: ${currentGizmoId}`,
    `started_at: ${startedAt}`,
    'agent: cursor',
    '---',
    '',
    candidate,
    '',
  ].join('\n')
}

async function publishImmutablePlan({
  candidate,
  currentGizmoId,
  github,
  issuePath,
  owner,
  path,
  repo,
  startedAt,
  title,
  runId,
}) {
  const plan = planRecord({
    candidate,
    currentGizmoId,
    issuePath,
    startedAt,
    title,
  })
  await github.rest.repos.createOrUpdateFileContents({
    owner,
    repo,
    path,
    branch: 'main',
    message: `plan: agent run ${runId}`,
    content: Buffer.from(plan).toString('base64'),
  })
  return `https://github.com/${owner}/${repo}/blob/main/${path}`
}

function manualIssueRecord({
  currentGizmoId,
  markdownTitle,
  now,
  ownerLogin,
  runId,
  runUrl,
  taskStartUrl,
  supersedingUrl,
  title,
}) {
  return [
    '---',
    `title: ${JSON.stringify(title)}`,
    'status: in_progress',
    'priority: p2',
    'automation: agent',
    `owner: ${ownerLogin}`,
    `created_at: ${now}`,
    `updated_at: ${now}`,
    'source_issues: []',
    'related_prs: []',
    'depends_on: []',
    `gizmo_id: ${currentGizmoId}`,
    '---',
    '',
    `# ${markdownTitle}`,
    '',
    '## Context',
    '',
    'This focused issue is the public lifecycle authority for a manual Agent implement dispatch.',
    '',
    '## Outcome',
    '',
    `Deliver ${markdownTitle} through one bounded Nook pull request.`,
    '',
    '## Included scope',
    '',
    '- Implement the capability and acceptance evidence defined by the linked immutable plans.',
    '- Preserve repository ownership, security, validation, and exact-head delivery boundaries.',
    '',
    '## Excluded scope',
    '',
    '- Any capability outside the task-start and issue-bound superseding plans.',
    '- Any replacement issue, Gizmo identity, PR stack, or compatibility delivery path.',
    '',
    '## Acceptance criteria',
    '',
    '- [ ] The implementation satisfies both immutable plans and repository-owned validation.',
    '- [ ] The resulting PR remains assigned to the named continuing owner through merge.',
    '',
    '## Plans',
    '',
    `- [Task-start plan](${taskStartUrl})`,
    `- [Issue-bound superseding plan](${supersedingUrl})`,
    '',
    '## Progress',
    '',
    `<!-- agent-implement-run:${runId} -->`,
    `- ${now}: [Agent implement run ${runId}](${runUrl}) established this focused issue and canonical Gizmo ID.`,
    '',
    '## Findings and decisions',
    '',
    '- The private dispatch prompt is not published; the validated plans own the public task interpretation.',
    '',
  ].join('\n')
}

async function establishManualIssue({
  currentGizmoId,
  github,
  issuePath,
  markdownTitle,
  now,
  owner,
  ownerLogin,
  repo,
  runId,
  runUrl,
  taskStartUrl,
  supersedingUrl,
  title,
}) {
  const issue = manualIssueRecord({
    currentGizmoId,
    markdownTitle,
    now,
    ownerLogin,
    runId,
    runUrl,
    taskStartUrl,
    supersedingUrl,
    title,
  })
  const indexPath = issuePath.replace(/\/[^/]+$/, '/README.md')
  const issueName = issuePath.split('/').at(-1)
  const indexLine = `- [ ] [${markdownTitle}](${issueName})`
  const { data: reference } = await github.rest.git.getRef({
    owner,
    repo,
    ref: 'heads/main',
  })
  const head = reference.object.sha
  const { data: commit } = await github.rest.git.getCommit({
    owner,
    repo,
    commit_sha: head,
  })
  const readFile = async (path) => {
    try {
      const { data } = await github.rest.repos.getContent({
        owner,
        repo,
        path,
        ref: head,
      })
      if (Array.isArray(data) || data.type !== 'file') {
        throw new Error(`Workbench record is not a file: ${path}`)
      }
      return {
        exists: true,
        content: Buffer.from(data.content, 'base64').toString('utf8'),
      }
    } catch (error) {
      if (error.status === 404) return { exists: false, content: '' }
      throw error
    }
  }
  const indexFile = await readFile(indexPath)
  if (!indexFile.exists || !/^## Issues\s*$/m.test(indexFile.content)) {
    throw new Error(
      `Manual focused issue index is missing or malformed: ${indexPath}`,
    )
  }
  const index = indexFile.content
  const indexedIssues = index
    .slice(index.search(/^## Issues\s*$/m))
    .split(/\n## /)[0]
  const relatedIndexLines = index
    .split('\n')
    .filter(
      (line) =>
        line.endsWith(`](${issueName})`) ||
        line.includes(`[${markdownTitle}](`),
    )
  const exactIndexLines = indexedIssues
    .split('\n')
    .filter((line) => line === indexLine)
  const existingFile = await readFile(issuePath)
  const existing = existingFile.content
  let changes
  let message
  if (!existingFile.exists) {
    if (relatedIndexLines.length > 0) {
      throw new Error(
        `Manual focused issue index has a conflicting path or title: ${indexPath}`,
      )
    }
    if (!/^updated_at:\s*.+$/m.test(index)) {
      throw new Error(
        `Manual focused issue index has no mutable updated_at: ${indexPath}`,
      )
    }
    const timestampedIndex = index.replace(
      /^updated_at:\s*.+$/m,
      `updated_at: ${now}`,
    )
    const updatedIndex = timestampedIndex.replace(
      /^## Issues\s*$/m,
      (heading) => `${heading}\n\n${indexLine}`,
    )
    changes = { [indexPath]: updatedIndex, [issuePath]: issue }
    message = `issues: establish agent run ${runId}`
  } else {
    if (
      relatedIndexLines.length !== 1 ||
      exactIndexLines.length !== 1 ||
      relatedIndexLines[0] !== indexLine
    ) {
      throw new Error(
        `Manual focused issue index does not match this trusted run: ${indexPath}`,
      )
    }
    const frontmatter =
      existing.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)?.[1] || ''
    const exact =
      existing.includes(`<!-- agent-implement-run:${runId} -->`) &&
      /^automation:\s*agent$/m.test(frontmatter) &&
      new RegExp(`^owner:\\s*${escapeRegExp(ownerLogin)}$`, 'm').test(
        frontmatter,
      ) &&
      new RegExp(`^gizmo_id:\\s*${escapeRegExp(currentGizmoId)}$`, 'm').test(
        frontmatter,
      ) &&
      new RegExp(
        `^title:\\s*${escapeRegExp(JSON.stringify(title))}$`,
        'm',
      ).test(frontmatter)
    if (!exact) {
      throw new Error(
        `Existing manual focused issue does not match this trusted run: ${issuePath}`,
      )
    }
    if (/^status:\s*in_progress$/m.test(frontmatter)) return
    if (!/^status:\s*blocked$/m.test(frontmatter)) {
      throw new Error(
        `Existing manual focused issue is not retryable: ${issuePath}`,
      )
    }
    const progress = `- ${now}: [Agent implement run ${runId}](${runUrl}) reactivated this exact blocked issue for the same workflow run.`
    const reactivated = existing
      .replace(/^status:\s*blocked$/m, 'status: in_progress')
      .replace(/^updated_at:\s*.+$/m, `updated_at: ${now}`)
      .replace(/^## Progress\s*$/m, `## Progress\n\n${progress}`)
    changes = { [issuePath]: reactivated }
    message = `retry: ${issuePath}`
  }
  const tree = await Promise.all(
    Object.entries(changes).map(async ([path, content]) => {
      const { data } = await github.rest.git.createBlob({
        owner,
        repo,
        content,
        encoding: 'utf-8',
      })
      return { path, mode: '100644', type: 'blob', sha: data.sha }
    }),
  )
  const { data: updatedTree } = await github.rest.git.createTree({
    owner,
    repo,
    base_tree: commit.tree.sha,
    tree,
  })
  const { data: updatedCommit } = await github.rest.git.createCommit({
    owner,
    repo,
    message,
    tree: updatedTree.sha,
    parents: [head],
  })
  await github.rest.git.updateRef({
    owner,
    repo,
    ref: 'heads/main',
    sha: updatedCommit.sha,
    force: false,
  })
}

function appendPrEnvironment({ body, title }) {
  const delimiter = `AGENT_METADATA_${crypto.randomBytes(32).toString('hex')}`
  if ([title, body].some((value) => value.split('\n').includes(delimiter))) {
    throw new Error('Failed to construct collision-safe PR metadata.')
  }
  fs.appendFileSync(
    process.env.GITHUB_ENV,
    [
      `AGENT_PR_TITLE<<${delimiter}`,
      title,
      delimiter,
      `AGENT_COMMIT_MESSAGE<<${delimiter}`,
      title,
      delimiter,
      `AGENT_PR_BODY<<${delimiter}`,
      body,
      delimiter,
      '',
    ].join('\n'),
  )
}

async function publishTrustedPlan({ core, context, github }) {
  const [owner, repo] = process.env.WORKBENCH_REPOSITORY.split('/')
  const taskStartPath = process.env.TASK_PLAN_PATH
  const localPath = `${process.env.GITHUB_WORKSPACE}/${process.env.WORKBENCH_PLAN_FILE}`
  const summaryPath = `${process.env.GITHUB_WORKSPACE}/${process.env.WORKBENCH_SUMMARY_FILE}`
  const secrets = [process.env.CURSOR_SECRET]
  const claimedIssuePath = String(process.env.ISSUE_PATH || '').trim()
  const claimedIssueTitle = String(process.env.ISSUE_TITLE || '').trim()
  const assignedGizmoId = String(process.env.ASSIGNED_GIZMO_ID || '').trim()
  const continuingOwner = String(
    process.env.CONTINUING_AGENT_OWNER || '',
  ).trim()
  core.setOutput('issue_path', claimedIssuePath)
  core.setOutput('issue_title', claimedIssueTitle)
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(continuingOwner)) {
    throw new Error('Trusted PR publication requires a continuing GitHub owner')
  }
  const permission = await github.rest.repos.getCollaboratorPermissionLevel({
    ...context.repo,
    username: continuingOwner,
  })
  if (!['admin', 'maintain', 'write'].includes(permission.data.permission)) {
    throw new Error(`${continuingOwner} must have write access to Nook`)
  }
  if (!fs.existsSync(localPath)) {
    if (!fs.existsSync(summaryPath)) {
      throw new Error(
        'Planning produced neither a plan nor a planning blocker.',
      )
    }
    const blocker = fs.readFileSync(summaryPath, 'utf8').trim()
    const rejection = validateAgentRecord(
      blocker,
      'worklog',
      secrets,
      process.env.AGENT_PROMPT,
    )
    if (rejection) throw new Error(`Rejected planning blocker: ${rejection}.`)
    core.setOutput('planning_blocked', 'true')
    return
  }
  const candidate = fs.readFileSync(localPath, 'utf8').trim()
  const sourceTask = process.env.AGENT_PROMPT
  const rejection = validateAgentRecord(
    candidate,
    'plan',
    secrets,
    sourceTask,
    {
      assignedGizmoId,
    },
  )
  if (rejection) {
    throw new Error(
      `Rejected agent-authored Workbench task plan: ${rejection}.`,
    )
  }
  const validatedPlan = `${candidate}\n`
  fs.writeFileSync(localPath, validatedPlan, { encoding: 'utf8', mode: 0o600 })
  core.setOutput(
    'sha256',
    crypto.createHash('sha256').update(validatedPlan).digest('hex'),
  )
  const currentGizmoId =
    /^- Current Gizmo ID:\s*([a-z0-9]+(?:-[a-z0-9]+)*)\s*$/m.exec(
      candidate,
    )?.[1] || ''
  if (!gizmoIdPattern.test(currentGizmoId)) {
    throw new Error('Validated plan is missing its Current Gizmo ID.')
  }
  const gizmoName = parseGizmoName(candidate, currentGizmoId)
  const trustedTitle = claimedIssuePath ? claimedIssueTitle : gizmoName
  if (!safeCapabilityTitle(trustedTitle)) {
    throw new Error(
      'Validated task context is missing a safe capability title.',
    )
  }
  const bindingRejection = validateAgentRecord(
    candidate,
    'plan',
    secrets,
    sourceTask,
    { assignedGizmoId: currentGizmoId },
  )
  if (bindingRejection) {
    throw new Error(
      `Rejected plan binding for canonical Gizmo ID: ${bindingRejection}.`,
    )
  }
  const runId = context.runId
  const runUrl = `${context.serverUrl}/${context.repo.owner}/${context.repo.repo}/actions/runs/${runId}`
  const startedAt = process.env.TASK_PLAN_STARTED_AT
  const markdownTitle = escapeMarkdown(trustedTitle)
  let issuePath = claimedIssuePath
  let taskStartUrl
  let supersedingPath = ''
  let supersedingUrl = ''
  if (issuePath) {
    taskStartUrl = await publishImmutablePlan({
      candidate,
      currentGizmoId,
      github,
      issuePath,
      owner,
      path: taskStartPath,
      repo,
      startedAt,
      title: trustedTitle,
      runId,
    })
  } else {
    taskStartUrl = await publishImmutablePlan({
      candidate,
      currentGizmoId,
      github,
      issuePath: '',
      owner,
      path: taskStartPath,
      repo,
      startedAt,
      title: trustedTitle,
      runId,
    })
    issuePath = `issues/unplanned/run-${runId}.md`
    supersedingPath = taskStartPath.replace(/\.md$/, '-issue-bound.md')
    supersedingUrl = `https://github.com/${owner}/${repo}/blob/main/${supersedingPath}`
    await establishManualIssue({
      currentGizmoId,
      github,
      issuePath,
      markdownTitle,
      now: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
      owner,
      ownerLogin: continuingOwner,
      repo,
      runId,
      runUrl,
      taskStartUrl,
      supersedingUrl,
      title: trustedTitle,
    })
    core.setOutput('issue_path', issuePath)
    core.setOutput('issue_title', trustedTitle)
    supersedingUrl = await publishImmutablePlan({
      candidate,
      currentGizmoId,
      github,
      issuePath,
      owner,
      path: supersedingPath,
      repo,
      startedAt,
      title: trustedTitle,
      runId,
    })
  }
  const currentPlanPath = supersedingPath || taskStartPath
  const currentPlanUrl = supersedingUrl || taskStartUrl
  const issueUrl = `https://github.com/${owner}/${repo}/blob/main/${issuePath}`
  const taskName = claimedIssuePath
    ? markdownTitle
    : 'unavailable (manual prompt dispatch has no trusted task-name input)'
  const authority = [
    `- Focused issue: [\`${issuePath}\`](${issueUrl})`,
    `- Task-start plan: [\`${taskStartPath}\`](${taskStartUrl})`,
  ]
  if (supersedingPath) {
    authority.push(
      `- Superseding issue-bound plan: [\`${supersedingPath}\`](${supersedingUrl})`,
    )
  }
  const prBody = [
    '## Summary',
    '',
    `Automated implementation of ${markdownTitle}.`,
    '',
    '## Agent-task provenance',
    '',
    '- Harness: GitHub Actions trusted publisher',
    `- Task name: ${taskName}`,
    `- Capability: ${markdownTitle}`,
    `- Opaque task ID: [workflow run ${runId}](${runUrl})`,
    `- Gizmo ID: \`${currentGizmoId}\``,
    '',
    '## Workbench authority',
    '',
    ...authority,
    '',
    '## Ownership',
    '',
    `Continuing agent: \`${continuingOwner}\``,
    '',
    '## Test plan',
    '',
    '- [ ] CI green on this PR',
  ].join('\n')
  appendPrEnvironment({ body: prBody, title: trustedTitle })
  core.setOutput('path', currentPlanPath)
  core.setOutput('url', currentPlanUrl)
  core.setOutput('task_start_path', taskStartPath)
  core.setOutput('task_start_url', taskStartUrl)
  core.setOutput('superseding_path', supersedingPath)
  core.setOutput('superseding_url', supersedingUrl)
  core.setOutput('issue_path', issuePath)
  core.setOutput('issue_url', issueUrl)
  core.setOutput('issue_title', trustedTitle)
  core.setOutput('gizmo_id', currentGizmoId)
}

async function publishTrustedResult({ core, context, github }) {
  const [owner, repo] = process.env.WORKBENCH_REPOSITORY.split('/')
  const issuePath = String(process.env.ISSUE_PATH || '').trim()
  const feature = issuePath ? issuePath.split('/')[1] : 'unplanned'
  const now = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')
  const timestamp = now.replaceAll('-', '').replaceAll(':', '')
  const runUrl = `${context.serverUrl}/${context.repo.owner}/${context.repo.repo}/actions/runs/${context.runId}`
  const pulls = await github.rest.pulls.list({
    ...context.repo,
    state: 'open',
    head: `${context.repo.owner}:${process.env.AGENT_BRANCH}`,
  })
  const { data: workflowRun } = await github.rest.actions.getWorkflowRun({
    ...context.repo,
    run_id: context.runId,
  })
  const pull = pulls.data[0]
  const success = process.env.IMPLEMENT_OUTCOME === 'success' && Boolean(pull)
  if (success) {
    const continuingOwner = process.env.CONTINUING_AGENT_OWNER
    await github.rest.issues.addAssignees({
      ...context.repo,
      issue_number: pull.number,
      assignees: [continuingOwner],
    })
    const { data: assignedPull } = await github.rest.issues.get({
      ...context.repo,
      issue_number: pull.number,
    })
    const assignees = Array.isArray(assignedPull.assignees)
      ? assignedPull.assignees
      : []
    const assigned = assignees.some(
      ({ login }) => login.toLowerCase() === continuingOwner.toLowerCase(),
    )
    if (!assigned) throw new Error(`Failed to assign PR #${pull.number}`)
    await github.rest.issues.createComment({
      ...context.repo,
      issue_number: pull.number,
      body: `@${continuingOwner} this workflow assigned you PR #${pull.number}. Continue only this PR's recorded scope through review, exact-head validation, and squash merge.`,
    })
  }
  const implementationSummaryPath = `${process.env.IMPLEMENTATION_REPO_ROOT}/${process.env.WORKBENCH_SUMMARY_FILE}`
  const planningSummaryPath = `${process.env.GITHUB_WORKSPACE}/${process.env.WORKBENCH_SUMMARY_FILE}`
  const implementationSummaryExists = fs.existsSync(implementationSummaryPath)
  if (implementationSummaryExists) {
    const artifact = fs.lstatSync(implementationSummaryPath)
    if (
      !artifact.isFile() ||
      artifact.isSymbolicLink() ||
      artifact.size > 65536
    ) {
      throw new Error('Rejected unsafe implementation worklog artifact.')
    }
  }
  const summaryPath = implementationSummaryExists
    ? implementationSummaryPath
    : planningSummaryPath
  let summary = [
    '# Automated agent work summary',
    '',
    '## Outcome',
    '',
    success
      ? `Opened Nook PR [#${pull.number}](${pull.html_url}).`
      : 'The bounded implementation run did not open a pull request.',
    '',
    '## Progress',
    '',
    '- See the linked workflow run for the execution boundary.',
    '',
    '## Implementation problems',
    '',
    success
      ? '- No problem summary was emitted by the bounded worker.'
      : '- The workflow or agent stopped before a pull request was opened.',
    '',
    '## Decisions',
    '',
    '- None recorded.',
    '',
    '## Validation',
    '',
    `- [Trusted publisher run ${context.runId}](${runUrl})`,
    '',
    '## Remaining work',
    '',
    success
      ? `- GitHub assigned and notified continuing owner \`${process.env.CONTINUING_AGENT_OWNER}\` for validation and merge.`
      : '- Inspect the workflow failure and return the issue to ready after correcting the blocker.',
  ].join('\n')
  if (fs.existsSync(summaryPath)) {
    const candidate = fs.readFileSync(summaryPath, 'utf8').trim()
    const rejection = validateAgentRecord(
      candidate,
      'worklog',
      [process.env.CURSOR_SECRET, process.env.NOOK_SECRET],
      process.env.AGENT_PROMPT,
    )
    if (rejection) {
      core.warning(`Rejected agent-authored Workbench summary: ${rejection}`)
    } else {
      summary = candidate
    }
  }
  const budgetBlocker = process.env.BUDGET_BLOCKER_B64
    ? Buffer.from(process.env.BUDGET_BLOCKER_B64, 'base64').toString('utf8')
    : ''
  const budgetMatch = budgetBlocker.match(
    /^Implemented diff exceeds the 2000 authored-addition budget: (\d+)$/,
  )
  if (budgetMatch) {
    summary = [
      '# Automated agent work summary',
      '',
      '## Outcome',
      '',
      `Blocked before publication: trusted formatting measured ${budgetMatch[1]} authored additions, above the limit.`,
      '',
      '## Progress',
      '',
      '- No implementation branch or PR was published.',
      '',
      '## Implementation problems',
      '',
      `- ${budgetBlocker}.`,
      '',
      '## Decisions',
      '',
      '- Delivery stopped without creating another PR.',
      '',
      '## Validation',
      '',
      `- [Trusted publisher run ${context.runId}](${runUrl})`,
      '',
      '## Remaining work',
      '',
      '- Re-scope or simplify before returning the issue to ready.',
    ].join('\n')
  }
  const worklogPath = `worklogs/${feature}/${timestamp}-run-${context.runId}.md`
  const worklog = [
    '---',
    `title: ${JSON.stringify(process.env.ISSUE_TITLE || `Agent run ${context.runId}`)}`,
    `feature: ${feature}`,
    `issue: ${issuePath || 'null'}`,
    `plan: ${process.env.PLAN_PATH || 'null'}`,
    `nook_pr: ${pull?.html_url || 'null'}`,
    `status: ${success ? 'in_progress' : 'blocked'}`,
    `started_at: ${workflowRun.created_at || now}`,
    `finished_at: ${now}`,
    'agent: cursor',
    '---',
    '',
    summary,
    '',
  ].join('\n')
  await github.rest.repos.createOrUpdateFileContents({
    owner,
    repo,
    path: worklogPath,
    branch: 'main',
    message: `worklog: agent run ${context.runId}`,
    content: Buffer.from(worklog).toString('base64'),
  })
  const worklogUrl = `https://github.com/${owner}/${repo}/blob/main/${worklogPath}`
  if (pull) {
    const { data: currentPull } = await github.rest.pulls.get({
      ...context.repo,
      pull_number: pull.number,
    })
    const currentBody = currentPull.body || ''
    const issueUrl = `https://github.com/${owner}/${repo}/blob/main/${issuePath}`
    const planUrl = `https://github.com/${owner}/${repo}/blob/main/${process.env.PLAN_PATH}`
    if (
      !currentBody.includes('## Agent-task provenance') ||
      !currentBody.includes(issueUrl) ||
      !currentBody.includes(planUrl)
    ) {
      throw new Error(
        `PR #${pull.number} is missing trusted publication metadata`,
      )
    }
    const body = withWorklogUrl(currentBody, worklogPath, worklogUrl)
    if (body !== currentBody) {
      await github.rest.pulls.update({
        ...context.repo,
        pull_number: pull.number,
        body,
      })
    }
  }
  if (!issuePath) return
  const { data } = await github.rest.repos.getContent({
    owner,
    repo,
    path: issuePath,
    ref: 'main',
  })
  if (Array.isArray(data) || data.type !== 'file') {
    throw new Error(`Workbench issue is not a file: ${issuePath}`)
  }
  let issue = Buffer.from(data.content, 'base64')
    .toString('utf8')
    .replace(/^updated_at:\s*.+$/m, `updated_at: ${now}`)
  if (!success)
    issue = issue.replace(/^status:\s*in_progress$/m, 'status: blocked')
  if (pull) {
    issue = issue.replace(/^related_prs:\s*\[(.*)\]$/m, (line, entries) => {
      if (entries.includes(pull.html_url)) return line
      return `related_prs: [${entries.trim()}${entries.trim() ? ', ' : ''}${JSON.stringify(pull.html_url)}]`
    })
  }
  const outcome = success
    ? `opened [Nook PR #${pull.number}](${pull.html_url})`
    : 'stopped before opening a PR'
  const progress = `- ${now}: [Trusted publisher run ${context.runId}](${runUrl}) ${outcome}; [worklog](${worklogUrl}).`
  issue = issue.replace(/^## Progress\s*$/m, `## Progress\n\n${progress}`)
  await github.rest.repos.createOrUpdateFileContents({
    owner,
    repo,
    path: issuePath,
    branch: 'main',
    sha: data.sha,
    message: `${success ? 'progress' : 'block'}: ${issuePath}`,
    content: Buffer.from(issue).toString('base64'),
  })
}

module.exports = {
  establishManualIssue,
  escapeMarkdown,
  manualIssueRecord,
  parseGizmoName,
  publishTrustedPlan,
  publishTrustedResult,
  safeCapabilityTitle,
  withWorklogUrl,
}
