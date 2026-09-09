import { ok } from 'neverthrow';
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
    )
      .execute()
      .map((request) => request.documents.length),
  ).toEqual(ok(1));
});

test('rejects duplicate documents and extra fields', () => {
  const document = {
    relativePath: '.cortex/AGENTS.md',
    references: [],
    commands: [],
  };
  expect(
    CortexConsistencyRequestDecoder.from(
      JSON.stringify({
        kind: CortexConsistencyContractKind.Request,
        documents: [document, document],
      }),
    )
      .execute()
      .isErr(),
  ).toBe(true);
  expect(
    CortexConsistencyRequestDecoder.from(
      JSON.stringify({
        kind: CortexConsistencyContractKind.Request,
        documents: [],
        extra: true,
      }),
    )
      .execute()
      .isErr(),
  ).toBe(true);
});
