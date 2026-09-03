import { expect, test } from 'bun:test';
import {
  GitHubAlertDensityReason,
  lintGitHubAlertDensity,
} from '../src/lib/github-alert-density.ts';

type PaddedSentenceArgs = {
  readonly length: number;
  readonly suffix: string;
};

function paddedSentence(args: PaddedSentenceArgs): string {
  const paddingLength = args.length - [...args.suffix].length;
  if (paddingLength < 1) throw new Error('sentence padding must be positive');
  return `${'😀'.repeat(paddingLength)}${args.suffix}`;
}

test('checks only GitHub alert bodies with exact paragraph spans', () => {
  const dense =
    'Require the successor branch and the open pull request and the predecessor metadata and the frozen base SHA and the containment proof before claim.';
  const findings = lintGitHubAlertDensity({
    filePath: '.cortex/policy.md',
    content: [
      `Ordinary prose ${dense}`,
      '',
      '> Command output: first; second; third.',
      '',
      `> [!NOTE] ${dense}`,
      '',
      '> [!NOTE]',
      `> ${dense}`,
      '',
      '> [!WARNING]',
      `> ${'x'.repeat(181)}.`,
      '>',
      '> Later paragraph has one; second; third.',
      '',
      '```text',
      '> [!NOTE]',
      `> ${dense}`,
      '```',
    ].join('\n'),
  });

  expect(
    findings.map(({ endLine, line, reason }) => ({ endLine, line, reason })),
  ).toEqual([
    {
      endLine: 8,
      line: 8,
      reason: GitHubAlertDensityReason.AndJoins,
    },
    {
      endLine: 11,
      line: 11,
      reason: GitHubAlertDensityReason.SentenceLength,
    },
    {
      endLine: 13,
      line: 13,
      reason: GitHubAlertDensityReason.Semicolons,
    },
  ]);
});

test('reconstructs a hard-wrapped GitHub alert body', () => {
  const findings = lintGitHubAlertDensity({
    filePath: '.cortex/wrapped.md',
    content: [
      '> [!IMPORTANT]',
      '> Require the successor branch and the open pull request and the',
      '> predecessor metadata and the frozen base SHA and the containment proof',
      '> before claim.',
    ].join('\n'),
  });
  expect(findings).toHaveLength(1);
  const finding = findings[0];
  if (!finding) throw new Error('expected hard-wrapped alert finding');
  expect(finding.line).toBe(2);
  expect(finding.endLine).toBe(4);
  expect(finding.reason).toBe(GitHubAlertDensityReason.AndJoins);
});

test('uses Unicode code-point boundaries for every length threshold', () => {
  const andSuffix = ' and one and two and three.';
  const findings = lintGitHubAlertDensity({
    filePath: '.cortex/unicode.md',
    content: [
      '> [!NOTE]',
      `> ${paddedSentence({ length: 120, suffix: andSuffix })}`,
      '',
      '> [!TIP]',
      `> ${paddedSentence({ length: 121, suffix: andSuffix })}`,
      '',
      '> [!IMPORTANT]',
      `> ${paddedSentence({ length: 180, suffix: '.' })}`,
      '',
      '> [!WARNING]',
      `> ${paddedSentence({ length: 181, suffix: '.' })}`,
    ].join('\n'),
  });
  expect(
    findings.map(({ endLine, line, reason }) => ({ endLine, line, reason })),
  ).toEqual([
    {
      endLine: 5,
      line: 5,
      reason: GitHubAlertDensityReason.AndJoins,
    },
    {
      endLine: 11,
      line: 11,
      reason: GitHubAlertDensityReason.SentenceLength,
    },
  ]);
});

test('preserves inline-code width while hiding its join tokens', () => {
  const findings = lintGitHubAlertDensity({
    filePath: '.cortex/inline-code.md',
    content: [
      '> [!NOTE]',
      `> ${'x'.repeat(100)} and one and two \`and\` three.`,
      '',
      '> [!TIP]',
      `> ${'x'.repeat(100)} \`${'y'.repeat(81)}\`.`,
    ].join('\n'),
  });
  expect(
    findings.map(({ endLine, line, reason }) => ({ endLine, line, reason })),
  ).toEqual([
    {
      endLine: 5,
      line: 5,
      reason: GitHubAlertDensityReason.SentenceLength,
    },
  ]);
});

test('checks structured list prose after a marker-only paragraph', () => {
  const findings = lintGitHubAlertDensity({
    filePath: '.cortex/list-alert.md',
    content: [
      '> [!CAUTION]',
      '>',
      '> - Require the successor branch and the open pull request and the',
      '>   predecessor metadata and the frozen base SHA and the containment proof',
      '>   before claim.',
    ].join('\n'),
  });
  expect(findings).toHaveLength(1);
  const finding = findings[0];
  if (!finding) throw new Error('expected structured alert finding');
  expect({
    endLine: finding.endLine,
    line: finding.line,
    reason: finding.reason,
  }).toEqual({
    endLine: 5,
    line: 3,
    reason: GitHubAlertDensityReason.AndJoins,
  });
});
