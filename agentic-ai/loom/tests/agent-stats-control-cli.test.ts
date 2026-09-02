import { describe, expect, test } from 'bun:test';
import { AgentStatsOperation } from '../src/codec/enums.ts';
import {
  assertHostedTestInventory,
  decodeAgentStatsControlRequest,
} from '../src/agent-stats-control-cli.ts';

const ASSEMBLE_REQUEST = {
  prNumber: 1284,
  scratchPath: "{agentTempDir}/PR's-scratch.json",
  outputPath: '{agentTempDir}/1284.yaml',
  includeTestInventory: false,
} as const;

describe('agent statistics control request', () => {
  test('rejects local inventory collection and requires hosted evidence', () => {
    const localInventory = {
      operation: AgentStatsOperation.Assemble,
      request: { ...ASSEMBLE_REQUEST, includeTestInventory: true },
    } as const;
    expect(() =>
      decodeAgentStatsControlRequest(JSON.stringify(localInventory)),
    ).toThrow('Local test inventory collection is prohibited');
    expect(() => assertHostedTestInventory(false)).toThrow(
      'requires typed test_inventory from hosted exact-head validation',
    );
  });
});
