'use strict'

/** @type {(moduleName: string) => unknown} */
const loadBuiltin = /** @type {(moduleName: string) => unknown} */ (process.getBuiltinModule.bind(process))
/** @type {typeof import('node:module')} */
const moduleApi = /** @type {typeof import('node:module')} */ (loadBuiltin('node:module'))
const moduleLoader = moduleApi.createRequire(__filename)

/** @type {typeof import('node:fs')} */
const fs = /** @type {typeof import('node:fs')} */ (loadBuiltin('node:fs'))
/** @typedef {(candidate: string, kind: string, secrets?: string[], sourceTask?: string, metadata?: { assignedGizmoId?: string }) => string} ValidateAgentRecord */

/**
 * @typedef {{ created_at: string }} GithubWorkflowRun
 * @typedef {{ data: GithubWorkflowRun }} GithubWorkflowRunResponse
 * @typedef {{ data: { commit: { sha: string } } }} GithubPublishedFileResponse
 * @typedef {{ type: string, content: string, sha: string }} GithubFileContent
 * @typedef {{ data: GithubFileContent | unknown[] }} GithubContentResponse
 * @typedef {{ owner: string, repo: string, run_id: number }} WorkflowRunRequest
 * @typedef {{ owner: string, repo: string, path: string, ref: string }} GetContentRequest
 * @typedef {{ owner: string, repo: string, path: string, branch: string, message: string, content: string, sha?: string }} UpdateFileRequest
 * @typedef {{
 *   rest: {
 *     actions: {
 *       getWorkflowRun: (request: WorkflowRunRequest) => Promise<GithubWorkflowRunResponse>
 *     },
 *     repos: {
 *       createOrUpdateFileContents: (request: UpdateFileRequest) => Promise<GithubPublishedFileResponse>,
 *       getContent: (request: GetContentRequest) => Promise<GithubContentResponse>
 *     }
 *   }
 * }} GithubScriptClient
 * @typedef {{ serverUrl: string, repo: { owner: string, repo: string }, runId: number }} GithubScriptContext
 * @typedef {{ setFailed: (message: string) => void, warning: (message: string) => void }} GithubScriptCore
 * @typedef {{
 *   WORKBENCH_REPOSITORY: string,
 *   ISSUE_PATH: string,
 *   AGENT_PROMPT: string,
 *   IMPLEMENTATION_REPO_ROOT: string,
 *   GITHUB_WORKSPACE: string,
 *   WORKBENCH_SUMMARY_FILE: string,
 *   IMPLEMENT_OUTCOME: string,
 *   FEATURE_BRANCH: string,
 *   PUBLISHED_BRANCH: string,
 *   PUBLISHED_HEAD_SHA: string,
 *   ORIGIN_MAIN_SHA: string,
 *   PINNED_LOCAL_DEV_SHA: string,
 *   FEATURE_HEAD_SHA: string,
 *   CURSOR_SECRET: string,
 *   NOOK_SECRET: string,
 *   BUDGET_BLOCKER_B64: string,
 *   ISSUE_TITLE: string,
 *   PLAN_PATH: string
 * }} AgentImplementEnvironment
 */

/**
 * Owns publication of the trusted Workbench result and progress of its
 * claimed issue. The GitHub Script runtime supplies the authenticated API
 * client and execution context; all other inputs remain workflow environment.
 */
class AgentImplementWorkbenchPublisher {
  /**
   * @param {{ github: GithubScriptClient, context: GithubScriptContext, core: GithubScriptCore }} runtime
   */
  constructor({ github, context, core }) {
    this.github = github
    this.context = context
    this.core = core
    /** @type {{ validateAgentRecord: ValidateAgentRecord }} */
    this.recordsModule = AgentImplementWorkbenchPublisher.loadModule('./workbench-records.cjs')
    /** @type {AgentImplementEnvironment} */
    this.environment = this.readEnvironment(process.env)
  }

  /**
   * @template T
   * @param {string} modulePath
   * @returns {T}
   */
  static loadModule(modulePath) {
    const loaded = /** @type {unknown} */ (moduleLoader(modulePath))
    if (!loaded || typeof loaded !== 'object') {
      throw new Error('module has an invalid contract')
    }
    return /** @type {T} */ (loaded)
  }

  /**
   * @param {{ value: unknown, name: string }} input
   * @returns {string}
   */
  requireEnvironmentValue({ value, name }) {
    if (typeof value !== 'string') {
      throw new Error(`Missing required workflow environment value: ${name}`)
    }
    return value
  }

  /**
   * @param {{ value: unknown }} input
   * @returns {string}
   */
  optionalEnvironmentValue({ value }) {
    return typeof value === 'string' ? value : ''
  }

  /**
   * @param {NodeJS.ProcessEnv} source
   * @returns {AgentImplementEnvironment}
   */
  readEnvironment(source) {
    return {
      WORKBENCH_REPOSITORY: this.requireEnvironmentValue({
        value: source.WORKBENCH_REPOSITORY,
        name: 'WORKBENCH_REPOSITORY',
      }),
      ISSUE_PATH: this.requireEnvironmentValue({
        value: source.ISSUE_PATH,
        name: 'ISSUE_PATH',
      }),
      AGENT_PROMPT: this.requireEnvironmentValue({
        value: source.AGENT_PROMPT,
        name: 'AGENT_PROMPT',
      }),
      IMPLEMENTATION_REPO_ROOT: this.requireEnvironmentValue({
        value: source.IMPLEMENTATION_REPO_ROOT,
        name: 'IMPLEMENTATION_REPO_ROOT',
      }),
      GITHUB_WORKSPACE: this.requireEnvironmentValue({
        value: source.GITHUB_WORKSPACE,
        name: 'GITHUB_WORKSPACE',
      }),
      WORKBENCH_SUMMARY_FILE: this.requireEnvironmentValue({
        value: source.WORKBENCH_SUMMARY_FILE,
        name: 'WORKBENCH_SUMMARY_FILE',
      }),
      IMPLEMENT_OUTCOME: this.requireEnvironmentValue({
        value: source.IMPLEMENT_OUTCOME,
        name: 'IMPLEMENT_OUTCOME',
      }),
      FEATURE_BRANCH: this.requireEnvironmentValue({
        value: source.FEATURE_BRANCH,
        name: 'FEATURE_BRANCH',
      }),
      PUBLISHED_BRANCH: this.requireEnvironmentValue({
        value: source.PUBLISHED_BRANCH,
        name: 'PUBLISHED_BRANCH',
      }),
      PUBLISHED_HEAD_SHA: this.requireEnvironmentValue({
        value: source.PUBLISHED_HEAD_SHA,
        name: 'PUBLISHED_HEAD_SHA',
      }),
      ORIGIN_MAIN_SHA: this.requireEnvironmentValue({
        value: source.ORIGIN_MAIN_SHA,
        name: 'ORIGIN_MAIN_SHA',
      }),
      PINNED_LOCAL_DEV_SHA: this.requireEnvironmentValue({
        value: source.PINNED_LOCAL_DEV_SHA,
        name: 'PINNED_LOCAL_DEV_SHA',
      }),
      FEATURE_HEAD_SHA: this.requireEnvironmentValue({
        value: source.FEATURE_HEAD_SHA,
        name: 'FEATURE_HEAD_SHA',
      }),
      CURSOR_SECRET: this.optionalEnvironmentValue({ value: source.CURSOR_SECRET }),
      NOOK_SECRET: this.optionalEnvironmentValue({ value: source.NOOK_SECRET }),
      BUDGET_BLOCKER_B64: this.optionalEnvironmentValue({ value: source.BUDGET_BLOCKER_B64 }),
      ISSUE_TITLE: this.optionalEnvironmentValue({ value: source.ISSUE_TITLE }),
      PLAN_PATH: this.optionalEnvironmentValue({ value: source.PLAN_PATH }),
    }
  }

  /**
   * Publish the trusted Workbench worklog and, for issue-backed runs, progress
   * the claimed issue.
   *
   * @returns {Promise<void>}
   */
  async publish() {
    const { github, context, core, environment: env } = this
  const repositoryParts = env.WORKBENCH_REPOSITORY.split('/')
  const owner = repositoryParts[0]
  const repo = repositoryParts[1]
  if (
    repositoryParts.length !== 2 ||
    typeof owner !== 'string' ||
    typeof repo !== 'string' ||
    !owner ||
    !repo
  ) {
    throw new Error('WORKBENCH_REPOSITORY must use the owner/repository form')
  }
  const issuePath = env.ISSUE_PATH.trim()
  const feature = issuePath ? issuePath.split('/')[1] : 'unplanned'
  const now = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')
  const timestamp = now.replaceAll('-', '').replaceAll(':', '')
  const runUrl = `${context.serverUrl}/${context.repo.owner}/${context.repo.repo}/actions/runs/${context.runId}`
  const { data: workflowRun } = await github.rest.actions.getWorkflowRun({
    ...context.repo,
    run_id: context.runId,
  })
  const featureBranch = env.FEATURE_BRANCH.trim()
  const publishedBranch = env.PUBLISHED_BRANCH.trim()
  const publishedHead = env.PUBLISHED_HEAD_SHA.trim()
  const success = env.IMPLEMENT_OUTCOME === 'success' &&
    /^[0-9a-f]{40}$/.test(publishedHead) &&
    Boolean(featureBranch) && publishedBranch === featureBranch
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
  if (!fs.existsSync(summaryPath)) {
    core.setFailed('Required Workbench summary artifact is missing.')
    return
  }
  const artifact = fs.lstatSync(summaryPath)
  if (!artifact.isFile() || artifact.isSymbolicLink() || artifact.size > 65536) {
    core.setFailed('Rejected unsafe Workbench summary artifact.')
    return
  }
  const candidate = fs.readFileSync(summaryPath, 'utf8').trim()
  const secrets = [env.CURSOR_SECRET, env.NOOK_SECRET]
  const rejection = this.recordsModule.validateAgentRecord(
    candidate,
    'worklog',
    secrets,
    env.AGENT_PROMPT,
  )
  if (rejection) {
    core.setFailed(`Rejected agent-authored Workbench summary: ${rejection}`)
    return
  }
  let summary = candidate
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
    `featureBranch: ${featureBranch || 'null'}`,
    // This run-start observation is evidence only; the branch name remains authoritative.
    `featureHeadSha: ${env.FEATURE_HEAD_SHA || 'null'}`,
    `publishedFeatureSha: ${publishedHead || 'null'}`,
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
    ? `published canonical feature branch \`${featureBranch}\` at observed head \`${publishedHead}\``
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
}

module.exports = AgentImplementWorkbenchPublisher
