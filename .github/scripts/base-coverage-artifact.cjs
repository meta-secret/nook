const MAIN_WORKFLOW_NAME = 'Main'
const MAIN_WORKFLOW_PATH = '.github/workflows/main.yml'

function coverageArtifactName(baseSha) {
  if (!/^[0-9a-f]{40}$/.test(baseSha)) {
    throw new Error('baseSha must be a full lowercase Git commit SHA')
  }
  return `nook-core-auth-coverage-${baseSha}`
}

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
      run.name === MAIN_WORKFLOW_NAME &&
      workflowPath === MAIN_WORKFLOW_PATH &&
      run.head_branch === defaultBranch &&
      run.head_sha === baseSha &&
      run.event === 'push'
    ) {
      return {
        artifactId: artifact.id,
        runId: run.id,
      }
    }
  }

  return
}

module.exports = {
  coverageArtifactName,
  findBaseCoverageArtifact,
}
