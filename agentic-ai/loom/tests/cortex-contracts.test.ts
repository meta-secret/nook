import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from 'bun:test';
import { compileCortexContracts } from '../../../.cortex/teams/ai/dynamic-skills/cortex-consistency/scripts/src/audit.ts';
import type { CortexContractRegistry } from '../../../.cortex/teams/ai/dynamic-skills/cortex-consistency/scripts/src/domain.ts';
import { CORTEX_CONTRACT_REGISTRY } from '../../../.cortex/teams/ai/dynamic-skills/cortex-consistency/scripts/src/registry.ts';
import {
  CortexContextAuthorityDocument,
  adaptCortexContractDocuments,
  CortexContractFindingCode,
  CortexPolicyArea,
  CortexPolicyContractKind,
  type CortexContractDocument,
} from '../src/lib/cortex-contracts.ts';

const AUTHORITY = CortexContextAuthorityDocument.Sre;
const POLICY =
  '.cortex/teams/web-dev/dynamic-skills/typescript-enums-over-booleans.md';
const REPOSITORY_ROOT = path.resolve(import.meta.dir, '..', '..', '..');

function registry(imports: readonly string[]): CortexContractRegistry {
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

function compile(content: string) {
  const documents: readonly CortexContractDocument[] = [
    { relativePath: AUTHORITY, content },
    { relativePath: POLICY, content: '# Policy\n' },
  ];
  return compileCortexContracts({
    registry: registry([POLICY]),
    documents: adaptCortexContractDocuments(documents),
  });
}

test('accepts the reviewed repository contract registry', () => {
  const paths = [
    ...CORTEX_CONTRACT_REGISTRY.contexts.map(
      (context) => context.authorityDocument,
    ),
    ...CORTEX_CONTRACT_REGISTRY.policies.map((policy) => policy.document),
  ];
  const documents = [...new Set(paths)].map((relativePath) => ({
    relativePath,
    content: readFileSync(path.join(REPOSITORY_ROOT, relativePath), 'utf8'),
  }));
  expect(
    compileCortexContracts({
      registry: CORTEX_CONTRACT_REGISTRY,
      documents: adaptCortexContractDocuments(documents),
    }),
  ).toEqual([]);
});

test('requires the importing authority to reference the policy document', () => {
  expect(compile('# SRE\n\nNo policy link.\n')).toContainEqual(
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
  test(`accepts Markdown policy reference: ${reference.split(']')[0] ?? ''}`, () => {
    expect(compile(`# SRE\n\n${reference}\n`)).toEqual([]);
  });
}

test('uses the first duplicate Markdown reference definition', () => {
  const content =
    '# SRE\n\n[policy][rule]\n\n[rule]: unrelated.md\n[rule]: ../web-dev/dynamic-skills/typescript-enums-over-booleans.md\n';
  expect(compile(content)).toContainEqual(
    expect.objectContaining({
      code: CortexContractFindingCode.MissingPolicyReference,
      file: AUTHORITY,
    }),
  );
});

test('adapts inline and fenced runtime commands without prose inference', () => {
  const documents = adaptCortexContractDocuments([
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
