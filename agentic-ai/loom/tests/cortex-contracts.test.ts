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
import type { CortexContractFinding } from '../src/lib/cortex-contracts.ts';

export class CortexContractsScenario {
  static readonly POLICY =
    '.cortex/teams/web-dev/dynamic-skills/ui-design-skills.md';

  static readonly VALID_REFERENCES = [
    '[direct](../web-dev/dynamic-skills/ui-design-skills.md)',
    '[title](../web-dev/dynamic-skills/ui-design-skills.md "Policy")',
    '[heading](../web-dev/dynamic-skills/ui-design-skills.md#validation)',
    '[query](../web-dev/dynamic-skills/ui-design-skills.md?plain=1#validation)',
    '[reference][rule]\n\n[rule]: ../web-dev/dynamic-skills/ui-design-skills.md',
  ] as const;

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
          document: CortexContractsScenario.POLICY,
          kind: CortexPolicyContractKind.General,
          areas: [CortexPolicyArea.GithubTypescript],
          capabilities: [],
        },
      ],
      runtimes: [],
    };
  }

  static compile(content: string): readonly CortexContractFinding[] {
    const documents: readonly CortexContractDocument[] = [
      { relativePath: AUTHORITY, content },
      { relativePath: CortexContractsScenario.POLICY, content: '# Policy\n' },
    ];
    return CortexConsistencyContract.from({
      registry: CortexContractsScenario.registry([
        CortexContractsScenario.POLICY,
      ]),
      documents:
        CortexContractDocuments.adaptCortexContractDocuments(documents),
    }).execute();
  }
}

const AUTHORITY = CortexContextAuthorityDocument.Sre;

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
    CortexConsistencyContract.from({
      registry: CORTEX_CONTRACT_REGISTRY,
      documents:
        CortexContractDocuments.adaptCortexContractDocuments(documents),
    }).execute(),
  ).toEqual([]);
});

test('keeps the retired delegation journal unreachable', () => {
  const taskfile = readFileSync(
    path.join(REPOSITORY_ROOT, '.task/agentic-ai.yml'),
    'utf8',
  );
  const packageManifest = readFileSync(
    path.join(REPOSITORY_ROOT, 'agentic-ai/loom/package.json'),
    'utf8',
  );
  expect(taskfile).not.toContain('loom:agent-delegation');
  expect(packageManifest).not.toContain('loom-agent-delegation');
  expect(packageManifest).not.toContain('agent-delegation');
});

test('requires the importing authority to reference the policy document', () => {
  expect(
    CortexContractsScenario.compile('# SRE\n\nNo policy link.\n').some(
      (finding) =>
        finding.code === CortexContractFindingCode.MissingPolicyReference &&
        finding.file === AUTHORITY,
    ),
  ).toBe(true);
});

for (const reference of CortexContractsScenario.VALID_REFERENCES) {
  const [defaulted1 = ''] = [reference.split(']')[0]];
  test(`accepts Markdown policy reference: ${defaulted1}`, () => {
    expect(CortexContractsScenario.compile(`# SRE\n\n${reference}\n`)).toEqual(
      [],
    );
  });
}

test('uses the first duplicate Markdown reference definition', () => {
  const content =
    '# SRE\n\n[policy][rule]\n\n[rule]: unrelated.md\n[rule]: ../web-dev/dynamic-skills/ui-design-skills.md\n';
  expect(
    CortexContractsScenario.compile(content).some(
      (finding) =>
        finding.code === CortexContractFindingCode.MissingPolicyReference &&
        finding.file === AUTHORITY,
    ),
  ).toBe(true);
});

test('adapts inline and fenced runtime commands without prose inference', () => {
  const documents = CortexContractDocuments.adaptCortexContractDocuments([
    {
      relativePath: '.cortex/gizmo-prime/workflows/subagent-delegation.md',
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
