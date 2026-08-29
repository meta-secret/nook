const assert = require('node:assert/strict')
const test = require('node:test')

const { validateAgentRecord } = require('./workbench-records.cjs')

function ownershipUnit(number, gizmoId, capability = 'Plan validation') {
  return `${number}. Capability: ${capability}; Gizmo ID: ${gizmoId}; Functional owner: AI; Expertise provider: None; Expertise allowed code paths: None; Expertise allowed test paths: None; Expertise forbidden paths: None; Expertise consumer interfaces: None; Expertise acceptance evidence: None; Capability acceptance evidence: Contract tests pass`
}

function slice(number, gizmoId, name, predecessor, estimate, scope = 'Validator') {
  return `${number}. Gizmo ID: ${gizmoId}; Gizmo name: ${name}; Predecessor Gizmo ID: ${predecessor}; ${scope}; Estimated authored changed lines: ${estimate}; Acceptance evidence: Contract tests pass`
}

function plan({
  featureEstimate = '200',
  currentEstimate = '200',
  shape = 'One PR',
  mode = 'One PR',
  currentGizmoId = 'gizmo-1',
  ownershipUnits = [ownershipUnit(1, 'gizmo-1')],
  slices = [slice(1, 'gizmo-1', 'Validator', 'None', '200')],
} = {}) {
  return `# Task plan

## Interpreted request

Deliver mapped PR slices.

## Requirements

- Validate every controller mapping.

## Constraints and exclusions

- Keep delivery bounded.

## Change budget and PR sequence

- Mission controller: Gizmo Prime
- Current Gizmo ID: ${currentGizmoId}
- Estimated authored changed lines: ${featureEstimate}
- Owning modules, packages, or layers: Workbench records
- Ownership units:
${ownershipUnits.join('\n')}
- Public or cross-module interfaces: Plan contract
- Delivery shape: ${shape}
- PR sequence mode: ${mode}
- Current PR estimated authored changed lines: ${currentEstimate}
- Current PR slice and acceptance evidence: Validator; Acceptance evidence: Contract tests pass
- PR slices, estimates, and acceptance evidence:
${slices.join('\n')}

## Initial plan

1. Validate the mapping.

## Completion evidence

- Contract tests pass.

## Safety review

- Contains public-safe development context.
`
}

function stackedPlan() {
  return plan({
    featureEstimate: '2,200',
    currentEstimate: '1,000',
    shape: 'Multiple PRs',
    mode: 'Stacked PRs',
    ownershipUnits: [
      ownershipUnit(1, 'gizmo-1'),
      ownershipUnit(2, 'gizmo-2', 'Publisher'),
    ],
    slices: [
      slice(1, 'gizmo-1', 'Validator', 'None', '1,000'),
      slice(2, 'gizmo-2', 'Publisher', 'gizmo-1', '1,200', 'Publisher'),
    ],
  })
}

test('accepts a 200-line one-Gizmo plan with multiple ownership units', () => {
  const candidate = plan({
    ownershipUnits: [
      ownershipUnit(1, 'gizmo-1'),
      ownershipUnit(2, 'gizmo-1', 'Publication'),
    ],
  })
  assert.equal(validateAgentRecord(candidate, 'plan'), '')
})

test('rejects one-PR delivery with multiple Gizmos', () => {
  const candidate = plan({
    slices: [
      slice(1, 'gizmo-1', 'Validator', 'None', '100'),
      slice(2, 'gizmo-2', 'Publisher', 'None', '100'),
    ],
  })
  assert.match(validateAgentRecord(candidate, 'plan'), /one-PR plan requires one numbered slice/)
})

test('rejects an over-2,000 feature represented by one Gizmo', () => {
  const candidate = stackedPlan()
    .replaceAll('Gizmo ID: gizmo-2', 'Gizmo ID: gizmo-1')
    .replace('Predecessor Gizmo ID: gizmo-1', 'Predecessor Gizmo ID: None')
  assert.match(validateAgentRecord(candidate, 'plan'), /unique Gizmo ID/)
})

for (const [label, replacement, rejection] of [
  ['ID', ['2. Gizmo ID: gizmo-2', '2. Gizmo ID: gizmo-1'], /unique Gizmo ID/],
  ['name', ['Gizmo name: Publisher', 'Gizmo name: Validator'], /unique Gizmo name/],
]) {
  test(`rejects a duplicate Gizmo ${label}`, () => {
    const candidate = stackedPlan().replace(...replacement)
    assert.match(validateAgentRecord(candidate, 'plan'), rejection)
  })
}

test('rejects a declared Gizmo without ownership-unit mapping', () => {
  const candidate = stackedPlan().replace(`\n${ownershipUnit(2, 'gizmo-2', 'Publisher')}`, '')
  assert.match(validateAgentRecord(candidate, 'plan'), /every declared PR slice Gizmo must own/)
})

test('rejects an ownership unit mapped to an undeclared Gizmo', () => {
  const candidate = plan().replace(
    'Gizmo ID: gizmo-1; Functional owner: AI',
    'Gizmo ID: gizmo-missing; Functional owner: AI',
  )
  assert.match(validateAgentRecord(candidate, 'plan'), /every ownership unit must reference/)
})

test('rejects a current Gizmo that differs from the first slice', () => {
  const candidate = plan({ currentGizmoId: 'gizmo-2' })
  assert.match(validateAgentRecord(candidate, 'plan'), /current Gizmo ID must match/)
})

test('rejects a nonconsecutive stacked Gizmo predecessor', () => {
  const candidate = stackedPlan().replace(
    'Predecessor Gizmo ID: gizmo-1; Publisher',
    'Predecessor Gizmo ID: None; Publisher',
  )
  assert.match(validateAgentRecord(candidate, 'plan'), /predecessors must follow consecutive/)
})

for (const forbiddenField of ['Parent Gizmo ID', 'Child Gizmo', 'Nested Gizmo ID']) {
  test(`rejects ${forbiddenField} fields`, () => {
    const candidate = plan().replace(
      '- Current Gizmo ID: gizmo-1',
      `- Current Gizmo ID: gizmo-1\n- ${forbiddenField}: gizmo-2`,
    )
    assert.match(validateAgentRecord(candidate, 'plan'), /nested or child Gizmo fields/)
  })
}
