import { describe, expect, test } from 'bun:test';
import { AgentStatsOperation } from '../src/codec/enums.ts';
import {
  assertHostedTestInventory,
  decodeAgentStatsControlRequest,
} from '../src/agent-stats-control-cli.ts';

const VALID_HOSTED_INVENTORY = {
  measured_at: '2026-09-02T12:00:00Z',
  head_sha: '0123456789abcdef0123456789abcdef01234567',
  by_type: { rust: 1, preflight: 2, web_unit: 3, e2e: 4 },
  total: 10,
} as const;

describe('agent statistics control request', () => {
  test('accepts dependency-free assemble, validate, and publish requests', () => {
    expect(
      decodeAgentStatsControlRequest(
        JSON.stringify({
          operation: AgentStatsOperation.Assemble,
          request: {
            prNumber: 1284,
            scratchPath: "{agentTempDir}/PR's-scratch.json",
            outputPath: '{agentTempDir}/1284.yaml',
            includeTestInventory: false,
          },
        }),
      ),
    ).toEqual({
      operation: AgentStatsOperation.Assemble,
      request: {
        prNumber: 1284,
        scratchPath: "{agentTempDir}/PR's-scratch.json",
        outputPath: '{agentTempDir}/1284.yaml',
        includeTestInventory: false,
      },
    });
    for (const operation of [
      AgentStatsOperation.Validate,
      AgentStatsOperation.Publish,
    ]) {
      expect(
        decodeAgentStatsControlRequest(
          JSON.stringify({
            operation,
            request: { statsFile: '{agentTempDir}/1284.yaml' },
          }),
        ),
      ).toEqual({
        operation,
        request: { statsFile: '{agentTempDir}/1284.yaml' },
      });
    }
  });

  test('rejects local inventory collection and an expanded envelope', () => {
    expect(() =>
      decodeAgentStatsControlRequest(
        JSON.stringify({
          operation: AgentStatsOperation.Assemble,
          request: {
            prNumber: 1284,
            scratchPath: '{agentTempDir}/scratch.json',
            outputPath: '{agentTempDir}/1284.yaml',
            includeTestInventory: true,
          },
        }),
      ),
    ).toThrow('Local test inventory collection is prohibited');
    expect(() =>
      decodeAgentStatsControlRequest(
        JSON.stringify({
          operation: AgentStatsOperation.Validate,
          request: { statsFile: '{agentTempDir}/1284.yaml' },
          fallback: true,
        }),
      ),
    ).toThrow('must contain exactly operation and request');
  });

  test('requires hosted inventory before assembly', () => {
    expect(() => assertHostedTestInventory(false)).toThrow(
      'requires typed test_inventory from hosted exact-head validation',
    );
    expect(() =>
      assertHostedTestInventory(VALID_HOSTED_INVENTORY),
    ).not.toThrow();
  });
});
