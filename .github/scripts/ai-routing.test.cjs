const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { resolve } = require('node:path')
const test = require('node:test')

const root = resolve(__dirname, '../..')
const research = readFileSync(resolve(root, '.github/workflows/web-research.yml'), 'utf8')
const policy = readFileSync(resolve(root, '.github/workflows/repository-policy.yml'), 'utf8')
const obsolete = readFileSync(resolve(root, '.github/workflows/pr-obsolete-validation.yml'), 'utf8')
const main = readFileSync(resolve(root, '.github/workflows/main.yml'), 'utf8')
const ecosystem = readFileSync(resolve(root, '.github/workflows/rust-ecosystem.yml'), 'utf8')

const FrontierKind = Object.freeze({ found: 'found', unavailable: 'unavailable' })
const unavailableFrontier = () => ({ kind: FrontierKind.unavailable })
const fullPolicyRun = (sha) => ({
  sha,
  valid: true,
  sentinel: 'success',
})
const lightweightPolicyRun = (sha) => ({
  sha,
  valid: true,
  sentinel: 'skipped',
})
const policyFrontier = (runs) => {
  for (const run of runs) {
    if (!run.valid) return unavailableFrontier()
    if (run.sentinel === 'success') {
      return { kind: FrontierKind.found, sha: run.sha }
    }
    if (run.sentinel !== 'skipped') return unavailableFrontier()
  }
  return unavailableFrontier()
}

const policyJobInventory = (pages) => {
  let expectedCount = 0
  let receivedCount = 0
  for (const page of pages) {
    if (!Number.isSafeInteger(page.totalCount) || page.totalCount <= 0) return 'invalid'
    if (expectedCount !== 0 && page.totalCount !== expectedCount) return 'count-mismatch'
    expectedCount = page.totalCount
    receivedCount += page.jobs
  }
  return receivedCount === expectedCount ? 'complete' : 'count-mismatch'
}

const mainFrontiers = (runs) => {
  let product = ''
  let ecosystem = ''
  for (const run of runs) {
    if (!run.valid || !['success', 'skipped'].includes(run.product) || !['success', 'skipped'].includes(run.ecosystem)) return unavailableFrontier()
    if (!product && run.product === 'success') product = run.sha
    if (!ecosystem && run.ecosystem === 'success') ecosystem = run.sha
    if (product && ecosystem) return { kind: FrontierKind.found, product, ecosystem }
  }
  return unavailableFrontier()
}

test('repository policy frontier preserves canceled and failed full validation', () => {
  assert.deepEqual(policyFrontier([lightweightPolicyRun('DOCS'), fullPolicyRun('FULL')]), {
    kind: FrontierKind.found,
    sha: 'FULL',
  })
  for (const accumulated of [
    ['.codex/config.toml', '.cortex/teams/sre/notes.md'],
    ['.codex/config.toml', '.cortex/one.md', '.cortex/two.md'],
  ]) {
    assert.equal(accumulated.every((path) => path.startsWith('.cortex/') && path.endsWith('.md')), false)
  }
  assert.deepEqual(policyFrontier([{ ...fullPolicyRun('FAILED'), sentinel: 'failure' }]), {
    kind: FrontierKind.unavailable,
  })
  assert.deepEqual(policyFrontier([fullPolicyRun('LATEST')]), {
    kind: FrontierKind.found,
    sha: 'LATEST',
  })
  assert.equal(
    ['.cortex/one.md', '.cortex/two.md'].every(
      (path) => path.startsWith('.cortex/') && path.endsWith('.md'),
    ),
    true,
  )
})

test('repository policy frontier rejects cross-page job-count drift', () => {
  assert.equal(policyJobInventory([{ totalCount: 150, jobs: 100 }, { totalCount: 100, jobs: 0 }]), 'count-mismatch')
  assert.equal(policyJobInventory([{ totalCount: 150, jobs: 100 }, { totalCount: 150, jobs: 50 }]), 'complete')
  assert.equal(policyJobInventory([{ jobs: 100 }]), 'invalid')
})

const researchRequired = (files, expectedCount) => {
  if (files.length === 0 || files.length !== expectedCount || files.length >= 3000) return true
  const statuses = new Set(['added', 'removed', 'modified', 'renamed', 'copied', 'changed', 'unchanged'])
  const paths = []
  for (const file of files) {
    if (!statuses.has(file.status) || !file.filename) return true
    if (file.status === 'renamed') {
      if (!file.previous_filename) return true
      paths.push(file.previous_filename)
    }
    paths.push(file.filename)
  }
  return paths.some(
    (path) =>
      path === '.github/workflows/web-research.yml' ||
      path.startsWith('nook-app/nook-web/nook-web-research/'),
  )
}

test('web research routing expands renames and fails closed', () => {
  assert.equal(researchRequired([{ filename: '.cortex/new.md', previous_filename: 'nook-app/nook-web/nook-web-research/src/old.ts', status: 'renamed' }], 1), true)
  assert.equal(researchRequired([{ filename: 'nook-app/nook-web/nook-web-research/src/new.ts', previous_filename: '.cortex/old.md', status: 'renamed' }], 1), true)
  assert.equal(researchRequired([{ filename: '.cortex/new.md', previous_filename: '.codex/old.md', status: 'renamed' }], 1), false)
  assert.equal(researchRequired([{ filename: 'nook-app/src/lib.ts', status: 'modified' }], 2), true)
  assert.equal(researchRequired([{ filename: '.cortex/a.md', status: 'mystery' }], 1), true)
  assert.equal(
    researchRequired(
      Array.from({ length: 3000 }, (_, index) => ({ filename: `.cortex/${index}.md`, status: 'modified' })),
      3000,
    ),
    true,
  )
})

test('workflow sources enforce frontier and hosted classifier contracts', () => {
  const pullRequestTrigger = research.split('  push:')[0]
  assert.doesNotMatch(pullRequestTrigger, /\n    paths:/)
  const classifier = research.split('  research-paths:')[1].split('\n  validate-untrusted:')[0]
  assert.match(classifier, /runs-on: ubuntu-latest/)
  assert.match(classifier, /permissions:\n      contents: read\n      pull-requests: read/)
  assert.doesNotMatch(classifier, /secrets\.|actions\/checkout/)
  for (const marker of ['changed_files', 'files.length >= 3000', 'supportedStatuses', 'previous_filename']) {
    assert.match(classifier, new RegExp(marker.replace('.', '\\.')))
  }
  assert.match(research, /validate-untrusted:[\s\S]*needs: research-paths[\s\S]*needs\.research-paths\.outputs\.research-required == 'true'/)
  assert.match(research, /image:[\s\S]*needs: research-paths[\s\S]*needs\.research-paths\.outputs\.research-required == 'true'/)
  assert.match(research, /deploy:[\s\S]*needs: image/)

  assert.match(policy, /policy-paths:[\s\S]*runs-on: ubuntu-latest/)
  assert.match(policy, /types: \[opened, synchronize, reopened, edited\]/)
  assert.match(policy, /context\.payload\.changes\?\.base\?\.ref\?\.from/)
  assert.match(policy, /if \(!baseRetargeted\) return/)
  assert.match(policy, /if: needs\.policy-paths\.outputs\.policy_required == 'true'/)
  assert.match(policy, /github\.event\.action == 'edited' && github\.run_id/)
  assert.match(obsolete, /repository-policy\.yml/)
  assert.match(policy, /permissions:\n      actions: read\n      contents: read\n      pull-requests: read/)
  assert.match(policy, /listWorkflowRunsForWorkflow/)
  assert.match(policy, /Full repository policy validation sentinel/)
  assert.match(policy, /rawExpectedCount !== expectedCount/)
  assert.match(policy, /JobInventoryState\.CountMismatch/)
  assert.match(policy, /git diff --no-renames --name-only "\$FRONTIER_SHA" "\$AFTER_SHA"/)
  for (const marker of [
    'context.payload.pull_request.changed_files',
    'files.length >= 3000',
    'new Set(Object.values(PullRequestFileStatus))',
    'file.status === PullRequestFileStatus.Renamed',
    'file.previous_filename',
  ]) {
    assert.equal(policy.includes(marker), true)
  }
  assert.match(policy, /npm test --prefix agentic-ai\/ci-agent/)
  assert.match(policy, /npm ci --prefix agentic-ai\/ci-agent/)
  assert.match(policy, /npm run build --prefix agentic-ai\/ci-agent/)
  assert.match(policy, /node --test \.github\/scripts\/\*\.test\.cjs/)
  assert.equal(policy.split('.github/workflows/pr-obsolete-validation.yml').length - 1, 2)
  assert.match(policy, /needs\.policy-paths\.outputs\.ci_agent == 'true'/)
})

test('Main keeps independent validated product and ecosystem frontiers', () => {
  assert.deepEqual(mainFrontiers([
    { sha: 'AI', valid: true, product: 'skipped', ecosystem: 'skipped' },
    { sha: 'MINDS', valid: true, product: 'skipped', ecosystem: 'success' },
    { sha: 'PRODUCT', valid: true, product: 'success', ecosystem: 'success' },
  ]), { kind: FrontierKind.found, product: 'PRODUCT', ecosystem: 'MINDS' })
  assert.deepEqual(mainFrontiers([
    { sha: 'FAILED', valid: true, product: 'failure', ecosystem: 'failure' },
  ]), unavailableFrontier())
  for (const marker of [
    "core.setOutput('product-sha', productSha)",
    "core.setOutput('ecosystem-sha', ecosystemSha)",
    "resolveSentinel('Native Rust verification')",
    "resolveSentinel('Rust ecosystem validation sentinel')",
    'PRODUCT_FRONTIER_SHA',
    'ECOSYSTEM_FRONTIER_SHA',
    'git diff --find-renames=1% --name-status',
    'git diff --no-renames --name-only',
  ]) assert.match(main, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  assert.match(main, /agentic-ai\/minds\/\*\) ecosystem_required=true/)
  assert.match(main, /ecosystem-sentinel:[\s\S]*runs-on: ubuntu-latest[\s\S]*run: "true"/)
  assert.match(main, /R\*\)\s+product_required=true/)
})

test('Rust specialist replaces only canonical minds validation', () => {
  for (const marker of [
    'types: [labeled, edited]',
    'PullRequestFileInventoryState',
    'Object.values(PullRequestFileStatus)',
    'context.payload.changes?.base?.ref?.from',
    "path.startsWith('agentic-ai/minds/')",
    'changedPaths.every(isCanonicalAiOnlyPath)',
  ]) assert.equal(ecosystem.includes(marker), true)
  assert.match(ecosystem, /github\.event\.action == 'labeled'[\s\S]*'validation' \|\| github\.run_id/)
  assert.match(ecosystem, /file\.status === PullRequestFileStatus\.Renamed[\s\S]*return 'false'/)
  assert.doesNotMatch(ecosystem.split('  validation-request:')[1].split('\n  ecosystem:')[0], /actions\/checkout|secrets\./)
})
