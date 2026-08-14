import { expect, test } from 'bun:test';
import type { CortexAuditReport } from '../../src/commands/cortex-audit.ts';
import { WorkflowResultKind } from '../../src/agent-workflow/domain.ts';
import { mechanicalCortexAuditOutput } from '../../src/agent-workflow/leaf-runtime.ts';

test('returns mechanical inconsistencies as typed completed evidence', () => {
  const report: CortexAuditReport = {
    brokenLinks: [
      {
        file: '.cortex/workflows/example.md',
        line: 12,
        target: '../missing.md',
      },
    ],
    missingFromIndex: ['unindexed.md'],
    orphanIndexRows: [],
    missingExecutableSkills: ['missing-wrapper'],
    densityFindings: [],
    auditOk: false,
  };
  const output = mechanicalCortexAuditOutput(report);

  expect(output.resultKind).toBe(WorkflowResultKind.LoomLeafEvidence);
  expect(output.findings).toHaveLength(3);
  for (const finding of output.findings) {
    expect(finding.evidence.length).toBeGreaterThan(0);
  }
  expect(output.summary).toContain('found 3 inconsistencies');
});

test('allows a clean mechanical report with zero findings', () => {
  const report: CortexAuditReport = {
    brokenLinks: [],
    missingFromIndex: [],
    orphanIndexRows: [],
    missingExecutableSkills: [],
    densityFindings: [],
    auditOk: true,
  };
  const output = mechanicalCortexAuditOutput(report);

  expect(output.findings).toEqual([]);
  expect(output.summary).toBe('Mechanical Cortex audit passed.');
});
