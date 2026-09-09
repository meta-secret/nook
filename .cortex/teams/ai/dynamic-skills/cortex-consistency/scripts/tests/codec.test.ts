import { expect, test } from 'bun:test';
import { CortexConsistencyRequestDecoder } from '../src/codec.ts';
import { CortexConsistencyContractKind } from '../src/domain.ts';

test('decodes the strict consistency request', () => {
  expect(
    CortexConsistencyRequestDecoder.from(
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
    ).execute().documents,
  ).toHaveLength(1);
});

test('rejects duplicate documents and extra fields', () => {
  const document = {
    relativePath: '.cortex/AGENTS.md',
    references: [],
    commands: [],
  };
  expect(() =>
    CortexConsistencyRequestDecoder.from(
      JSON.stringify({
        kind: CortexConsistencyContractKind.Request,
        documents: [document, document],
      }),
    ).execute(),
  ).toThrow();
  expect(() =>
    CortexConsistencyRequestDecoder.from(
      JSON.stringify({
        kind: CortexConsistencyContractKind.Request,
        documents: [],
        extra: true,
      }),
    ).execute(),
  ).toThrow();
});
