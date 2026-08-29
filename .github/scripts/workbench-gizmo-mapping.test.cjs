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

function boundedMultiPlan(mode = 'Independent PRs', predecessor = 'None') {
  return plan({
    featureEstimate: '2,000',
    currentEstimate: '1,000',
    shape: 'Multiple PRs',
    mode,
    ownershipUnits: [
      ownershipUnit(1, 'gizmo-1'),
      ownershipUnit(2, 'gizmo-2', 'Publisher'),
    ],
    slices: [
      slice(1, 'gizmo-1', 'Validator', 'None', '1,000'),
      slice(2, 'gizmo-2', 'Publisher', predecessor, '1,000', 'Publisher'),
    ],
  })
}

function validate(candidate, assignedGizmoId = '') {
  return validateAgentRecord(candidate, 'plan', [], '', { assignedGizmoId })
}

test('accepts a 200-line one-Gizmo plan with multiple ownership units', () => {
  const candidate = plan({
    ownershipUnits: [
      ownershipUnit(1, 'gizmo-1'),
      ownershipUnit(2, 'gizmo-1', 'Publication'),
    ],
  })
  assert.equal(validate(candidate), '')
})

test('rejects one-PR delivery with multiple Gizmos', () => {
  const candidate = plan({
    slices: [
      slice(1, 'gizmo-1', 'Validator', 'None', '100'),
      slice(2, 'gizmo-2', 'Publisher', 'None', '100'),
    ],
  })
  assert.match(validate(candidate), /one-PR plan requires one numbered slice/)
})

test('rejects an over-2,000 feature represented by one Gizmo', () => {
  const candidate = stackedPlan()
    .replaceAll('Gizmo ID: gizmo-2', 'Gizmo ID: gizmo-1')
    .replace('Predecessor Gizmo ID: gizmo-1', 'Predecessor Gizmo ID: None')
  assert.match(validate(candidate), /unique Gizmo ID/)
})

for (const [label, replacement, rejection] of [
  ['duplicate ID', ['2. Gizmo ID: gizmo-2', '2. Gizmo ID: gizmo-1'], /unique Gizmo ID/],
  ['duplicate name', ['Gizmo name: Publisher', 'Gizmo name: Validator'], /unique Gizmo name/],
  ['empty name', ['Gizmo name: Validator', 'Gizmo name:   '], /requires at least two consecutively numbered slices/],
]) {
  test(`rejects a Gizmo ${label}`, () =>
    assert.match(validate(stackedPlan().replace(...replacement)), rejection))
}

test('rejects a declared Gizmo without ownership-unit mapping', () => {
  const candidate = stackedPlan().replace(`\n${ownershipUnit(2, 'gizmo-2', 'Publisher')}`, '')
  assert.match(validate(candidate), /every declared PR slice Gizmo must own/)
})

test('rejects an ownership unit mapped to an undeclared Gizmo', () => {
  const candidate = plan().replace(
    'Gizmo ID: gizmo-1; Functional owner: AI',
    'Gizmo ID: gizmo-missing; Functional owner: AI',
  )
  assert.match(validate(candidate), /every ownership unit must reference/)
})

test('rejects a current Gizmo that differs from the first slice', () => {
  const candidate = plan({ currentGizmoId: 'gizmo-2' })
  assert.match(validate(candidate), /current Gizmo ID must match/)
})

test('accepts a plan bound to its trusted focused-issue Gizmo ID', () => {
  assert.equal(validate(plan(), 'gizmo-1'), '')
})

test('accepts a canonical Gizmo ID that starts with a digit', () => {
  const canonicalId = '2fa-slice'
  const candidate = plan({
    currentGizmoId: canonicalId,
    ownershipUnits: [ownershipUnit(1, canonicalId)],
    slices: [slice(1, canonicalId, 'Validator', 'None', '200')],
  })
  assert.equal(validate(candidate, canonicalId), '')
})

for (const invalidId of ['slice--one', 'slice-']) {
  test(`rejects noncanonical Gizmo ID ${invalidId}`, () => {
    const candidate = plan({
      currentGizmoId: invalidId,
      ownershipUnits: [ownershipUnit(1, invalidId)],
      slices: [slice(1, invalidId, 'Validator', 'None', '200')],
    })
    assert.notEqual(validate(candidate), '')
    assert.match(
      validate(plan(), invalidId),
      /trusted assigned Gizmo ID is invalid/,
    )
  })
}

test('accepts multiple ownership units bound to one trusted Gizmo ID', () => {
  const candidate = plan({
    ownershipUnits: [
      ownershipUnit(1, 'gizmo-1'),
      ownershipUnit(2, 'gizmo-1', 'Publisher'),
    ],
  })
  assert.equal(validate(candidate, 'gizmo-1'), '')
})

for (const [name, candidate, assignedId, rejection] of [
  ['a different plan ID', plan(), 'gizmo-2', /trusted focused-issue Gizmo ID/],
  ['multi-PR delivery', stackedPlan(), 'gizmo-1', /requires one-PR delivery/],
  ['a different sole slice ID', plan({ slices: [slice(1, 'gizmo-2', 'Validator', 'None', '200')] }), 'gizmo-1', /sole PR slice must use/],
  ['a different ownership ID', plan({ ownershipUnits: [ownershipUnit(1, 'gizmo-2')] }), 'gizmo-1', /every ownership unit must use/],
  ['an invalid trusted ID', plan(), 'Gizmo 1', /trusted assigned Gizmo ID is invalid/],
]) {
  test(`rejects ${name} for a trusted focused issue`, () =>
    assert.match(validate(candidate, assignedId), rejection))
}

test('accepts predecessor-free independent PRs at the 2,000-line ceiling', () => {
  assert.equal(validate(boundedMultiPlan()), '')
})

for (const [name, mode, rejection] of [
  ['stacked PRs at the ceiling', 'Stacked PRs', /requires independent PRs/],
  ['dependent independent PRs', 'Independent PRs', /must not declare predecessor/],
]) {
  test(`rejects ${name}`, () =>
    assert.match(validate(boundedMultiPlan(mode, 'gizmo-1')), rejection))
}

test('rejects a nonconsecutive stacked Gizmo predecessor', () => {
  const candidate = stackedPlan().replace(
    'Predecessor Gizmo ID: gizmo-1; Publisher',
    'Predecessor Gizmo ID: None; Publisher',
  )
  assert.match(validate(candidate), /predecessors must follow consecutive/)
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
