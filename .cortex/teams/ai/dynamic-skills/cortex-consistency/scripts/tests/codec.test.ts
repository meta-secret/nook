import { expect, test } from 'bun:test';
import { decodeCortexConsistencyRequest } from '../src/codec.ts';
import { CortexConsistencyContractKind } from '../src/domain.ts';

test('decodes the strict consistency request', () => {
  expect(
    decodeCortexConsistencyRequest(
      JSON.stringify({
        kind: CortexConsistencyContractKind.Request,
        documents: [
          {
            relativePath: '.cortex/AGENTS.md',
            references: ['policy.md'],
            commands: [],
          },
        ],
      }),
    ).documents,
  ).toHaveLength(1);
});

test('rejects duplicate documents and extra fields', () => {
  const document = {
    relativePath: '.cortex/AGENTS.md',
    references: [],
    commands: [],
  };
  expect(() =>
    decodeCortexConsistencyRequest(
      JSON.stringify({
        kind: CortexConsistencyContractKind.Request,
        documents: [document, document],
      }),
    ),
  ).toThrow();
  expect(() =>
    decodeCortexConsistencyRequest(
      JSON.stringify({
        kind: CortexConsistencyContractKind.Request,
        documents: [],
        extra: true,
      }),
    ),
  ).toThrow();
});
