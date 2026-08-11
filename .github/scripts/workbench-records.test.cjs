const assert = require('node:assert/strict')
const test = require('node:test')

const { validateAgentRecord } = require('./workbench-records.cjs')

const validPlan = `# Task plan

## Interpreted request

Deliver a durable two-phase agent context record.

## Requirements

- Publish the synthesized plan before implementation.

## Constraints and exclusions

- Do not preserve source conversation text.

## Change budget and PR sequence

- Estimated authored changed lines: 240
- Owning modules, packages, or layers: Workbench agent records
- Public or cross-module interfaces: Plan validation contract
- Delivery shape: One PR
- Current PR estimated authored changed lines: 240
- Current PR slice and acceptance evidence: Validator change; Acceptance evidence: Contract tests pass
- PR slices and acceptance evidence: Validator change; Acceptance evidence: Contract tests pass

## Initial plan

1. Add and validate the lifecycle.

## Completion evidence

- The automated worker blocks implementation without a published plan.

## Safety review

- The record contains only public-safe development context.
`

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

test('accepts an independently synthesized representation of the source task', () => {
  const sourceTask =
    'Please preserve all important requirements by publishing this exact ordinary prose before the implementation phase begins.'
  assert.equal(validateAgentRecord(validPlan, 'plan', [], sourceTask), '')
})

test('rejects empty required sections', () => {
  const empty = validPlan.replace(
    '1. Add and validate the lifecycle.',
    '',
  )
  assert.match(validateAgentRecord(empty, 'plan'), /section is empty/)
})

for (const field of [
  'Estimated authored changed lines',
  'Owning modules, packages, or layers',
  'Public or cross-module interfaces',
  'Delivery shape',
  'Current PR estimated authored changed lines',
  'Current PR slice and acceptance evidence',
  'PR slices and acceptance evidence',
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
    /current PR estimate exceeds 5,000 authored changed lines/,
  )
})

test('rejects a one-PR shape for an over-budget feature', () => {
  const invalid = validPlan.replace(
    'Estimated authored changed lines: 240',
    'Estimated authored changed lines: 6,000',
  )
  assert.match(
    validateAgentRecord(invalid, 'plan'),
    /one-PR plan exceeds 5,000 authored changed lines/,
  )
})

test('accepts a bounded current slice for a multi-PR feature', () => {
  const multiPr = validPlan
    .replace(
      'Estimated authored changed lines: 240',
      'Estimated authored changed lines: 12,000',
    )
    .replace(
      'Delivery shape: One PR',
      'Delivery shape: Multiple PRs',
    )
    .replace(
      '- PR slices and acceptance evidence: Validator change; Acceptance evidence: Contract tests pass',
      '- PR slices and acceptance evidence:\n1. Validator change; Acceptance evidence: Contract tests pass\n2. Publisher adoption; Acceptance evidence: Integration checks pass.',
    )
  assert.equal(validateAgentRecord(multiPr, 'plan'), '')
})

test('rejects a multi-PR current slice omitted from its ordered sequence', () => {
  const invalid = validPlan
    .replace('Delivery shape: One PR', 'Delivery shape: Multiple PRs')
    .replace(
      '- PR slices and acceptance evidence: Validator change; Acceptance evidence: Contract tests pass',
      '- PR slices and acceptance evidence:\n1. Storage schema; Acceptance evidence: Domain tests pass.\n2. Publisher adoption; Acceptance evidence: Integration checks pass.',
    )
  assert.match(
    validateAgentRecord(invalid, 'plan'),
    /first slice to match the current PR contract/,
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
    .replace(
      'PR slices and acceptance evidence: Validator change; Acceptance evidence: Contract tests pass',
      'PR slices and acceptance evidence: None',
    )
  assert.match(
    validateAgentRecord(invalid, 'plan'),
    /multi-PR plan requires at least two ordered slices with acceptance evidence/,
  )
})

test('rejects multi-PR slices without acceptance evidence', () => {
  const invalid = validPlan
    .replace('Delivery shape: One PR', 'Delivery shape: Multiple PRs')
    .replace(
      'PR slices and acceptance evidence: Validator change; Acceptance evidence: Contract tests pass',
      'PR slices and acceptance evidence:\n1. Storage\n2. UI',
    )
  assert.match(
    validateAgentRecord(invalid, 'plan'),
    /multi-PR plan requires at least two ordered slices with acceptance evidence/,
  )
})

for (const sequence of [
  '1. Storage; Acceptance evidence: Contract tests pass.\n1. UI; Acceptance evidence: Integration checks pass.',
  '1. Storage; Acceptance evidence: Contract tests pass.\n3. UI; Acceptance evidence: Integration checks pass.',
]) {
  test(`rejects nonconsecutive multi-PR sequence: ${sequence.split('\n')[1]}`, () => {
    const invalid = validPlan
      .replace('Delivery shape: One PR', 'Delivery shape: Multiple PRs')
      .replace(
        '- PR slices and acceptance evidence: Validator change; Acceptance evidence: Contract tests pass',
        `- PR slices and acceptance evidence:\n${sequence}`,
      )
    assert.match(
      validateAgentRecord(invalid, 'plan'),
      /multi-PR plan requires at least two ordered slices with acceptance evidence/,
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
    '- PR slices and acceptance evidence: Validator change; Acceptance evidence: Contract tests pass',
    '- PR slices and acceptance evidence:\n1. Validator schema; Acceptance evidence: Contract tests pass.\n2. Publisher adoption; Acceptance evidence: Integration checks pass.',
  )
  assert.match(
    validateAgentRecord(invalid, 'plan'),
    /one-PR plan requires one slice matching the current PR contract/,
  )
})

test('rejects a placeholder scope in a multi-PR slice', () => {
  const invalid = validPlan
    .replace('Delivery shape: One PR', 'Delivery shape: Multiple PRs')
    .replace(
      '- PR slices and acceptance evidence: Validator change; Acceptance evidence: Contract tests pass',
      '- PR slices and acceptance evidence:\n1. None; Acceptance evidence: Contract tests pass.\n2. Publisher adoption; Acceptance evidence: Integration checks pass.',
    )
  assert.match(
    validateAgentRecord(invalid, 'plan'),
    /multi-PR plan requires at least two ordered slices with acceptance evidence/,
  )
})

test('rejects a one-PR sequence that contradicts the current slice', () => {
  const invalid = validPlan.replace(
    '- PR slices and acceptance evidence: Validator change; Acceptance evidence: Contract tests pass',
    '- PR slices and acceptance evidence: Storage migration; Acceptance evidence: Migration tests pass',
  )
  assert.match(
    validateAgentRecord(invalid, 'plan'),
    /one-PR plan requires one slice matching the current PR contract/,
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
