export type DensityFinding = {
  readonly file: string
  readonly line: number
  readonly reason: string
  readonly excerpt: string
}

const MAX_SENTENCE_CHARS = 180
const MAX_SEMICOLONS = 1
const MAX_AND_JOINS = 2

export function lintProseDensity(
  filePath: string,
  content: string,
): DensityFinding[] {
  const findings: DensityFinding[] = []
  const lines = content.split(/\r?\n/)
  let inFence = false

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? ''
    const trimmed = line.trim()
    if (trimmed.startsWith('```')) {
      inFence = !inFence
      continue
    }
    if (inFence || trimmed.length === 0 || trimmed.startsWith('|')) {
      continue
    }
    if (trimmed.startsWith('- ') || trimmed.startsWith('* ') || trimmed.startsWith('#')) {
      continue
    }

    const sentenceChunks = trimmed.split(/(?<=[.!?])\s+/)
    for (const sentence of sentenceChunks) {
      if (sentence.length > MAX_SENTENCE_CHARS) {
        findings.push({
          file: filePath,
          line: i + 1,
          reason: `sentence longer than ${MAX_SENTENCE_CHARS} characters`,
          excerpt: sentence.slice(0, 120),
        })
      }
      const semicolonMatches = sentence.match(/;/g)
      const semicolons = semicolonMatches ? semicolonMatches.length : 0
      if (semicolons > MAX_SEMICOLONS) {
        findings.push({
          file: filePath,
          line: i + 1,
          reason: 'too many semicolons in one sentence',
          excerpt: sentence.slice(0, 120),
        })
      }
      const andMatches = sentence.match(/\sand\s/gi)
      const andJoins = andMatches ? andMatches.length : 0
      if (andJoins > MAX_AND_JOINS && sentence.length > 120) {
        findings.push({
          file: filePath,
          line: i + 1,
          reason: 'many "and" joins in a long sentence',
          excerpt: sentence.slice(0, 120),
        })
      }
    }
  }

  return findings
}
