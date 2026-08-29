const recordSections = {
  plan: [
    '## Interpreted request',
    '## Requirements',
    '## Constraints and exclusions',
    '## Change budget and PR sequence',
    '## Initial plan',
    '## Completion evidence',
    '## Safety review',
  ],
  worklog: [
    '## Outcome',
    '## Progress',
    '## Implementation problems',
    '## Decisions',
    '## Validation',
    '## Remaining work',
  ],
}

const planBudgetFields = [
  {
    label: 'Estimated authored changed lines',
    pattern:
      /^- Estimated authored changed lines:\s*(?:0|[1-9]\d*|[1-9]\d{0,2}(?:,\d{3})+)\s*$/m,
  },
  {
    label: 'Owning modules, packages, or layers',
    pattern: /^- Owning modules, packages, or layers:\s*\S.+$/im,
  },
  {
    label: 'Ownership units',
    pattern: /^- Ownership units:\s*$/m,
  },
  {
    label: 'Public or cross-module interfaces',
    pattern: /^- Public or cross-module interfaces:\s*\S.+$/m,
  },
  {
    label: 'Delivery shape',
    pattern: /^- Delivery shape:\s*(?:One PR|Multiple PRs)\s*$/m,
  },
  {
    label: 'PR sequence mode',
    pattern:
      /^- PR sequence mode:\s*(?:One PR|Independent PRs|Stacked PRs)\s*$/m,
  },
  {
    label: 'Current PR estimated authored changed lines',
    pattern:
      /^- Current PR estimated authored changed lines:\s*(?:0|[1-9]\d*|[1-9]\d{0,2}(?:,\d{3})+)\s*$/m,
  },
  {
    label: 'Current PR slice and acceptance evidence',
    pattern: /^- Current PR slice and acceptance evidence:\s*\S.+$/im,
  },
  {
    label: 'PR slices and acceptance evidence',
    pattern: /^- PR slices and acceptance evidence:\s*(?:\S.*)?$/m,
  },
]

const placeholderPattern =
  /^(?:None|N\/A|Not applicable|TBD|Unknown|Unspecified|Pending|To be determined)$/i
const unresolvedPlaceholderPattern =
  /^(?:TBD|Unknown|Unspecified|Pending|To be determined)$/i

function isPlaceholder(value) {
  const normalized = value
    .trim()
    .replace(/^[\s`*_~"'([{<]+/, '')
    .replace(/[\s`*_~"'.,;:!?)}\]>]+$/, '')
  return placeholderPattern.test(normalized)
}

function isUnresolvedPlaceholder(value) {
  const normalized = value
    .trim()
    .replace(/^[\s`*_~"'([{<]+/, '')
    .replace(/[\s`*_~"'.,;:!?)}\]>]+$/, '')
  return unresolvedPlaceholderPattern.test(normalized)
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function countBudgetFieldLabels(candidate, label) {
  const fieldPattern = new RegExp(`^- ${escapeRegExp(label)}:`, 'gim')
  let count = 0
  for (const _match of candidate.matchAll(fieldPattern)) count += 1
  return count
}

function parseBudgetFieldValue(budgetSection, label) {
  const fieldPattern = new RegExp(
    `^- ${escapeRegExp(label)}:\\s*(.+?)\\s*$`,
    'im',
  )
  const match = fieldPattern.exec(budgetSection)
  if (!match || typeof match[1] !== 'string') {
    return { kind: 'invalid' }
  }
  return { kind: 'valid', value: match[1].trim() }
}

const functionalOwnerPattern =
  'Gizmo|AI|Development core|Security|SRE|Web development'
const expertiseProviderPattern =
  'AI|Development core|Security|SRE|Web development'

function isExactRepositoryPathList(value) {
  if (value === 'None') return false
  return value.split(',').every((entry) => {
    const path = entry.trim()
    return (
      path.length > 0 &&
      (path.includes('/') || path.includes('.')) &&
      /^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/.test(path) &&
      !path.split('/').some((segment) => segment === '.' || segment === '..')
    )
  })
}

function repositoryPathsOverlap(left, right) {
  return (
    left === right || left.startsWith(`${right}/`) || right.startsWith(`${left}/`)
  )
}

function validateOwnershipUnits(ownershipBody) {
  const lines = ownershipBody
    .trim()
    .split('\n')
    .filter((line) => line.trim())
  if (lines.length === 0) return 'plan requires at least one ownership unit'

  const unitPattern = new RegExp(
    `^(\\d+)\\. Capability: (.+?); Functional owner: (${functionalOwnerPattern}); Expertise provider: (None|${expertiseProviderPattern}); Expertise allowed code paths: (.+?); Expertise allowed test paths: (.+?); Expertise forbidden paths: (.+?); Expertise consumer interfaces: (.+?); Expertise acceptance evidence: (.+?); Capability acceptance evidence: (.+?)$`,
  )

  for (let index = 0; index < lines.length; index += 1) {
    const match = unitPattern.exec(lines[index].trim())
    if (!match || Number(match[1]) !== index + 1) {
      return 'ownership units must be consecutive and match the required contract shape'
    }

    const [
      ,
      ,
      capability,
      functionalOwner,
      expertiseProvider,
      allowedCodePaths,
      allowedTestPaths,
      forbiddenPaths,
      consumerInterfaces,
      expertiseEvidence,
      capabilityEvidence,
    ] = match
    if (isPlaceholder(capability) || isPlaceholder(capabilityEvidence)) {
      return 'ownership unit capability and acceptance evidence must be concrete'
    }

    const expertiseFields = [
      allowedCodePaths,
      allowedTestPaths,
      forbiddenPaths,
      consumerInterfaces,
      expertiseEvidence,
    ]
    if (expertiseProvider === 'None') {
      if (expertiseFields.some((value) => value !== 'None')) {
        return 'ownership unit expertise fields require a provider'
      }
      continue
    }
    if (expertiseProvider === functionalOwner) {
      return 'expertise provider must differ from the functional owner'
    }
    if (
      !isExactRepositoryPathList(allowedCodePaths) ||
      !isExactRepositoryPathList(allowedTestPaths) ||
      !isExactRepositoryPathList(forbiddenPaths)
    ) {
      return 'expertise paths must be exact comma-separated repository-relative paths'
    }
    const allowedPaths = new Set(
      `${allowedCodePaths},${allowedTestPaths}`
        .split(',')
        .map((path) => path.trim()),
    )
    const forbiddenPathEntries = forbiddenPaths
      .split(',')
      .map((path) => path.trim())
    if (
      forbiddenPathEntries.some((forbiddenPath) =>
        [...allowedPaths].some((allowedPath) =>
          repositoryPathsOverlap(allowedPath, forbiddenPath),
        ),
      )
    ) {
      return 'expertise allowed and forbidden paths must not overlap'
    }
    if (isPlaceholder(consumerInterfaces) || isPlaceholder(expertiseEvidence)) {
      return 'expertise interfaces and acceptance evidence must be concrete'
    }
  }
  return ''
}

function parseBudgetFields(budgetSection) {
  const owningBoundary = parseBudgetFieldValue(
    budgetSection,
    'Owning modules, packages, or layers',
  )
  const estimate = parseBudgetFieldValue(
    budgetSection,
    'Estimated authored changed lines',
  )
  const currentPrEstimate = parseBudgetFieldValue(
    budgetSection,
    'Current PR estimated authored changed lines',
  )
  const deliveryShape = parseBudgetFieldValue(budgetSection, 'Delivery shape')
  const sequenceMode = parseBudgetFieldValue(budgetSection, 'PR sequence mode')
  const publicInterfaces = parseBudgetFieldValue(
    budgetSection,
    'Public or cross-module interfaces',
  )
  const currentSlice = parseBudgetFieldValue(
    budgetSection,
    'Current PR slice and acceptance evidence',
  )
  const sequenceMarker = '- PR slices and acceptance evidence:'
  const sequenceStart = budgetSection.indexOf(sequenceMarker)
  const ownershipMarker = '- Ownership units:'
  const ownershipStart = budgetSection.indexOf(ownershipMarker)
  const ownershipEnd = budgetSection.indexOf('- Public or cross-module interfaces:')
  if (
    owningBoundary.kind === 'invalid' ||
    estimate.kind === 'invalid' ||
    currentPrEstimate.kind === 'invalid' ||
    deliveryShape.kind === 'invalid' ||
    sequenceMode.kind === 'invalid' ||
    publicInterfaces.kind === 'invalid' ||
    currentSlice.kind === 'invalid' ||
    sequenceStart < 0 ||
    ownershipStart < 0 ||
    ownershipEnd <= ownershipStart
  ) {
    return { kind: 'invalid' }
  }
  return {
    kind: 'valid',
    owningBoundary: owningBoundary.value,
    ownershipBody: budgetSection.slice(
      ownershipStart + ownershipMarker.length,
      ownershipEnd,
    ),
    estimate: Number(estimate.value.replaceAll(',', '')),
    currentPrEstimate: Number(currentPrEstimate.value.replaceAll(',', '')),
    deliveryShape: deliveryShape.value,
    sequenceMode: sequenceMode.value,
    publicInterfaces: publicInterfaces.value,
    currentSlice: currentSlice.value,
    sequenceBody: budgetSection.slice(sequenceStart + sequenceMarker.length),
  }
}

function parseSliceContract(value, numbered) {
  const emptyContract = { valid: false, number: 0, scope: '', evidence: '' }
  let contractText = value.trim()
  let number = 0

  if (numbered) {
    const numberedMatch = contractText.match(/^(\d+)\.\s+(.+)$/)
    if (!numberedMatch) return emptyContract
    number = Number(numberedMatch[1])
    contractText = numberedMatch[2]
  } else {
    const optionalNumberMatch = contractText.match(/^1\.\s+(.+)$/)
    if (optionalNumberMatch) contractText = optionalNumberMatch[1]
  }

  const contractMatch = contractText.match(
    /^(.+?)\s*;\s*Acceptance evidence:\s*(.+?)\s*$/i,
  )
  if (!contractMatch) return emptyContract

  const scope = contractMatch[1].trim()
  const evidence = contractMatch[2].trim()
  return {
    valid: !isPlaceholder(scope) && !isPlaceholder(evidence),
    number,
    scope,
    evidence,
  }
}

function normalizedContractValue(value) {
  return value.toLocaleLowerCase('en-US')
}

function validateBudgetFieldStructure(candidate, budgetSection) {
  for (const { label, pattern } of planBudgetFields) {
    const allMatchCount = countBudgetFieldLabels(candidate, label)
    const budgetMatchCount = countBudgetFieldLabels(budgetSection, label)
    if (allMatchCount === 0) {
      return { kind: 'invalid', message: `missing or empty plan field: ${label}` }
    }
    if (allMatchCount !== 1 || budgetMatchCount !== 1) {
      return {
        kind: 'invalid',
        message: `missing, duplicated, or misplaced plan field: ${label}`,
      }
    }
    if (!pattern.test(budgetSection)) {
      return { kind: 'invalid', message: `missing or empty plan field: ${label}` }
    }
  }
  return { kind: 'valid', message: '' }
}

const commonForbiddenPatterns = [
  /```/,
  /^\s{4}\S/m,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/i,
  /\b(?:github_pat_|gh[pousr]_|sk-)[A-Za-z0-9_-]{12,}\b/,
  /(?:^|\n)\s*[A-Z][A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|PRIVATE_KEY|API_KEY)[A-Z0-9_]*\s*[:=]\s*\S+/m,
  /\b(?:authorization|bearer|password|secret|token|api[_ -]?key|private[_ -]?key)\s*[:=]\s*\S+/i,
  /\b(?:process\.env|environment dump|raw (?:stdout|stderr|log))\b/i,
]

const planForbiddenPatterns = [
  /^## (?:Raw prompt|User prompt|Chat transcript|Conversation transcript)$/mi,
  /^(?:user|assistant|system)\s*:/mi,
  /<(?:user|assistant|system)>/i,
]

function normalizedWords(value) {
  return value
    .toLocaleLowerCase('en-US')
    .match(/[\p{L}\p{N}]+/gu) ?? []
}

function containsSourceTaskExcerpt(candidate, sourceTask) {
  if (!sourceTask) return false

  const sourceWords = normalizedWords(sourceTask)
  const candidateWords = normalizedWords(candidate)
  const excerptLength = Math.min(5, sourceWords.length)
  if (excerptLength === 0 || candidateWords.length < excerptLength) return false

  const sourceExcerpts = new Set()
  for (
    let index = 0;
    index <= sourceWords.length - excerptLength;
    index += 1
  ) {
    sourceExcerpts.add(
      sourceWords.slice(index, index + excerptLength).join(' '),
    )
  }

  for (
    let index = 0;
    index <= candidateWords.length - excerptLength;
    index += 1
  ) {
    const excerpt = candidateWords
      .slice(index, index + excerptLength)
      .join(' ')
    if (sourceExcerpts.has(excerpt)) return true
  }

  return false
}

function validateAgentRecord(candidate, kind, secrets = [], sourceTask = '') {
  if (!candidate || Buffer.byteLength(candidate, 'utf8') > 12_000) {
    return 'missing or larger than 12 KB'
  }

  const required = recordSections[kind]
  if (!required) return `unknown record kind: ${kind}`

  const headings = [...candidate.matchAll(/^## (.+)$/gm)].map(
    (match) => `## ${match[1]}`,
  )
  if (JSON.stringify(headings) !== JSON.stringify(required)) {
    return 'required sections are missing, duplicated, reordered, or extended'
  }

  for (let index = 0; index < required.length; index += 1) {
    const start = candidate.indexOf(required[index]) + required[index].length
    const end =
      index + 1 < required.length
        ? candidate.indexOf(required[index + 1])
        : candidate.length
    if (!candidate.slice(start, end).trim()) {
      return `section is empty: ${required[index]}`
    }
  }

  if (kind === 'plan') {
    const budgetStart =
      candidate.indexOf('## Change budget and PR sequence') +
      '## Change budget and PR sequence'.length
    const budgetEnd = candidate.indexOf('## Initial plan')
    const budgetSection = candidate.slice(budgetStart, budgetEnd)

    const budgetFieldState = validateBudgetFieldStructure(
      candidate,
      budgetSection,
    )
    if (budgetFieldState.kind === 'invalid') return budgetFieldState.message

    const budgetFields = parseBudgetFields(budgetSection)
    if (budgetFields.kind === 'invalid') {
      return 'plan budget fields could not be parsed'
    }
    if (isPlaceholder(budgetFields.owningBoundary)) {
      return 'missing or empty plan field: Owning modules, packages, or layers'
    }
    if (isUnresolvedPlaceholder(budgetFields.publicInterfaces)) {
      return 'missing or empty plan field: Public or cross-module interfaces'
    }

    const ownershipRejection = validateOwnershipUnits(
      budgetFields.ownershipBody,
    )
    if (ownershipRejection) return ownershipRejection

    const estimate = budgetFields.estimate
    const currentPrEstimate = budgetFields.currentPrEstimate
    const deliveryShape = budgetFields.deliveryShape
    const sequenceMode = budgetFields.sequenceMode
    const currentSlice = parseSliceContract(budgetFields.currentSlice, false)
    if (!currentSlice.valid) {
      return 'missing or empty plan field: Current PR slice and acceptance evidence'
    }

    if (estimate < 1 || currentPrEstimate < 1) {
      return 'authored changed-line estimates must be positive integers'
    }
    if (currentPrEstimate > 2_000) {
      return 'current PR estimate exceeds 2,000 authored changed lines'
    }
    if (estimate < currentPrEstimate) {
      return 'feature estimate must be at least the current PR estimate'
    }
    if (deliveryShape === 'One PR' && estimate > 2_000) {
      return 'one-PR plan exceeds 2,000 authored changed lines'
    }
    if (deliveryShape === 'One PR' && estimate !== currentPrEstimate) {
      return 'one-PR feature and current PR estimates must match'
    }
    if (deliveryShape === 'One PR' && sequenceMode !== 'One PR') {
      return 'one-PR delivery requires one-PR sequence mode'
    }
    if (deliveryShape === 'Multiple PRs' && sequenceMode === 'One PR') {
      return 'multi-PR delivery requires independent or stacked sequence mode'
    }
    if (estimate > 2_000 && sequenceMode !== 'Stacked PRs') {
      return 'feature above 2,000 authored changed lines requires stacked PRs'
    }

    const sequenceBody = budgetFields.sequenceBody
    if (deliveryShape === 'Multiple PRs') {
      const sliceLines = sequenceBody
        .trim()
        .split('\n')
        .filter((line) => line.trim())
      const orderedSlices = sliceLines.map((line) =>
        parseSliceContract(line, true),
      )
      const hasExactSequence = orderedSlices.every(
        (slice, index) => slice.valid && slice.number === index + 1,
      )
      if (sliceLines.length < 2 || !hasExactSequence) {
        return 'multi-PR plan requires at least two ordered slices with acceptance evidence'
      }
      const firstSlice = orderedSlices[0]
      if (
        normalizedContractValue(firstSlice.scope) !==
          normalizedContractValue(currentSlice.scope) ||
        normalizedContractValue(firstSlice.evidence) !==
          normalizedContractValue(currentSlice.evidence)
      ) {
        return 'multi-PR plan requires its first slice to match the current PR contract'
      }
    } else {
      const sliceLines = sequenceBody
        .trim()
        .split('\n')
        .filter((line) => line.trim())
      let sequenceSlice = {
        valid: false,
        number: 0,
        scope: '',
        evidence: '',
      }
      if (sliceLines.length === 1) {
        sequenceSlice = parseSliceContract(sliceLines[0], false)
      }
      if (
        sliceLines.length !== 1 ||
        !sequenceSlice.valid ||
        normalizedContractValue(sequenceSlice.scope) !==
          normalizedContractValue(currentSlice.scope) ||
        normalizedContractValue(sequenceSlice.evidence) !==
          normalizedContractValue(currentSlice.evidence)
      ) {
        return 'one-PR plan requires one slice matching the current PR contract'
      }
    }
  }

  const concreteSecrets = secrets.filter(
    (secret) => secret && secret.length >= 8,
  )
  if (concreteSecrets.some((secret) => candidate.includes(secret))) {
    return 'content contains a workflow credential'
  }

  const forbidden =
    kind === 'plan'
      ? [...commonForbiddenPatterns, ...planForbiddenPatterns]
      : commonForbiddenPatterns
  if (forbidden.some((pattern) => pattern.test(candidate))) {
    return 'content resembles a transcript, credential, environment dump, or raw log'
  }

  if (containsSourceTaskExcerpt(candidate, sourceTask)) {
    return 'content contains a verbatim source-task excerpt'
  }

  return ''
}

module.exports = { validateAgentRecord }
