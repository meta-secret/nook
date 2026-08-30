import { describe, expect, test } from 'bun:test';
import { lintProseDensity } from '../src/lib/density.ts';

import type { LintProseDensityArgs } from '../src/lib/density.ts';
describe('lintProseDensity', () => {
  test('flags dense sentences', () => {
    const long =
      'This sentence keeps adding clauses and constraints and failure modes and commands until it becomes too dense for a single pass reader who also needs to remember actors and extras.';
    const findingsArgs: LintProseDensityArgs = {
      filePath: 'demo.md',
      content: long,
    };
    const findings = lintProseDensity(findingsArgs);
    expect(findings.length).toBeGreaterThan(0);
    const reasons = findings.map((item) => item.reason).join(' ');
    expect(reasons.includes('and') || reasons.includes('longer')).toBe(true);
  });

  test('ignores fenced code blocks', () => {
    const content = [
      '```bash',
      'echo one and two and three and four and five and six and seven and eight and nine and ten and eleven',
      '```',
    ].join('\n');
    const lintProseDensityArgs: LintProseDensityArgs = {
      filePath: 'demo.md',
      content,
    };
    expect(lintProseDensity(lintProseDensityArgs)).toEqual([]);
  });

  test('ignores quoted command output and log excerpts', () => {
    const content = [
      '> Command output: includes one actor and another actor and a branch and a',
      '> credential and a failure mode and a recovery path and enough quoted detail',
      '> to exceed the density threshold without becoming authored Cortex prose.',
    ].join('\n');
    const lintArgs: LintProseDensityArgs = {
      filePath: 'quoted-output.md',
      content,
    };
    expect(lintProseDensity(lintArgs)).toEqual([]);
  });

  test('checks ordinary paragraphs that begin with an output label', () => {
    const content = [
      'Command output: Require the successor branch and the open pull request and',
      'the predecessor metadata and the frozen base SHA and the containment proof',
      'and the delivery state before any claim can proceed.',
    ].join('\n');
    const lintArgs: LintProseDensityArgs = {
      filePath: 'authored-output-label.md',
      content,
    };
    expect(lintProseDensity(lintArgs).length).toBeGreaterThan(0);
  });

  test('checks list items that begin with an output label', () => {
    const content = [
      '- Log output: Require the successor branch and the open pull request and the',
      '  predecessor metadata and the frozen base SHA and the containment proof and',
      '  the delivery state before any claim can proceed.',
    ].join('\n');
    const lintArgs: LintProseDensityArgs = {
      filePath: 'authored-output-list.md',
      content,
    };
    const findings = lintProseDensity(lintArgs);
    expect(findings.some((finding) => finding.line === 1)).toBe(true);
  });

  test('checks normative prose after labeled output in one blockquote', () => {
    const content = [
      '> Command output: includes one actor and another actor and a branch and a',
      '> credential and a failure mode and a recovery path and enough quoted detail',
      '> to exceed the density threshold without becoming authored Cortex prose.',
      '>',
      '> Log excerpt: includes one request and another request and a retry and a',
      '> timeout and a failure and a recovery and enough operational detail to',
      '> exceed the density threshold without becoming authored Cortex prose.',
      '>',
      '> **Requirement:** The workflow requires the successor branch and the open',
      '> pull request and the predecessor metadata and the frozen base SHA and the',
      '> containment proof and the delivery state before any claim can proceed.',
    ].join('\n');
    const lintArgs: LintProseDensityArgs = {
      filePath: 'mixed-callout.md',
      content,
    };
    const findings = lintProseDensity(lintArgs);
    expect(findings.some((finding) => finding.line === 9)).toBe(true);
    expect(findings.some((finding) => finding.line < 9)).toBe(false);
  });

  test('checks normative blockquote callouts', () => {
    const content = [
      '> **Warning:** The workflow requires the successor branch and the open pull',
      '> request and the predecessor metadata and the frozen base SHA and the',
      '> containment proof and the delivery state before any claim can proceed.',
    ].join('\n');
    const lintArgs: LintProseDensityArgs = {
      filePath: 'callout.md',
      content,
    };
    expect(lintProseDensity(lintArgs).length).toBeGreaterThan(0);
  });

  test('reconstructs a dense sentence across hard-wrapped prose', () => {
    const content = [
      'A stacked successor declares immutable branch metadata and historical',
      'predecessor values. Before claim, the workflow requires the same-repository',
      'successor branch and exactly one open successor pull request and a live',
      'pre-merge base and authenticated metadata and a frozen starting SHA.',
    ].join('\n');
    const lintArgs: LintProseDensityArgs = {
      filePath: 'wrapped.md',
      content,
    };
    const findings = lintProseDensity(lintArgs);
    expect(
      findings.some((finding) => finding.excerpt.startsWith('Before claim')),
    ).toBe(true);
  });

  test('checks dense list items without joining sibling items', () => {
    const content = [
      '- Require the same-repository successor branch and exactly one open successor',
      '  pull request and a live pre-merge base and authenticated metadata and a',
      '  frozen starting SHA and complete containment evidence before claim.',
      '- Recheck stack adjacency.',
    ].join('\n');
    const lintArgs: LintProseDensityArgs = {
      filePath: 'list.md',
      content,
    };
    const findings = lintProseDensity(lintArgs);
    expect(findings.some((finding) => finding.line === 1)).toBe(true);
    expect(findings.some((finding) => finding.line === 4)).toBe(false);
  });

  test('accepts concise structured action lists', () => {
    const content = [
      '- Require a same-repository successor branch.',
      '- Require exactly one open successor pull request.',
      '- Validate the recorded predecessor.',
      '- Recheck stack adjacency before delivery.',
      '- Fail closed on incomplete metadata.',
    ].join('\n');
    const lintArgs: LintProseDensityArgs = {
      filePath: 'actions.md',
      content,
    };
    expect(lintProseDensity(lintArgs)).toEqual([]);
  });

  test('checks dense table cells', () => {
    const content = [
      '| Stage | Requirements |',
      '| --- | --- |',
      '| Claim | Require the successor branch and the open pull request and the predecessor metadata and the frozen base SHA and the containment proof and the delivery state before any claim can proceed. |',
    ].join('\n');
    const lintArgs: LintProseDensityArgs = {
      filePath: 'table.md',
      content,
    };
    const findings = lintProseDensity(lintArgs);
    expect(findings.some((finding) => finding.line === 3)).toBe(true);
  });

  test('keeps table cells as independent prose blocks', () => {
    const content = [
      '| Claim checks | Delivery checks |',
      '| --- | --- |',
      '| Validate the branch and pull request before claim. | Recheck the base SHA and containment proof before delivery. |',
    ].join('\n');
    const lintArgs: LintProseDensityArgs = {
      filePath: 'table.md',
      content,
    };
    expect(lintProseDensity(lintArgs)).toEqual([]);
  });

  test('ignores one-line index cells that only point elsewhere', () => {
    const summary =
      'Successor claim validation and immutable metadata and branch ancestry and frozen base verification and containment checks and exact-head delivery evidence and trusted publication details';
    const content = [
      '| Topic | Authority |',
      '| --- | --- |',
      `| Delivery | [${summary}](workflows/delivery.md) |`,
    ].join('\n');
    const lintArgs: LintProseDensityArgs = {
      filePath: 'index.md',
      content,
    };
    expect(lintProseDensity(lintArgs)).toEqual([]);
  });
});
