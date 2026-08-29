const assert = require('node:assert/strict')
const test = require('node:test')

const { validateAgentRecord } = require('./workbench-records.cjs')

const baseOwnershipUnit =
  '1. Capability: Workbench agent record validation; Gizmo ID: gizmo-1; Functional owner: AI; Expertise provider: None; Expertise allowed code paths: None; Expertise allowed test paths: None; Expertise forbidden paths: None; Expertise consumer interfaces: None; Expertise acceptance evidence: None; Capability acceptance evidence: Contract tests pass'

const expertiseOwnershipUnit =
  '1. Capability: Workbench agent record validation; Gizmo ID: gizmo-1; Functional owner: AI; Expertise provider: Web development; Expertise allowed code paths: .github/scripts/workbench-records.cjs; Expertise allowed test paths: .github/scripts/workbench-records.test.cjs; Expertise forbidden paths: .cortex/teams/ai,.cortex/shared; Expertise consumer interfaces: Plan input and validation result; Expertise acceptance evidence: Focused validator tests pass; Capability acceptance evidence: Published plans reject incomplete contracts'
const securityOwnershipUnit =
  '1. Capability: Cryptographic architecture review; Gizmo ID: gizmo-1; Functional owner: Security; Expertise provider: None; Expertise allowed code paths: None; Expertise allowed test paths: None; Expertise forbidden paths: None; Expertise consumer interfaces: None; Expertise acceptance evidence: None; Capability acceptance evidence: Security architecture evidence is current'
const gizmoOwnershipUnit =
  '1. Capability: Integrated pull request delivery; Gizmo ID: gizmo-1; Functional owner: Gizmo Prime; Expertise provider: None; Expertise allowed code paths: None; Expertise allowed test paths: None; Expertise forbidden paths: None; Expertise consumer interfaces: None; Expertise acceptance evidence: None; Capability acceptance evidence: Integrated readiness evidence is complete'
const secondGizmoOwnershipUnit =
  '2. Capability: Publisher adoption; Gizmo ID: gizmo-2; Functional owner: AI; Expertise provider: None; Expertise allowed code paths: None; Expertise allowed test paths: None; Expertise forbidden paths: None; Expertise consumer interfaces: None; Expertise acceptance evidence: None; Capability acceptance evidence: Integration checks pass'

function sliceContract(number, id, name, predecessor, scope, estimate, evidence) {
  return `${number}. Gizmo ID: ${id}; Gizmo name: ${name}; Predecessor Gizmo ID: ${predecessor}; ${scope}; Estimated authored changed lines: ${estimate}; Acceptance evidence: ${evidence}`
}

function sequenceField(...slices) {
  return `- PR slices, estimates, and acceptance evidence:\n${slices.join('\n')}`
}

const validSequenceField = sequenceField(
  sliceContract(
    1,
    'gizmo-1',
    'Workbench validator',
    'None',
    'Validator change',
    '240',
    'Contract tests pass',
  ),
)

const validPlan = `# Task plan

## Interpreted request

Deliver a durable two-phase agent context record.

## Requirements

- Publish the synthesized plan before implementation.

## Constraints and exclusions

- Do not preserve source conversation text.

## Change budget and PR sequence

- Mission controller: Gizmo Prime
- Current Gizmo ID: gizmo-1
- Estimated authored changed lines: 240
- Owning modules, packages, or layers: Workbench agent records
- Ownership units:
${baseOwnershipUnit}
- Public or cross-module interfaces: Plan validation contract
- Delivery shape: One PR
- PR sequence mode: One PR
- Current PR estimated authored changed lines: 240
- Current PR slice and acceptance evidence: Validator change; Acceptance evidence: Contract tests pass
${validSequenceField}

## Initial plan

1. Add and validate the lifecycle.

## Completion evidence

- The automated worker blocks implementation without a published plan.

## Safety review

- The record contains only public-safe development context.
`

const validWorklog = `# Work summary

## Outcome

Planning stopped at the user-authorization boundary.

## Progress

- Compared bounded alternatives.

## Implementation problems

- The major direction has not been authorized.

## Decisions

- No implementation decision was inferred.

## Validation

- Confirmed that no implementation plan was created.

## Remaining work

- The user must select and request a direction.
`

function validTwoGizmoStackedPlan() {
  return validPlan
    .replace(baseOwnershipUnit, `${baseOwnershipUnit}\n${secondGizmoOwnershipUnit}`)
    .replace(
      'Estimated authored changed lines: 240',
      'Estimated authored changed lines: 2,240',
    )
    .replace('Delivery shape: One PR', 'Delivery shape: Multiple PRs')
    .replace('PR sequence mode: One PR', 'PR sequence mode: Stacked PRs')
    .replace(
      validSequenceField,
      sequenceField(
        sliceContract(1, 'gizmo-1', 'Validator', 'None', 'Validator change', '240', 'Contract tests pass'),
        sliceContract(2, 'gizmo-2', 'Publisher', 'gizmo-1', 'Publisher adoption', '2,000', 'Integration checks pass.'),
      ),
    )
}

test('accepts a synthesized task plan', () => {
  assert.equal(validateAgentRecord(validPlan, 'plan'), '')
})

test('rejects transcript-shaped task plans', () => {
  const transcript = validPlan.replace(
    'Deliver a durable two-phase agent context record.',
    'User: copy this source request',
  )
  assert.match(validateAgentRecord(transcript, 'plan'), /resembles a transcript/)
})

test('rejects punctuation-wrapped slice placeholders', () => {
  const invalid = validPlan
    .replace(
      'Validator change; Acceptance evidence: Contract tests pass',
      '**TBD.**; Acceptance evidence: Contract tests pass',
    )
    .replace(
      'Validator change; Acceptance evidence: Contract tests pass',
      '**TBD.**; Acceptance evidence: Contract tests pass',
    )
  assert.match(
    validateAgentRecord(invalid, 'plan'),
    /missing or empty plan field: Current PR slice and acceptance evidence/,
  )
})

test('rejects an unlabeled verbatim excerpt from the source task', () => {
  const sourceTask =
    'Please preserve all important requirements by publishing this exact ordinary prose before the implementation phase begins.'
  const copied = validPlan.replace(
    'Deliver a durable two-phase agent context record.',
    sourceTask,
  )
  assert.match(
    validateAgentRecord(copied, 'plan', [], sourceTask),
    /verbatim source-task excerpt/,
  )
})

test('rejects a source-task excerpt from a blocker worklog', () => {
  const sourceTask =
    'Please expose confidential deployment planning details before the implementation phase begins.'
  const copied = validWorklog.replace(
    'Planning stopped at the user-authorization boundary.',
    sourceTask,
  )
  assert.match(
    validateAgentRecord(copied, 'worklog', [], sourceTask),
    /verbatim source-task excerpt/,
  )
})

test('rejects a complete short source task copied verbatim', () => {
  const sourceTask = 'Keep pull requests module local'
  const copied = validPlan.replace(
    'Deliver a durable two-phase agent context record.',
    sourceTask,
  )
  assert.match(
    validateAgentRecord(copied, 'plan', [], sourceTask),
    /verbatim source-task excerpt/,
  )
})

test('rejects a shorter copied sentence from a long source task', () => {
  const copiedSentence =
    'Keep every focused pull request inside one clear architectural module boundary'
  const sourceTask = `${copiedSentence}. Then continue with independently mergeable slices until the entire feature is complete.`
  const copied = validPlan.replace(
    'Deliver a durable two-phase agent context record.',
    copiedSentence,
  )
  assert.match(
    validateAgentRecord(copied, 'plan', [], sourceTask),
    /verbatim source-task excerpt/,
  )
})

test('rejects a copied seven-word fragment from a long source task', () => {
  const copiedFragment = 'publish internal customer codename before starting implementation'
  const sourceTask = `Please ${copiedFragment} and then prepare the independently mergeable delivery slices.`
  const copied = validPlan.replace(
    'Deliver a durable two-phase agent context record.',
    copiedFragment,
  )
  assert.match(
    validateAgentRecord(copied, 'plan', [], sourceTask),
    /verbatim source-task excerpt/,
  )
})

test('accepts an independently synthesized representation of the source task', () => {
  const sourceTask =
    'Please preserve all important requirements by publishing this exact ordinary prose before the implementation phase begins.'
  assert.equal(validateAgentRecord(validPlan, 'plan', [], sourceTask), '')
})

test('rejects an unresolved public-interface placeholder', () => {
  const invalid = validPlan.replace(
    'Public or cross-module interfaces: Plan validation contract',
    'Public or cross-module interfaces: **TBD.**',
  )
  assert.match(
    validateAgentRecord(invalid, 'plan'),
    /missing or empty plan field: Public or cross-module interfaces/,
  )
})

test('accepts a plan with no public interface changes', () => {
  const noInterfaces = validPlan.replace(
    'Public or cross-module interfaces: Plan validation contract',
    'Public or cross-module interfaces: None',
  )
  assert.equal(validateAgentRecord(noInterfaces, 'plan'), '')
})

test('rejects empty required sections', () => {
  const empty = validPlan.replace(
    '1. Add and validate the lifecycle.',
    '',
  )
  assert.match(validateAgentRecord(empty, 'plan'), /section is empty/)
})

for (const field of [
  'Mission controller',
  'Current Gizmo ID',
  'Estimated authored changed lines',
  'Owning modules, packages, or layers',
  'Ownership units',
  'Public or cross-module interfaces',
  'Delivery shape',
  'PR sequence mode',
  'Current PR estimated authored changed lines',
  'Current PR slice and acceptance evidence',
  'PR slices, estimates, and acceptance evidence',
]) {
  test(`rejects a plan without ${field}`, () => {
    const missing = validPlan.replace(
      new RegExp(`^- ${field}:.*\\n`, 'm'),
      '',
    )
    assert.match(
      validateAgentRecord(missing, 'plan'),
      new RegExp(`missing or empty plan field: ${field}`),
    )
  })
}

test('accepts a complete cross-team expertise contract', () => {
  const expertisePlan = validPlan.replace(
    baseOwnershipUnit,
    expertiseOwnershipUnit,
  )
  assert.equal(validateAgentRecord(expertisePlan, 'plan'), '')
})

test('accepts security as a functional owner', () => {
  const securityPlan = validPlan.replace(
    baseOwnershipUnit,
    securityOwnershipUnit,
  )
  assert.equal(validateAgentRecord(securityPlan, 'plan'), '')
})

test('accepts security as an expertise provider', () => {
  const securityExpertiseUnit = expertiseOwnershipUnit.replace(
    'Expertise provider: Web development',
    'Expertise provider: Security',
  )
  const securityExpertisePlan = validPlan.replace(
    baseOwnershipUnit,
    securityExpertiseUnit,
  )
  assert.equal(validateAgentRecord(securityExpertisePlan, 'plan'), '')
})

test('accepts Gizmo Prime as a functional owner', () => {
  const gizmoPlan = validPlan.replace(baseOwnershipUnit, gizmoOwnershipUnit)
  assert.equal(validateAgentRecord(gizmoPlan, 'plan'), '')
})

test('accepts legacy Gizmo as the Gizmo Prime functional owner', () => {
  const legacyGizmoPlan = validPlan.replace(
    baseOwnershipUnit,
    gizmoOwnershipUnit.replace('Functional owner: Gizmo Prime', 'Functional owner: Gizmo'),
  )
  assert.equal(validateAgentRecord(legacyGizmoPlan, 'plan'), '')
})

test('rejects Gizmo as an expertise provider', () => {
  const gizmoExpertiseUnit = expertiseOwnershipUnit.replace(
    'Expertise provider: Web development',
    'Expertise provider: Gizmo',
  )
  const gizmoExpertisePlan = validPlan.replace(
    baseOwnershipUnit,
    gizmoExpertiseUnit,
  )
  assert.match(
    validateAgentRecord(gizmoExpertisePlan, 'plan'),
    /ownership units must be consecutive and match the required contract shape/,
  )
})

test('rejects an expertise provider without a complete contract', () => {
  const invalid = validPlan.replace(
    baseOwnershipUnit,
    baseOwnershipUnit.replace(
      'Expertise provider: None',
      'Expertise provider: Web development',
    ),
  )
  assert.match(
    validateAgentRecord(invalid, 'plan'),
    /expertise paths must be exact comma-separated repository-relative paths/,
  )
})

test('rejects expertise fields without an expertise provider', () => {
  const invalid = validPlan.replace(
    baseOwnershipUnit,
    baseOwnershipUnit.replace(
      'Expertise forbidden paths: None',
      'Expertise forbidden paths: .cortex/teams/ai',
    ),
  )
  assert.match(
    validateAgentRecord(invalid, 'plan'),
    /ownership unit expertise fields require a provider/,
  )
})

test('rejects the functional owner as its own expertise provider', () => {
  const invalid = validPlan.replace(
    baseOwnershipUnit,
    expertiseOwnershipUnit.replace('Web development', 'AI'),
  )
  assert.match(
    validateAgentRecord(invalid, 'plan'),
    /expertise provider must differ from the functional owner/,
  )
})

test('accepts multiple independently owned capability units', () => {
  const secondUnit =
    '2. Capability: Deployment validation; Gizmo ID: gizmo-1; Functional owner: SRE; Expertise provider: None; Expertise allowed code paths: None; Expertise allowed test paths: None; Expertise forbidden paths: None; Expertise consumer interfaces: None; Expertise acceptance evidence: None; Capability acceptance evidence: Hosted deployment checks pass'
  const multiTeamPlan = validPlan.replace(
    baseOwnershipUnit,
    `${baseOwnershipUnit}\n${secondUnit}`,
  )
  assert.equal(validateAgentRecord(multiTeamPlan, 'plan'), '')
})

test('accepts a 200-line one-Gizmo plan with multiple ownership units', () => {
  const secondUnit =
    '2. Capability: Plan publication; Gizmo ID: gizmo-1; Functional owner: AI; Expertise provider: None; Expertise allowed code paths: None; Expertise allowed test paths: None; Expertise forbidden paths: None; Expertise consumer interfaces: None; Expertise acceptance evidence: None; Capability acceptance evidence: Publication checks pass'
  const plan = validPlan
    .replaceAll('authored changed lines: 240', 'authored changed lines: 200')
    .replace(baseOwnershipUnit, `${baseOwnershipUnit}\n${secondUnit}`)
  assert.equal(validateAgentRecord(plan, 'plan'), '')
})

test('rejects broad prose instead of exact expertise paths', () => {
  const invalidUnit = expertiseOwnershipUnit.replace(
    '.github/scripts/workbench-records.cjs',
    'all TypeScript files',
  )
  const invalid = validPlan.replace(baseOwnershipUnit, invalidUnit)
  assert.match(
    validateAgentRecord(invalid, 'plan'),
    /expertise paths must be exact comma-separated repository-relative paths/,
  )
})

test('rejects expertise paths that are both allowed and forbidden', () => {
  const invalidUnit = expertiseOwnershipUnit.replace(
    '.cortex/teams/ai,.cortex/shared',
    '.github/scripts/workbench-records.cjs,.cortex/shared',
  )
  const invalid = validPlan.replace(baseOwnershipUnit, invalidUnit)
  assert.match(
    validateAgentRecord(invalid, 'plan'),
    /expertise allowed and forbidden paths must not overlap/,
  )
})

for (const forbiddenPath of [
  '.github',
  '.github/scripts/workbench-records.cjs/generated',
]) {
  test(`rejects nested expertise path overlap: ${forbiddenPath}`, () => {
    const invalidUnit = expertiseOwnershipUnit.replace(
      '.cortex/teams/ai,.cortex/shared',
      `${forbiddenPath},.cortex/shared`,
    )
    const invalid = validPlan.replace(baseOwnershipUnit, invalidUnit)
    assert.match(
      validateAgentRecord(invalid, 'plan'),
      /expertise allowed and forbidden paths must not overlap/,
    )
  })
}

test('rejects a nonnumeric authored-line estimate', () => {
  const invalid = validPlan.replace(
    'Estimated authored changed lines: 240',
    'Estimated authored changed lines: small',
  )
  assert.match(
    validateAgentRecord(invalid, 'plan'),
    /missing or empty plan field: Estimated authored changed lines/,
  )
})

for (const malformedEstimate of ['5,00', '1,,,,']) {
  test(`rejects malformed estimate grouping: ${malformedEstimate}`, () => {
    const invalid = validPlan.replace(
      'Estimated authored changed lines: 240',
      `Estimated authored changed lines: ${malformedEstimate}`,
    )
    assert.match(
      validateAgentRecord(invalid, 'plan'),
      /missing or empty plan field: Estimated authored changed lines/,
    )
  })
}

test('rejects an over-budget one-PR plan', () => {
  const invalid = validPlan
    .replace(
      'Estimated authored changed lines: 240',
      'Estimated authored changed lines: 6,000',
    )
    .replace(
      'Current PR estimated authored changed lines: 240',
      'Current PR estimated authored changed lines: 6,000',
    )
  assert.match(
    validateAgentRecord(invalid, 'plan'),
    /current PR estimate exceeds 2,000 authored changed lines/,
  )
})

test('rejects a one-PR shape for an over-budget feature', () => {
  const invalid = validPlan.replace(
    'Estimated authored changed lines: 240',
    'Estimated authored changed lines: 6,000',
  )
  assert.match(
    validateAgentRecord(invalid, 'plan'),
    /one-PR plan exceeds 2,000 authored changed lines/,
  )
})

test('accepts a one-PR plan at the 2,000-line ceiling', () => {
  const atCeiling = validPlan
    .replace(
      'Estimated authored changed lines: 240',
      'Estimated authored changed lines: 2,000',
    )
    .replace(
      'Current PR estimated authored changed lines: 240',
      'Current PR estimated authored changed lines: 2,000',
    )
    .replace(
      'Estimated authored changed lines: 240; Acceptance evidence: Contract tests pass',
      'Estimated authored changed lines: 2,000; Acceptance evidence: Contract tests pass',
    )
  assert.equal(validateAgentRecord(atCeiling, 'plan'), '')
})

test('requires stacked PRs for an over-budget multi-PR feature', () => {
  const independent = validPlan
    .replace(
      'Estimated authored changed lines: 240',
      'Estimated authored changed lines: 2,001',
    )
    .replace('Delivery shape: One PR', 'Delivery shape: Multiple PRs')
    .replace('PR sequence mode: One PR', 'PR sequence mode: Independent PRs')
    .replace(
      validSequenceField,
      sequenceField(
        sliceContract(1, 'gizmo-1', 'Validator', 'None', 'Validator change', '240', 'Contract tests pass'),
        sliceContract(2, 'gizmo-2', 'Publisher', 'None', 'Publisher adoption', '1,761', 'Integration checks pass.'),
      ),
    )
  assert.match(
    validateAgentRecord(independent, 'plan'),
    /feature above 2,000 authored changed lines requires stacked PRs/,
  )
})

test('rejects a sequence mode that contradicts one-PR delivery', () => {
  const invalid = validPlan.replace(
    'PR sequence mode: One PR',
    'PR sequence mode: Stacked PRs',
  )
  assert.match(
    validateAgentRecord(invalid, 'plan'),
    /one-PR delivery requires one-PR sequence mode/,
  )
})

test('rejects a feature estimate below its current PR estimate', () => {
  const invalid = validPlan
    .replace(
      'Estimated authored changed lines: 240',
      'Estimated authored changed lines: 1',
    )
    .replace(
      'Current PR estimated authored changed lines: 240',
      'Current PR estimated authored changed lines: 1,999',
    )
  assert.match(
    validateAgentRecord(invalid, 'plan'),
    /feature estimate must be at least the current PR estimate/,
  )
})

test('rejects different feature and current PR estimates for one PR', () => {
  const invalid = validPlan.replace(
    'Estimated authored changed lines: 240',
    'Estimated authored changed lines: 300',
  )
  assert.match(
    validateAgentRecord(invalid, 'plan'),
    /one-PR feature and current PR estimates must match/,
  )
})

test('accepts a bounded current slice for a multi-PR feature', () => {
  const multiPr = validTwoGizmoStackedPlan()
  assert.equal(validateAgentRecord(multiPr, 'plan'), '')
})

test('rejects a multi-PR slice without an authored-line estimate', () => {
  const invalid = validPlan
    .replace(
      'Estimated authored changed lines: 240',
      'Estimated authored changed lines: 12,000',
    )
    .replace(
      'Current PR estimated authored changed lines: 240',
      'Current PR estimated authored changed lines: 1,000',
    )
    .replace('Delivery shape: One PR', 'Delivery shape: Multiple PRs')
    .replace('PR sequence mode: One PR', 'PR sequence mode: Stacked PRs')
    .replace(
      validSequenceField,
      `- PR slices, estimates, and acceptance evidence:\n1. Gizmo ID: gizmo-1; Gizmo name: Validator; Predecessor Gizmo ID: None; Validator change; Acceptance evidence: Contract tests pass\n${sliceContract(2, 'gizmo-2', 'Publisher', 'gizmo-1', 'Publisher adoption', '1,000', 'Integration checks pass.')}`,
    )
  assert.match(
    validateAgentRecord(invalid, 'plan'),
    /consecutively numbered slices with estimates and acceptance evidence/,
  )
})

test('rejects undersized slice coverage for a 12,000-line feature', () => {
  const invalid = validPlan
    .replace(
      'Estimated authored changed lines: 240',
      'Estimated authored changed lines: 12,000',
    )
    .replace(
      'Current PR estimated authored changed lines: 240',
      'Current PR estimated authored changed lines: 1,000',
    )
    .replace('Delivery shape: One PR', 'Delivery shape: Multiple PRs')
    .replace('PR sequence mode: One PR', 'PR sequence mode: Stacked PRs')
    .replace(
      validSequenceField,
      sequenceField(
        sliceContract(1, 'gizmo-1', 'Validator', 'None', 'Validator change', '1,000', 'Contract tests pass'),
        sliceContract(2, 'gizmo-2', 'Publisher', 'gizmo-1', 'Publisher adoption', '1,000', 'Integration checks pass.'),
      ),
    )
  assert.match(
    validateAgentRecord(invalid, 'plan'),
    /PR slice estimates must sum to the complete feature estimate/,
  )
})

test('rejects an individual PR slice above 2,000 lines', () => {
  const invalid = validPlan
    .replace(
      'Estimated authored changed lines: 240',
      'Estimated authored changed lines: 2,241',
    )
    .replace('Delivery shape: One PR', 'Delivery shape: Multiple PRs')
    .replace('PR sequence mode: One PR', 'PR sequence mode: Stacked PRs')
    .replace(
      validSequenceField,
      sequenceField(
        sliceContract(1, 'gizmo-1', 'Validator', 'None', 'Validator change', '240', 'Contract tests pass'),
        sliceContract(2, 'gizmo-2', 'Publisher', 'gizmo-1', 'Publisher adoption', '2,001', 'Integration checks pass.'),
      ),
    )
  assert.match(
    validateAgentRecord(invalid, 'plan'),
    /every PR slice estimate must be between 1 and 2,000 authored changed lines/,
  )
})

test('rejects a zero-line PR slice estimate', () => {
  const invalid = validPlan
    .replace('Delivery shape: One PR', 'Delivery shape: Multiple PRs')
    .replace('PR sequence mode: One PR', 'PR sequence mode: Independent PRs')
    .replace(
      validSequenceField,
      sequenceField(
        sliceContract(1, 'gizmo-1', 'Validator', 'None', 'Validator change', '240', 'Contract tests pass'),
        sliceContract(2, 'gizmo-2', 'Publisher', 'None', 'Publisher adoption', '0', 'Integration checks pass.'),
      ),
    )
  assert.match(
    validateAgentRecord(invalid, 'plan'),
    /every PR slice estimate must be between 1 and 2,000 authored changed lines/,
  )
})

test('rejects a multi-PR current slice omitted from its ordered sequence', () => {
  const invalid = validPlan
    .replace('Delivery shape: One PR', 'Delivery shape: Multiple PRs')
    .replace('PR sequence mode: One PR', 'PR sequence mode: Independent PRs')
    .replace(
      validSequenceField,
      sequenceField(
        sliceContract(1, 'gizmo-1', 'Storage', 'None', 'Storage schema', '120', 'Domain tests pass.'),
        sliceContract(2, 'gizmo-2', 'Publisher', 'None', 'Publisher adoption', '120', 'Integration checks pass.'),
      ),
    )
  assert.match(
    validateAgentRecord(invalid, 'plan'),
    /first slice to match the current PR contract/,
  )
})

test('rejects a first slice estimate that differs from the current PR estimate', () => {
  const invalid = validPlan
    .replace('Delivery shape: One PR', 'Delivery shape: Multiple PRs')
    .replace('PR sequence mode: One PR', 'PR sequence mode: Independent PRs')
    .replace(
      validSequenceField,
      sequenceField(
        sliceContract(1, 'gizmo-1', 'Validator', 'None', 'Validator change', '120', 'Contract tests pass'),
        sliceContract(2, 'gizmo-2', 'Publisher', 'None', 'Publisher adoption', '120', 'Integration checks pass.'),
      ),
    )
  assert.match(
    validateAgentRecord(invalid, 'plan'),
    /first slice estimate to match the current PR estimate/,
  )
})

test('rejects a multi-PR plan without an ordered sequence', () => {
  const invalid = validPlan
    .replace(
      'Estimated authored changed lines: 240',
      'Estimated authored changed lines: 6,000',
    )
    .replace(
      'Delivery shape: One PR',
      'Delivery shape: Multiple PRs',
    )
    .replace('PR sequence mode: One PR', 'PR sequence mode: Stacked PRs')
    .replace(
      validSequenceField,
      '- PR slices, estimates, and acceptance evidence:\nNone',
    )
  assert.match(
    validateAgentRecord(invalid, 'plan'),
    /multi-PR plan requires at least two consecutively numbered slices with estimates and acceptance evidence/,
  )
})

test('rejects multi-PR slices without acceptance evidence', () => {
  const invalid = validPlan
    .replace('Delivery shape: One PR', 'Delivery shape: Multiple PRs')
    .replace('PR sequence mode: One PR', 'PR sequence mode: Independent PRs')
    .replace(
      validSequenceField,
      '- PR slices, estimates, and acceptance evidence:\n1. Storage; Estimated authored changed lines: 120\n2. UI; Estimated authored changed lines: 120',
    )
  assert.match(
    validateAgentRecord(invalid, 'plan'),
    /multi-PR plan requires at least two consecutively numbered slices with estimates and acceptance evidence/,
  )
})

for (const sequence of [
  `${sliceContract(1, 'gizmo-1', 'Storage', 'None', 'Storage', '120', 'Contract tests pass.')}\n${sliceContract(1, 'gizmo-2', 'UI', 'None', 'UI', '120', 'Integration checks pass.')}`,
  `${sliceContract(1, 'gizmo-1', 'Storage', 'None', 'Storage', '120', 'Contract tests pass.')}\n${sliceContract(3, 'gizmo-2', 'UI', 'None', 'UI', '120', 'Integration checks pass.')}`,
]) {
  test(`rejects nonconsecutive multi-PR sequence: ${sequence.split('\n')[1]}`, () => {
    const invalid = validPlan
      .replace('Delivery shape: One PR', 'Delivery shape: Multiple PRs')
      .replace('PR sequence mode: One PR', 'PR sequence mode: Independent PRs')
      .replace(
        validSequenceField,
        `- PR slices, estimates, and acceptance evidence:\n${sequence}`,
      )
    assert.match(
      validateAgentRecord(invalid, 'plan'),
      /multi-PR plan requires at least two consecutively numbered slices with estimates and acceptance evidence/,
    )
  })
}

for (const placeholder of ['None', 'N/A', 'TBD', 'Unknown']) {
  test(`rejects ${placeholder} as the owning boundary`, () => {
    const invalid = validPlan.replace(
      'Owning modules, packages, or layers: Workbench agent records',
      `Owning modules, packages, or layers: ${placeholder}`,
    )
    assert.match(
      validateAgentRecord(invalid, 'plan'),
      /missing or empty plan field: Owning modules, packages, or layers/,
    )
  })

  test(`rejects ${placeholder} as the current PR slice`, () => {
    const invalid = validPlan.replace(
      'Current PR slice and acceptance evidence: Validator change; Acceptance evidence: Contract tests pass',
      `Current PR slice and acceptance evidence: ${placeholder}`,
    )
    assert.match(
      validateAgentRecord(invalid, 'plan'),
      /missing or empty plan field: Current PR slice and acceptance evidence/,
    )
  })

  test(`rejects ${placeholder} as current PR acceptance evidence`, () => {
    const invalid = validPlan.replace(
      'Acceptance evidence: Contract tests pass',
      `Acceptance evidence: ${placeholder}`,
    )
    assert.match(
      validateAgentRecord(invalid, 'plan'),
      /missing or empty plan field: Current PR slice and acceptance evidence/,
    )
  })
}

test('rejects an ambiguous delivery shape', () => {
  const invalid = validPlan.replace(
    'Delivery shape: One PR',
    'Delivery shape: One PR cannot complete the feature; Multiple PRs are required',
  )
  assert.match(
    validateAgentRecord(invalid, 'plan'),
    /missing or empty plan field: Delivery shape/,
  )
})

test('accepts a normalized delivery shape with trailing spaces', () => {
  const plan = validPlan.replace('Delivery shape: One PR', 'Delivery shape: One PR   ')
  assert.equal(validateAgentRecord(plan, 'plan'), '')
})

test('rejects a placeholder current slice with concrete evidence', () => {
  const invalid = validPlan.replace(
    'Current PR slice and acceptance evidence: Validator change; Acceptance evidence: Contract tests pass',
    'Current PR slice and acceptance evidence: None; Acceptance evidence: Contract tests pass',
  )
  assert.match(
    validateAgentRecord(invalid, 'plan'),
    /missing or empty plan field: Current PR slice and acceptance evidence/,
  )
})

test('rejects multiple slices declared as one PR', () => {
  const invalid = validPlan.replace(
    validSequenceField,
    sequenceField(
      sliceContract(1, 'gizmo-1', 'Validator', 'None', 'Validator schema', '120', 'Contract tests pass.'),
      sliceContract(2, 'gizmo-2', 'Publisher', 'None', 'Publisher adoption', '120', 'Integration checks pass.'),
    ),
  )
  assert.match(
    validateAgentRecord(invalid, 'plan'),
    /one-PR plan requires one numbered slice matching the current PR contract/,
  )
})

test('rejects a placeholder scope in a multi-PR slice', () => {
  const invalid = validPlan
    .replace('Delivery shape: One PR', 'Delivery shape: Multiple PRs')
    .replace('PR sequence mode: One PR', 'PR sequence mode: Independent PRs')
    .replace(
      validSequenceField,
      sequenceField(
        sliceContract(1, 'gizmo-1', 'Validator', 'None', 'None', '120', 'Contract tests pass.'),
        sliceContract(2, 'gizmo-2', 'Publisher', 'None', 'Publisher adoption', '120', 'Integration checks pass.'),
      ),
    )
  assert.match(
    validateAgentRecord(invalid, 'plan'),
    /multi-PR plan requires at least two consecutively numbered slices with estimates and acceptance evidence/,
  )
})

test('rejects a one-PR sequence that contradicts the current slice', () => {
  const invalid = validPlan.replace(
    validSequenceField,
    sequenceField(
      sliceContract(1, 'gizmo-1', 'Storage', 'None', 'Storage migration', '240', 'Migration tests pass'),
    ),
  )
  assert.match(
    validateAgentRecord(invalid, 'plan'),
    /one-PR plan requires one numbered slice matching the current PR contract/,
  )
})

test('rejects zero authored-line estimates', () => {
  const invalid = validPlan
    .replace('Estimated authored changed lines: 240', 'Estimated authored changed lines: 0')
    .replace(
      'Current PR estimated authored changed lines: 240',
      'Current PR estimated authored changed lines: 0',
    )
  assert.match(
    validateAgentRecord(invalid, 'plan'),
    /authored changed-line estimates must be positive integers/,
  )
})

test('rejects budget fields duplicated outside their owning section', () => {
  const invalid = validPlan.replace(
    '- Publish the synthesized plan before implementation.',
    '- Publish the synthesized plan before implementation.\n- Delivery shape: One PR',
  )
  assert.match(
    validateAgentRecord(invalid, 'plan'),
    /missing, duplicated, or misplaced plan field: Delivery shape/,
  )
})

test('rejects case-variant budget fields outside their owning section', () => {
  const invalid = validPlan.replace(
    '- Publish the synthesized plan before implementation.',
    '- Publish the synthesized plan before implementation.\n- delivery shape: Multiple PRs',
  )
  assert.match(
    validateAgentRecord(invalid, 'plan'),
    /missing, duplicated, or misplaced plan field: Delivery shape/,
  )
})

test('does not use a valid field outside the budget section', () => {
  const invalid = validPlan
    .replace(
      '- Publish the synthesized plan before implementation.',
      '- Publish the synthesized plan before implementation.\n- Delivery shape: One PR',
    )
    .replace('- Delivery shape: One PR\n- Current PR', '- Delivery shape: undecided\n- Current PR')
  assert.match(
    validateAgentRecord(invalid, 'plan'),
    /missing, duplicated, or misplaced plan field: Delivery shape/,
  )
})

test('rejects concrete workflow credentials', () => {
  const leaked = validPlan.replace(
    'Deliver a durable two-phase agent context record.',
    'Deliver workflow-value safely.',
  )
  assert.match(
    validateAgentRecord(leaked, 'plan', ['workflow-value']),
    /^content contains a workflow credential$/,
  )
})
