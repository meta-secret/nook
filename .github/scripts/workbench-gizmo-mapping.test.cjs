const assert = require('node:assert/strict')
const test = require('node:test')

const { validateAgentRecord } = require('./workbench-records.cjs')

function ownershipUnit(number, gizmoId, capability = 'Plan validation') {
  return `${number}. Capability: ${capability}; Gizmo ID: ${gizmoId}; Functional owner: AI; Expertise provider: None; Expertise allowed code paths: None; Expertise allowed test paths: None; Expertise forbidden paths: None; Expertise consumer interfaces: None; Expertise acceptance evidence: None; Capability acceptance evidence: Contract tests pass`
}

function slice(number, gizmoId, predecessor = 'None', scope = 'Validator') {
  return `${number}. Gizmo ID: ${gizmoId}; Gizmo name: Validator; Predecessor Gizmo ID: ${predecessor}; ${scope}; Estimated authored additions: 200; Estimated authored deletions (reported only): 0; Acceptance evidence: Contract tests pass`
}

function plan({
  currentGizmoId = 'gizmo-1',
  ownershipUnits = [ownershipUnit(1, 'gizmo-1')],
  slices = [slice(1, 'gizmo-1')],
  shape = 'One PR',
  mode = 'One PR',
} = {}) {
  return `# Task plan

## Interpreted request

Deliver one mapped PR.

## Requirements

- Validate every controller mapping.

## Constraints and exclusions

- Keep delivery bounded.

## Change budget and PR sequence

- Mission controller: Gizmo Prime
- Current Gizmo ID: ${currentGizmoId}
- Estimated authored additions: 200
- Estimated authored deletions (reported only): 0
- Owning modules, packages, or layers: Workbench records
- Ownership units:
${ownershipUnits.join('\n')}
- Public or cross-module interfaces: Plan contract
- Delivery shape: ${shape}
- PR sequence mode: ${mode}
- Current PR estimated authored additions: 200
- Current PR estimated authored deletions (reported only): 0
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

function validate(candidate, assignedGizmoId = '') {
  return validateAgentRecord(candidate, 'plan', [], '', { assignedGizmoId })
}

test('accepts multiple ownership units mapped to the sole Gizmo', () => {
  const candidate = plan({
    ownershipUnits: [
      ownershipUnit(1, 'gizmo-1'),
      ownershipUnit(2, 'gizmo-1', 'Publication'),
    ],
  })
  assert.equal(validate(candidate, 'gizmo-1'), '')
})

test('accepts a canonical Gizmo ID that starts with a digit', () => {
  const candidate = plan({
    currentGizmoId: '2fa-slice',
    ownershipUnits: [ownershipUnit(1, '2fa-slice')],
    slices: [slice(1, '2fa-slice')],
  })
  assert.equal(validate(candidate, '2fa-slice'), '')
})

test('rejects multiple PR rows', () => {
  assert.match(
    validate(plan({ slices: [slice(1, 'gizmo-1'), slice(2, 'gizmo-2')] })),
    /one-PR plan requires one numbered slice/,
  )
})

test('rejects a predecessor on the sole PR row', () => {
  assert.match(
    validate(plan({ slices: [slice(1, 'gizmo-1', 'gizmo-0')] })),
    /must not declare a predecessor/,
  )
})

for (const [shape, mode] of [
  ['Multiple PRs', 'Independent PRs'],
  ['Multiple PRs', 'Stacked PRs'],
]) {
  test(`rejects ${mode}`, () => {
    assert.notEqual(validate(plan({ shape, mode })), '')
  })
}

test('rejects an ownership unit mapped to an undeclared Gizmo', () => {
  assert.match(
    validate(plan({ ownershipUnits: [ownershipUnit(1, 'gizmo-missing')] })),
    /every ownership unit must reference/,
  )
})

test('rejects a current Gizmo that differs from the sole row', () => {
  assert.match(
    validate(plan({ currentGizmoId: 'gizmo-2' })),
    /current Gizmo ID must match/,
  )
})

for (const invalidId of ['slice--one', 'slice-']) {
  test(`rejects noncanonical Gizmo ID ${invalidId}`, () => {
    assert.match(validate(plan(), invalidId), /trusted assigned Gizmo ID is invalid/)
  })
}

test('rejects a different plan ID for a trusted focused issue', () => {
  assert.match(validate(plan(), 'gizmo-2'), /trusted focused-issue Gizmo ID/)
})

for (const forbiddenField of ['Parent Gizmo ID', 'Child Gizmo', 'Nested Gizmo ID']) {
  test(`rejects ${forbiddenField} fields`, () => {
    const candidate = plan().replace(
      '- Current Gizmo ID: gizmo-1',
      `- Current Gizmo ID: gizmo-1\n- ${forbiddenField}: gizmo-2`,
    )
    assert.match(validate(candidate), /nested or child Gizmo fields/)
  })
}
