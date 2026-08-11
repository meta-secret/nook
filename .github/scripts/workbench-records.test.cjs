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
- Delivery shape: One PR completes the change
- Current PR estimated authored changed lines: 240
- Current PR slice and acceptance evidence: Validator change with contract tests
- PR slices and acceptance evidence: One validator slice with contract tests

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
      'Delivery shape: One PR completes the change',
      'Delivery shape: Multiple PRs complete the feature',
    )
    .replace(
      '- PR slices and acceptance evidence: One validator slice with contract tests',
      '- PR slices and acceptance evidence:\n1. Validator schema with contract tests.\n2. Publisher adoption with integration evidence.',
    )
  assert.equal(validateAgentRecord(multiPr, 'plan'), '')
})

test('rejects a multi-PR plan without an ordered sequence', () => {
  const invalid = validPlan
    .replace(
      'Estimated authored changed lines: 240',
      'Estimated authored changed lines: 6,000',
    )
    .replace(
      'Delivery shape: One PR completes the change',
      'Delivery shape: Multiple PRs complete the feature',
    )
    .replace(
      'PR slices and acceptance evidence: One validator slice with contract tests',
      'PR slices and acceptance evidence: None',
    )
  assert.match(
    validateAgentRecord(invalid, 'plan'),
    /multi-PR plan requires at least two ordered slices/,
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
