const MAIN_WORKFLOW_NAME = 'CI'
const MAIN_WORKFLOW_PATH = '.github/workflows/ci.yml'
const BaseCoverageArtifactKind = Object.freeze({
  Found: 'found',
  Unavailable: 'unavailable',
})

/** @param {string} baseSha */
function coverageArtifactName(baseSha) {
  if (!/^[0-9a-f]{40}$/.test(baseSha)) {
    throw new Error('baseSha must be a full lowercase Git commit SHA')
  }
  return `nook-core-auth-coverage-${baseSha}`
}

/**
 * @typedef {{ id: number, name: string, expired?: boolean, workflow_run?: { id?: number } }} Artifact
 * @typedef {{ path?: string, name?: string, head_branch?: string, head_sha?: string, event?: string, id: number }} WorkflowRun
 * @typedef {{ paginate: (request: unknown, options: { owner: string, repo: string, name: string, per_page: number }) => Promise<Artifact[]>, rest: { actions: { listArtifactsForRepo: unknown, getWorkflowRun: (options: { owner: string, repo: string, run_id: number }) => Promise<{ data: WorkflowRun }> } } }} GithubClient
 * @param {{ github: GithubClient, owner: string, repo: string, baseSha: string, defaultBranch: string }} request
 */
async function findBaseCoverageArtifact({
  github,
  owner,
  repo,
  baseSha,
  defaultBranch,
}) {
  const name = coverageArtifactName(baseSha)
  const artifacts = await github.paginate(
    github.rest.actions.listArtifactsForRepo,
    {
      owner,
      repo,
      name,
      per_page: 100,
    },
  )

  for (const artifact of artifacts.sort((a, b) => b.id - a.id)) {
    if (
      artifact.expired ||
      artifact.name !== name ||
      !artifact.workflow_run?.id
    ) {
      continue
    }

    const { data: run } = await github.rest.actions.getWorkflowRun({
      owner,
      repo,
      run_id: artifact.workflow_run.id,
    })
    const workflowPath = run.path?.replace(/@[^@]+$/, '')
    if (
      ((run.name === MAIN_WORKFLOW_NAME && workflowPath === MAIN_WORKFLOW_PATH) ||
        (run.name === 'Main' && workflowPath === '.github/workflows/main.yml')) &&
      run.head_branch === defaultBranch &&
      run.head_sha === baseSha &&
      run.event === 'push'
    ) {
      return {
        kind: BaseCoverageArtifactKind.Found,
        artifact: {
          artifactId: artifact.id,
          runId: run.id,
        },
      }
    }
  }

  return { kind: BaseCoverageArtifactKind.Unavailable }
}

module.exports = {
  BaseCoverageArtifactKind,
  coverageArtifactName,
  findBaseCoverageArtifact,
}
