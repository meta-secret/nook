import { expect, test } from 'bun:test';
import { CortexConsistencyRequestDecoder } from '../src/codec.ts';
import { CortexConsistencyContractKind } from '../src/domain.ts';

test('decodes the strict consistency request', () => {
  expect(
    CortexConsistencyRequestDecoder.decodeCortexConsistencyRequest(
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
    CortexConsistencyRequestDecoder.decodeCortexConsistencyRequest(
      JSON.stringify({
        kind: CortexConsistencyContractKind.Request,
        documents: [document, document],
      }),
    ),
  ).toThrow();
  expect(() =>
    CortexConsistencyRequestDecoder.decodeCortexConsistencyRequest(
      JSON.stringify({
        kind: CortexConsistencyContractKind.Request,
        documents: [],
        extra: true,
      }),
    ),
  ).toThrow();
});
