import path from 'node:path';
import { expect } from 'bun:test';
import { ok } from 'neverthrow';

import { CortexDocumentMapApplication } from '../src/application.ts';
import {
  CortexMarkdownSyntaxAudit,
  CortexDocumentStructure,
} from '../src/cortex-document-structure.ts';
import type {
  AuditCortexMarkdownSyntaxArgs,
  AuditCortexDocumentStructureArgs,
  CortexDocumentSource,
  CortexStructureFinding,
} from '../src/cortex-document-structure.ts';
import { CortexDocumentMapContractKind } from '../src/domain.ts';

const REPO_ROOT = '/repo';

export const PIPELINE_GRAPH_PATH =
  '.cortex/teams/delivery-pipeline/knowledge-graph.md';

export type MakeDocumentArgs = {
  readonly path: string;
  readonly content: string;
};

export type DistributedDocumentsArgs = {
  readonly rootExtra: string;
  readonly devTarget: string;
  readonly gizmoTarget: string;
};

export class CortexDocumentMapCortexDocumentStructureScenario {
  private constructor(private readonly request: MakeDocumentArgs) {}

  static makeDocument(args: MakeDocumentArgs): CortexDocumentSource {
    return new CortexDocumentMapCortexDocumentStructureScenario(args).execute();
  }

  private execute(): CortexDocumentSource {
    const args = this.request;
    return {
      absolutePath: path.join(REPO_ROOT, args.path),
      relativePath: args.path,
      content: args.content,
    };
  }

  static audit(documents: readonly CortexDocumentSource[]) {
    const args: AuditCortexDocumentStructureArgs = {
      documents,
      excludedDocumentPaths: new Set(),
      repoRoot: REPO_ROOT,
    };
    const expected = CortexDocumentStructure.from(args).execute();
    const result = CortexDocumentMapApplication.from({
      kind: CortexDocumentMapContractKind.Request,
      documents: documents.map((document) => ({
        relativePath: document.relativePath,
        content: document.content,
      })),
      excludedDocumentPaths: [],
    }).execute();
    expect(result.map((value) => value.findings)).toEqual(ok(expected));
    return expected;
  }

  static auditSyntax(documents: readonly CortexDocumentSource[]) {
    const args: AuditCortexMarkdownSyntaxArgs = { documents };
    return new CortexMarkdownSyntaxAudit(args).execute();
  }

  static hasFinding(
    ...[findings, expected]: readonly [
      findings: readonly CortexStructureFinding[],
      expected: Partial<CortexStructureFinding>,
    ]
  ): boolean {
    return findings.some(
      (finding) =>
        (!('code' in expected) || finding.code === expected.code) &&
        (!('file' in expected) || finding.file === expected.file) &&
        (!('message' in expected) || finding.message === expected.message),
    );
  }

  static distributedDocuments(
    args: DistributedDocumentsArgs = {
      rootExtra: '',
      devTarget: 'policy.md',
      gizmoTarget: 'policy.md',
    },
  ): CortexDocumentSource[] {
    const rootDocumentArgs: MakeDocumentArgs = {
      path: '.cortex/knowledge-graph.md',
      content: `# Cortex Knowledge Graph

- [AI](teams/ai/knowledge-graph.md)
- [Development core](teams/dev-core/knowledge-graph.md)
- [Delivery Pipeline](teams/delivery-pipeline/knowledge-graph.md)
- [Security](teams/security/knowledge-graph.md)
- [SRE](teams/sre/knowledge-graph.md)
- [Web development](teams/web-dev/knowledge-graph.md)
- [Shared](shared/knowledge-graph.md)
- [Gizmo Prime](gizmo-prime/knowledge-graph.md)
${args.rootExtra}`,
    };
    const aiGraphArgs: MakeDocumentArgs = {
      path: '.cortex/teams/ai/knowledge-graph.md',
      content: '# AI Knowledge Graph\n',
    };
    const devGraphArgs: MakeDocumentArgs = {
      path: '.cortex/teams/dev-core/knowledge-graph.md',
      content: `# Development Core Knowledge Graph\n\n- [Core policy](${args.devTarget})\n`,
    };
    const sreGraphArgs: MakeDocumentArgs = {
      path: '.cortex/teams/sre/knowledge-graph.md',
      content: '# SRE Knowledge Graph\n',
    };
    const securityGraphArgs: MakeDocumentArgs = {
      path: '.cortex/teams/security/knowledge-graph.md',
      content: '# Security Knowledge Graph\n',
    };
    const webGraphArgs: MakeDocumentArgs = {
      path: '.cortex/teams/web-dev/knowledge-graph.md',
      content: '# Web Development Knowledge Graph\n',
    };
    const sharedGraphArgs: MakeDocumentArgs = {
      path: '.cortex/shared/knowledge-graph.md',
      content: '# Shared Knowledge Graph\n',
    };
    const gizmoGraphArgs: MakeDocumentArgs = {
      path: '.cortex/gizmo-prime/knowledge-graph.md',
      content: `# Gizmo Prime Knowledge Graph\n\n- [Gizmo policy](${args.gizmoTarget})\n`,
    };
    const corePolicyArgs: MakeDocumentArgs = {
      path: '.cortex/teams/dev-core/policy.md',
      content: '# Core Policy\n\n## Boundary\n\nPolicy text.\n',
    };
    const gizmoPolicyArgs: MakeDocumentArgs = {
      path: '.cortex/gizmo-prime/policy.md',
      content: '# Gizmo Prime Policy\n\n## Boundary\n\nPolicy text.\n',
    };
    return [
      this.makeDocument(rootDocumentArgs),
      this.makeDocument({
        path: PIPELINE_GRAPH_PATH,
        content: '# Delivery Pipeline Knowledge Graph\n',
      }),
      this.makeDocument(aiGraphArgs),
      this.makeDocument(devGraphArgs),
      this.makeDocument(securityGraphArgs),
      this.makeDocument(sreGraphArgs),
      this.makeDocument(webGraphArgs),
      this.makeDocument(sharedGraphArgs),
      this.makeDocument(gizmoGraphArgs),
      this.makeDocument(corePolicyArgs),
      this.makeDocument(gizmoPolicyArgs),
    ];
  }

  static nestedDistributedDocuments(): CortexDocumentSource[] {
    const documents = this.distributedDocuments().map((document) =>
      document.relativePath === PIPELINE_GRAPH_PATH
        ? {
            ...document,
            content: `${document.content}
- [Team Gizmo](gizmo/knowledge-graph.md)
- [Dev Manager](dev-manager/knowledge-graph.md)
- [PR Lifecycle Agent](pr-lifecycle/knowledge-graph.md)
`,
          }
        : document,
    );
    documents.push(
      this.makeDocument({
        path: '.cortex/teams/delivery-pipeline/gizmo/knowledge-graph.md',
        content:
          '# Delivery Pipeline Team Gizmo Knowledge Graph\n\n- [Policy](policy.md)\n- [Gizmo authority](../../../gizmo-prime/policy.md)\n',
      }),
      this.makeDocument({
        path: '.cortex/teams/delivery-pipeline/gizmo/policy.md',
        content: '# Team Gizmo Policy\n',
      }),
      this.makeDocument({
        path: '.cortex/teams/delivery-pipeline/dev-manager/knowledge-graph.md',
        content:
          '# Delivery Pipeline Dev Manager Knowledge Graph\n\n- [Policy](policy.md)\n- [Gizmo authority](../../../gizmo-prime/policy.md)\n',
      }),
      this.makeDocument({
        path: '.cortex/teams/delivery-pipeline/dev-manager/policy.md',
        content: '# Dev Manager Policy\n',
      }),
      this.makeDocument({
        path: '.cortex/teams/delivery-pipeline/pr-lifecycle/knowledge-graph.md',
        content:
          '# Delivery Pipeline PR Lifecycle Knowledge Graph\n\n- [Policy](workflows/policy.md)\n- [Gizmo authority](../../../gizmo-prime/policy.md)\n',
      }),
      this.makeDocument({
        path: '.cortex/teams/delivery-pipeline/pr-lifecycle/workflows/policy.md',
        content: '# PR Lifecycle Policy\n',
      }),
    );
    return documents;
  }
}
