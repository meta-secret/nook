import { expect, test } from 'bun:test';
import { compileCortexContracts } from '../src/audit.ts';
import {
  CortexConsistencyContractKind,
  CortexContractFindingCode,
  CortexPolicyArea,
  CortexPolicyContractKind,
  type CompileCortexContractsRequest,
} from '../src/domain.ts';

const AUTHORITY = '.cortex/teams/sre/AGENTS.md';
const POLICY =
  '.cortex/teams/web-dev/dynamic-skills/typescript-enums-over-booleans.md';

function request(references: readonly string[]): CompileCortexContractsRequest {
  return {
    kind: CortexConsistencyContractKind.Request,
    registry: {
      contexts: [
        {
          authorityDocument: AUTHORITY,
          ownsAreas: [CortexPolicyArea.GithubTypescript],
          imports: [POLICY],
        },
      ],
      policies: [
        {
          document: POLICY,
          kind: CortexPolicyContractKind.General,
          areas: [CortexPolicyArea.GithubTypescript],
          capabilities: [],
        },
      ],
    },
    documents: [
      { relativePath: AUTHORITY, references },
      { relativePath: POLICY, references: [] },
    ],
  };
}

test('accepts a referenced imported policy', () => {
  expect(
    compileCortexContracts(
      request(['../web-dev/dynamic-skills/typescript-enums-over-booleans.md']),
    ),
  ).toEqual([]);
});

test('rejects an imported policy without an authority reference', () => {
  expect(compileCortexContracts(request([]))).toContainEqual(
    expect.objectContaining({
      code: CortexContractFindingCode.MissingPolicyReference,
      file: AUTHORITY,
    }),
  );
});

test('rejects context ownership disguised by traversal', () => {
  const compileRequest: CompileCortexContractsRequest = {
    kind: CortexConsistencyContractKind.Request,
    registry: {
      contexts: [
        {
          authorityDocument: '.cortex/teams/web-dev/../../rogue/AGENTS.md',
          ownsAreas: [],
          imports: [],
        },
      ],
      policies: [],
    },
    documents: [
      {
        relativePath: '.cortex/teams/web-dev/../../rogue/AGENTS.md',
        references: [],
      },
    ],
  };
  expect(compileCortexContracts(compileRequest)).toContainEqual(
    expect.objectContaining({
      code: CortexContractFindingCode.InvalidContextOwner,
      file: '.cortex/rogue/AGENTS.md',
    }),
  );
});
