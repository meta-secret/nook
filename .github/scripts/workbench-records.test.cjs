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
