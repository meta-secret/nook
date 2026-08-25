import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { findRepoRoot } from '../../src/lib/repo.ts';
import {
  decodeSourceAnalysisRequest,
  decodeSourceAnalysisResult,
  encodeSourceAnalysisRequest,
  encodeSourceAnalysisResult,
  MAXIMUM_SEALED_SOURCE_BYTES,
  MAXIMUM_SOURCE_ANALYSIS_STDOUT_BYTES,
} from '../../src/executable-skills/source-analysis-codec.ts';

const MAXIMUM_MODULE_SPECIFIERS = 256;
const MAXIMUM_MODULE_SPECIFIER_BYTES = 4096;

describe('sealed source analysis codec', () => {
  test('aligns the transport source bound with the analyzer source bound', async () => {
    const policy = await readFile(
      `${findRepoRoot()}/agentic-ai/loom/src/executable-skills/source-policy.ts`,
      'utf8',
    );
    const match = policy.match(
      /MAXIMUM_EXECUTABLE_SKILL_SOURCE_BYTES = (\d+) \* (\d+);/,
    );
    expect(match).not.toBeFalsy();
    const analyzerBytes = Number(match?.[1]) * Number(match?.[2]);
    expect(MAXIMUM_SEALED_SOURCE_BYTES).toBe(analyzerBytes);
  });

  test('accepts exact UTF-8 bytes and rejects exact plus one', () => {
    const exactRequest = {
      relativePath: './exact.ts',
      source: 'é'.repeat(MAXIMUM_SEALED_SOURCE_BYTES / 2),
    };
    const serialized = encodeSourceAnalysisRequest(exactRequest);
    expect(decodeSourceAnalysisRequest(serialized)).toEqual(exactRequest);

    const oversizedRequest = {
      relativePath: './oversized.ts',
      source: `${exactRequest.source}a`,
    };
    expect(() => encodeSourceAnalysisRequest(oversizedRequest)).toThrow(
      'source exceeds its byte bound',
    );
  });

  test('round-trips worst-case escaped source and path capacity', () => {
    const request = {
      relativePath: '\0'.repeat(4096),
      source: '\0'.repeat(MAXIMUM_SEALED_SOURCE_BYTES),
    };
    const serialized = encodeSourceAnalysisRequest(request);
    expect(decodeSourceAnalysisRequest(serialized)).toEqual(request);
  });

  test('rejects malformed request and result transports', () => {
    for (const serialized of [
      '',
      '[]',
      '{}',
      '{"relativePath":"./x.ts","source":1}',
      '{"relativePath":"./x.ts","source":"x","extra":true}',
    ]) {
      expect(() => decodeSourceAnalysisRequest(serialized)).toThrow(
        'request is malformed',
      );
    }
    for (const serialized of [
      '',
      '{}',
      '{"kind":"completed","moduleSpecifiers":"./x.ts"}',
      '{"kind":"failed","message":""}',
      '{"kind":"other","message":"x"}',
    ]) {
      expect(() => decodeSourceAnalysisResult(serialized)).toThrow();
    }
  });

  test('round-trips only the exact bounded analysis result', () => {
    const analysis = { moduleSpecifiers: ['./audit.ts', '../domain.ts'] };
    const serialized = encodeSourceAnalysisResult(analysis);
    expect(decodeSourceAnalysisResult(serialized)).toEqual(analysis);
  });

  test('round-trips the finite worst-case analyzer result capacity', () => {
    const escapedSpecifier = '\0'.repeat(MAXIMUM_MODULE_SPECIFIER_BYTES);
    const capacity = { length: MAXIMUM_MODULE_SPECIFIERS };
    const analysis = {
      moduleSpecifiers: Array.from(capacity, () => escapedSpecifier),
    };
    const serialized = encodeSourceAnalysisResult(analysis);
    expect(new TextEncoder().encode(serialized).byteLength).toBeLessThanOrEqual(
      MAXIMUM_SOURCE_ANALYSIS_STDOUT_BYTES,
    );
    expect(decodeSourceAnalysisResult(serialized)).toEqual(analysis);
  });
});
