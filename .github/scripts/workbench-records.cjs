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
    pattern: /^- Estimated authored changed lines:\s*\d[\d,]*\s*$/m,
  },
  {
    label: 'Owning modules, packages, or layers',
    pattern: /^- Owning modules, packages, or layers:\s*\S.+$/im,
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
    label: 'Current PR estimated authored changed lines',
    pattern:
      /^- Current PR estimated authored changed lines:\s*\d[\d,]*\s*$/m,
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

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
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
    valid:
      !placeholderPattern.test(scope) &&
      !placeholderPattern.test(evidence),
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
    const fieldPattern = new RegExp(`^- ${escapeRegExp(label)}:`, 'gm')
    const allMatches = candidate.match(fieldPattern) ?? []
    const budgetMatches = budgetSection.match(fieldPattern) ?? []
    if (allMatches.length === 0) {
      return { kind: 'invalid', message: `missing or empty plan field: ${label}` }
    }
    if (allMatches.length !== 1 || budgetMatches.length !== 1) {
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
  const excerptLength = Math.min(12, sourceWords.length)
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

    const owningBoundary = budgetSection
      .match(/^- Owning modules, packages, or layers:\s*(.+)$/im)[1]
      .trim()
    if (placeholderPattern.test(owningBoundary)) {
      return 'missing or empty plan field: Owning modules, packages, or layers'
    }

    const estimate = Number(
      budgetSection
        .match(/^- Estimated authored changed lines:\s*([\d,]+)\s*$/m)[1]
        .replaceAll(',', ''),
    )
    const currentPrEstimate = Number(
      budgetSection
        .match(
          /^- Current PR estimated authored changed lines:\s*([\d,]+)\s*$/m,
        )[1]
        .replaceAll(',', ''),
    )
    const deliveryShape = budgetSection
      .match(/^- Delivery shape:\s*(One PR|Multiple PRs)\s*$/im)[1]
      .trim()

    const currentSliceValue = budgetSection.match(
      /^- Current PR slice and acceptance evidence:\s*(.+)$/im,
    )[1]
    const currentSlice = parseSliceContract(currentSliceValue, false)
    if (!currentSlice.valid) {
      return 'missing or empty plan field: Current PR slice and acceptance evidence'
    }

    if (estimate < 1 || currentPrEstimate < 1) {
      return 'authored changed-line estimates must be positive integers'
    }
    if (currentPrEstimate > 5_000) {
      return 'current PR estimate exceeds 5,000 authored changed lines'
    }
    if (deliveryShape === 'One PR' && estimate > 5_000) {
      return 'one-PR plan exceeds 5,000 authored changed lines'
    }

    const sequenceBody = budgetSection
      .split(/^- PR slices and acceptance evidence:\s*/m)[1]
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

  if (kind === 'plan' && containsSourceTaskExcerpt(candidate, sourceTask)) {
    return 'content contains a verbatim source-task excerpt'
  }

  return ''
}

module.exports = { validateAgentRecord }
