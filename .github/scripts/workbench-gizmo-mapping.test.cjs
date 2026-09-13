/** @type {(moduleName: string) => unknown} */
const loadBuiltin = /** @type {(moduleName: string) => unknown} */ (process.getBuiltinModule.bind(process))
/** @type {typeof import('node:assert/strict')} */
const assert = /** @type {typeof import('node:assert/strict')} */ (loadBuiltin('node:assert/strict'))
/** @type {typeof import('node:test')} */
const test = /** @type {typeof import('node:test')} */ (loadBuiltin('node:test'))

/**
 * @template T
 * @param {string} modulePath
 * @returns {T}
 */
function loadModule(modulePath) {
  const loaded = /** @type {unknown} */ (module.require(modulePath))
  if (!loaded || typeof loaded !== 'object') {
    throw new Error('module has an invalid contract')
  }
  return /** @type {T} */ (loaded)
}

/** @typedef {(candidate: string, kind: string, issues?: string[], sourceTask?: string, metadata?: { assignedGizmoId?: string }) => string} ValidateAgentRecord */
/** @type {{ validateAgentRecord: ValidateAgentRecord }} */
const recordsModule = loadModule('./workbench-records.cjs')
const validateAgentRecord = recordsModule.validateAgentRecord

/** @param {number} number @param {string} gizmoId @param {string} [capability] */
function ownershipUnit(number, gizmoId, capability = 'Plan validation') {
  return `${number}. Capability: ${capability}; Gizmo ID: ${gizmoId}; Functional owner: AI; Expertise provider: None; Expertise allowed code paths: None; Expertise allowed test paths: None; Expertise forbidden paths: None; Expertise consumer interfaces: None; Expertise acceptance evidence: None; Capability acceptance evidence: Contract tests pass`
}

/** @param {number} number @param {string} gizmoId @param {string} [predecessor] @param {string} [scope] @param {number} [estimate] @param {string} [evidence] */
function slice(number, gizmoId, predecessor = 'None', scope = 'Validator', estimate = 200, evidence = 'Contract tests pass') {
  return `${number}. Gizmo ID: ${gizmoId}; Gizmo name: Validator ${number}; Predecessor Gizmo ID: ${predecessor}; ${scope}; Estimated authored changed lines: ${estimate}; Acceptance evidence: ${evidence}`
}

function plan({
  currentGizmoId = 'gizmo-1',
  ownershipUnits = [ownershipUnit(1, 'gizmo-1')],
  slices = [slice(1, 'gizmo-1')],
  shape = 'One PR',
  mode = 'One PR',
  totalEstimate = 200,
  currentEstimate = 200,
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
- Estimated authored changed lines: ${totalEstimate}
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

/** @param {string} candidate @param {string} [assignedGizmoId] */
function validate(candidate, assignedGizmoId = '') {
  return validateAgentRecord(candidate, 'plan', [], '', { assignedGizmoId })
}

void test('accepts multiple ownership units mapped to the sole Gizmo', () => {
  const candidate = plan({
    ownershipUnits: [
      ownershipUnit(1, 'gizmo-1'),
      ownershipUnit(2, 'gizmo-1', 'Publication'),
    ],
  })
  assert.equal(validate(candidate, 'gizmo-1'), '')
})

void test('accepts a canonical Gizmo ID that starts with a digit', () => {
  const candidate = plan({
    currentGizmoId: '2fa-slice',
    ownershipUnits: [ownershipUnit(1, '2fa-slice')],
    slices: [slice(1, '2fa-slice')],
  })
  assert.equal(validate(candidate, '2fa-slice'), '')
})

void test('accepts a strictly sequential multi-PR feature plan', () => {
  const candidate = plan({
    currentGizmoId: 'gizmo-1',
    ownershipUnits: [
      ownershipUnit(1, 'gizmo-1'),
      ownershipUnit(2, 'gizmo-2', 'Publisher adoption'),
    ],
    slices: [
      slice(1, 'gizmo-1', 'None', 'Validator', 1200),
      slice(2, 'gizmo-2', 'gizmo-1', 'Publisher', 1200, 'Publisher tests pass'),
    ],
    shape: 'Multiple PRs',
    mode: 'Sequential PRs',
    totalEstimate: 2400,
    currentEstimate: 1200,
  })
  assert.equal(validate(candidate, 'gizmo-1'), '')
})

void test('rejects a predecessor on the sole PR row', () => {
  assert.match(
    validate(plan({ slices: [slice(1, 'gizmo-1', 'gizmo-0')] })),
    /must not declare a predecessor/,
  )
})

for (const [shape, mode] of [
  ['Multiple PRs', 'Independent PRs'],
  ['Multiple PRs', 'Stacked PRs'],
]) {
void   test(`rejects ${mode}`, () => {
    assert.notEqual(validate(plan({ shape, mode })), '')
  })
}

void test('rejects a sequential slice whose predecessor is not the prior slice', () => {
  const candidate = plan({
    ownershipUnits: [
      ownershipUnit(1, 'gizmo-1'),
      ownershipUnit(2, 'gizmo-2', 'Publisher adoption'),
    ],
    slices: [
      slice(1, 'gizmo-1', 'None', 'Validator', 1200),
      slice(2, 'gizmo-2', 'None', 'Publisher', 1200, 'Publisher tests pass'),
    ],
    shape: 'Multiple PRs',
    mode: 'Sequential PRs',
    totalEstimate: 2400,
    currentEstimate: 1200,
  })
  assert.match(validate(candidate), /immediately preceding Gizmo ID/)
})

void test('rejects sequential delivery when the complete feature fits one PR', () => {
  const candidate = plan({
    ownershipUnits: [
      ownershipUnit(1, 'gizmo-1'),
      ownershipUnit(2, 'gizmo-2', 'Publisher adoption'),
    ],
    slices: [
      slice(1, 'gizmo-1', 'None', 'Validator', 1000),
      slice(2, 'gizmo-2', 'gizmo-1', 'Publisher', 1000, 'Publisher tests pass'),
    ],
    shape: 'Multiple PRs',
    mode: 'Sequential PRs',
    totalEstimate: 2000,
    currentEstimate: 1000,
  })
  assert.match(validate(candidate), /necessary feature estimate above 2,000/)
})

void test('rejects sequential slices with duplicate observable functionality', () => {
  const candidate = plan({
    ownershipUnits: [
      ownershipUnit(1, 'gizmo-1'),
      ownershipUnit(2, 'gizmo-2', 'Publisher adoption'),
    ],
    slices: [
      slice(1, 'gizmo-1', 'None', 'Validator', 1200),
      slice(2, 'gizmo-2', 'gizmo-1', 'Validator', 1200),
    ],
    shape: 'Multiple PRs',
    mode: 'Sequential PRs',
    totalEstimate: 2400,
    currentEstimate: 1200,
  })
  assert.match(validate(candidate), /distinct observable functionality/)
})

void test('rejects sequential slices with duplicate acceptance evidence', () => {
  const candidate = plan({
    ownershipUnits: [
      ownershipUnit(1, 'gizmo-1'),
      ownershipUnit(2, 'gizmo-2', 'Publisher adoption'),
    ],
    slices: [
      slice(1, 'gizmo-1', 'None', 'Validator', 1200),
      slice(2, 'gizmo-2', 'gizmo-1', 'Publisher', 1200),
    ],
    shape: 'Multiple PRs',
    mode: 'Sequential PRs',
    totalEstimate: 2400,
    currentEstimate: 1200,
  })
  assert.match(validate(candidate), /distinct acceptance evidence/)
})

void test('rejects an ownership unit mapped to an undeclared Gizmo', () => {
  assert.match(
    validate(plan({ ownershipUnits: [ownershipUnit(1, 'gizmo-missing')] })),
    /every ownership unit must reference/,
  )
})

void test('rejects a current Gizmo that differs from the sole row', () => {
  assert.match(
    validate(plan({ currentGizmoId: 'gizmo-2' })),
    /current Gizmo ID must match/,
  )
})

for (const invalidId of ['slice--one', 'slice-']) {
void   test(`rejects noncanonical Gizmo ID ${invalidId}`, () => {
    assert.match(validate(plan(), invalidId), /trusted assigned Gizmo ID is invalid/)
  })
}

void test('rejects a different plan ID for a trusted focused issue', () => {
  assert.match(validate(plan(), 'gizmo-2'), /trusted focused-issue Gizmo ID/)
})

for (const forbiddenField of ['Parent Gizmo ID', 'Child Gizmo', 'Nested Gizmo ID']) {
void   test(`rejects ${forbiddenField} fields`, () => {
    const candidate = plan().replace(
      '- Current Gizmo ID: gizmo-1',
      `- Current Gizmo ID: gizmo-1\n- ${forbiddenField}: gizmo-2`,
    )
    assert.match(validate(candidate), /nested or child Gizmo fields/)
  })
}
