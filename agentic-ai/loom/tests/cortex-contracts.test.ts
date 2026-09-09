import { readFileSync } from 'node:fs';

import path from 'node:path';

import { expect, test } from 'bun:test';

import { CortexConsistencyContract } from '../../../.cortex/teams/ai/dynamic-skills/cortex-consistency/scripts/src/audit.ts';

import type { CortexContractRegistry } from '../../../.cortex/teams/ai/dynamic-skills/cortex-consistency/scripts/src/domain.ts';

import { CORTEX_CONTRACT_REGISTRY } from '../../../.cortex/teams/ai/dynamic-skills/cortex-consistency/scripts/src/registry.ts';

import {
  CortexContextAuthorityDocument,
  CortexContractFindingCode,
  CortexPolicyArea,
  CortexPolicyContractKind,
  type CortexContractDocument,
  CortexContractDocuments,
} from '../src/lib/cortex-contracts.ts';

export class CortexContractsScenario {
  private constructor(private readonly request: readonly string[]) {}

  static registry(imports: readonly string[]): CortexContractRegistry {
    return new CortexContractsScenario(imports).execute();
  }

  private execute(): CortexContractRegistry {
    const imports = this.request;
    return {
      contexts: [
        {
          authorityDocument: AUTHORITY,
          ownsAreas: [CortexPolicyArea.GithubTypescript],
          imports,
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
      runtimes: [],
    };
  }

  static compile(content: string) {
    const documents: readonly CortexContractDocument[] = [
      { relativePath: AUTHORITY, content },
      { relativePath: POLICY, content: '# Policy\n' },
    ];
    return CortexConsistencyContract.compileCortexContracts({
      registry: CortexContractsScenario.registry([POLICY]),
      documents:
        CortexContractDocuments.adaptCortexContractDocuments(documents),
    });
  }
}

const AUTHORITY = CortexContextAuthorityDocument.Sre;

const POLICY =
  '.cortex/teams/web-dev/dynamic-skills/typescript-enums-over-booleans.md';

const REPOSITORY_ROOT = path.resolve(import.meta.dir, '..', '..', '..');

test('accepts the reviewed repository contract registry', () => {
  const paths = [
    ...CORTEX_CONTRACT_REGISTRY.contexts.map(
      (context) => context.authorityDocument,
    ),
    ...CORTEX_CONTRACT_REGISTRY.policies.map((policy) => policy.document),
    ...CORTEX_CONTRACT_REGISTRY.runtimes.map((runtime) => runtime.document),
  ];
  const documents = [...new Set(paths)].map((relativePath) => ({
    relativePath,
    content: readFileSync(path.join(REPOSITORY_ROOT, relativePath), 'utf8'),
  }));
  expect(
    CortexConsistencyContract.compileCortexContracts({
      registry: CORTEX_CONTRACT_REGISTRY,
      documents:
        CortexContractDocuments.adaptCortexContractDocuments(documents),
    }),
  ).toEqual([]);
});

test('requires the importing authority to reference the policy document', () => {
  expect(
    CortexContractsScenario.compile('# SRE\n\nNo policy link.\n'),
  ).toContainEqual(
    expect.objectContaining({
      code: CortexContractFindingCode.MissingPolicyReference,
      file: AUTHORITY,
    }),
  );
});

const validReferences = [
  '[direct](../web-dev/dynamic-skills/typescript-enums-over-booleans.md)',
  '[title](../web-dev/dynamic-skills/typescript-enums-over-booleans.md "Policy")',
  '[heading](../web-dev/dynamic-skills/typescript-enums-over-booleans.md#validation)',
  '[query](../web-dev/dynamic-skills/typescript-enums-over-booleans.md?plain=1#validation)',
  '[reference][rule]\n\n[rule]: ../web-dev/dynamic-skills/typescript-enums-over-booleans.md',
] as const;

for (const reference of validReferences) {
  const [defaulted1 = ''] = [reference.split(']')[0]];
  test(`accepts Markdown policy reference: ${defaulted1}`, () => {
    expect(CortexContractsScenario.compile(`# SRE\n\n${reference}\n`)).toEqual(
      [],
    );
  });
}

test('uses the first duplicate Markdown reference definition', () => {
  const content =
    '# SRE\n\n[policy][rule]\n\n[rule]: unrelated.md\n[rule]: ../web-dev/dynamic-skills/typescript-enums-over-booleans.md\n';
  expect(CortexContractsScenario.compile(content)).toContainEqual(
    expect.objectContaining({
      code: CortexContractFindingCode.MissingPolicyReference,
      file: AUTHORITY,
    }),
  );
});

test('adapts inline and fenced runtime commands without prose inference', () => {
  const documents = CortexContractDocuments.adaptCortexContractDocuments([
    {
      relativePath: '.cortex/gizmo/workflows/subagent-delegation.md',
      content: `# Delegation

Prose mentions loom-agent-delegation but does not invoke it.

Use \`task skills:run REQUEST_YAML=request\`.

\`\`\`bash
task skills:tools-list
task skills:run REQUEST_YAML=request
\`\`\`
`,
    },
  ]);
  expect(documents[0]?.commands).toEqual([
    'task skills:run REQUEST_YAML=request',
    'task skills:tools-list',
    'task skills:run REQUEST_YAML=request',
  ]);
});
