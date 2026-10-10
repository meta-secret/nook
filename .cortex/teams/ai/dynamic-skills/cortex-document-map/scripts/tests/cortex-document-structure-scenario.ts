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

const REPO_ROOT = path.resolve(import.meta.dir, '../../../../../../../');

export const PIPELINE_GRAPH_PATH = '.cortex/teams/delivery-pipeline/index.md';

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
    })
      .withRepoRoot(REPO_ROOT)
      .execute();
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
      path: '.cortex/index.md',
      content: `# Cortex Index

- [AI](teams/ai/index.md)
- [Development core](teams/dev-core/index.md)
- [Delivery Pipeline](teams/delivery-pipeline/index.md)
- [Security](teams/security/index.md)
- [SRE](teams/sre/index.md)
- [Web development](teams/web-dev/index.md)
- [Shared](shared/index.md)
- [Gizmo Prime](docs/spec/index.md)
- [Project architecture](docs/architecture/index.md)
${args.rootExtra}`,
    };
    const aiGraphArgs: MakeDocumentArgs = {
      path: '.cortex/teams/ai/index.md',
      content: '# AI Index\n',
    };
    const devGraphArgs: MakeDocumentArgs = {
      path: '.cortex/teams/dev-core/index.md',
      content: `# Development Core Index\n\n- [Core policy](${args.devTarget})\n`,
    };
    const sreGraphArgs: MakeDocumentArgs = {
      path: '.cortex/teams/sre/index.md',
      content: '# SRE Index\n',
    };
    const securityGraphArgs: MakeDocumentArgs = {
      path: '.cortex/teams/security/index.md',
      content: '# Security Index\n',
    };
    const webGraphArgs: MakeDocumentArgs = {
      path: '.cortex/teams/web-dev/index.md',
      content: '# Web Development Index\n',
    };
    const sharedGraphArgs: MakeDocumentArgs = {
      path: '.cortex/shared/index.md',
      content: '# Shared Index\n',
    };
    const gizmoGraphArgs: MakeDocumentArgs = {
      path: '.cortex/docs/spec/index.md',
      content: `# Gizmo Prime Index\n\n- [Gizmo policy](${args.gizmoTarget})\n`,
    };
    const corePolicyArgs: MakeDocumentArgs = {
      path: '.cortex/teams/dev-core/policy.md',
      content: '# Core Policy\n\n## Boundary\n\nPolicy text.\n',
    };
    const gizmoPolicyArgs: MakeDocumentArgs = {
      path: '.cortex/docs/spec/policy.md',
      content: '# Gizmo Prime Policy\n\n## Boundary\n\nPolicy text.\n',
    };
    return [
      this.makeDocument(rootDocumentArgs),
      this.makeDocument({
        path: PIPELINE_GRAPH_PATH,
        content: '# Delivery Pipeline Index\n',
      }),
      this.makeDocument(aiGraphArgs),
      this.makeDocument(devGraphArgs),
      this.makeDocument(securityGraphArgs),
      this.makeDocument(sreGraphArgs),
      this.makeDocument(webGraphArgs),
      this.makeDocument(sharedGraphArgs),
      this.makeDocument(gizmoGraphArgs),
      this.makeDocument({
        path: '.cortex/docs/architecture/index.md',
        content: '# Project Architecture\n',
      }),
      this.makeDocument(corePolicyArgs),
      this.makeDocument(gizmoPolicyArgs),
    ];
  }

  static nestedDistributedDocuments(): CortexDocumentSource[] {
    const documents = this.distributedDocuments();
    const routed = this.withContent({
      documents,
      path: PIPELINE_GRAPH_PATH,
      content:
        '# Delivery Pipeline\n\n- [Specifications](docs/spec/index.md)\n- [Architecture](docs/architecture/index.md)\n',
    });
    return [
      ...routed,
      this.makeDocument({
        path: '.cortex/teams/delivery-pipeline/docs/spec/index.md',
        content:
          '# Delivery Specifications\n\n- [Policy](policy.md)\n- [Project specifications](../../../../docs/spec/index.md)\n',
      }),
      this.makeDocument({
        path: '.cortex/teams/delivery-pipeline/docs/spec/policy.md',
        content: '# Delivery Policy\n\n## Scope\n\nOne authorized operation.\n',
      }),
      this.makeDocument({
        path: '.cortex/teams/delivery-pipeline/docs/architecture/index.md',
        content: '# Delivery Architecture\n\n- [Architecture](delivery.md)\n',
      }),
      this.makeDocument({
        path: '.cortex/teams/delivery-pipeline/docs/architecture/delivery.md',
        content:
          '# Delivery Architecture\n\n## Scope\n\nProject constraints.\n',
      }),
    ];
  }

  static withContent(request: DocumentContentChange): CortexDocumentSource[] {
    return request.documents.map((document) => {
      switch (document.relativePath) {
        case request.path:
          return { ...document, content: request.content };
        default:
          return document;
      }
    });
  }
}

interface DocumentContentChange {
  readonly documents: readonly CortexDocumentSource[];
  readonly path: string;
  readonly content: string;
}
