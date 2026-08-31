import type { Nodes } from 'mdast';
import path from 'node:path';
import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import { unified } from 'unified';

enum CortexContractTeam {
  Ai = 'ai',
  DevelopmentCore = 'development-core',
  GizmoPrime = 'gizmo-prime',
  Security = 'security',
  Shared = 'shared',
  Sre = 'sre',
  WebDevelopment = 'web-development',
}

export enum CortexPolicyArea {
  CortexAuthoring = 'cortex-authoring',
  GithubTypescript = 'github-typescript',
}

export enum CortexPolicyCapability {
  SchemaVersioning = 'schema-versioning',
}

export enum CortexCompatibilityEvidence {
  LegacyDecodeTest = 'legacy-decode-test',
  MigrationTest = 'migration-test',
}

export enum CortexPolicyContractKind {
  General = 'general',
  PersistedRepresentation = 'persisted-representation',
}

type CortexPolicyContractBase = {
  readonly document: string;
  readonly areas: readonly CortexPolicyArea[];
  readonly capabilities: readonly CortexPolicyCapability[];
};

export type CortexGeneralPolicyContract = CortexPolicyContractBase & {
  readonly kind: CortexPolicyContractKind.General;
};

export type CortexPersistedRepresentationPolicyContract =
  CortexPolicyContractBase & {
    readonly kind: CortexPolicyContractKind.PersistedRepresentation;
    readonly schemaAuthority: string;
    readonly evidence: readonly CortexCompatibilityEvidence[];
  };

export type CortexPolicyContract =
  CortexGeneralPolicyContract | CortexPersistedRepresentationPolicyContract;

export type CortexContextContract = {
  readonly authorityDocument: string;
  readonly ownsAreas: readonly CortexPolicyArea[];
  readonly imports: readonly string[];
};

export type CortexContractRegistry = {
  readonly contexts: readonly CortexContextContract[];
  readonly policies: readonly CortexPolicyContract[];
};

export type CortexContractDocument = {
  readonly relativePath: string;
  readonly content: string;
};

export enum CortexContractFindingCode {
  DuplicateContext = 'duplicate-context',
  DuplicatePolicy = 'duplicate-policy',
  InvalidContextOwner = 'invalid-context-owner',
  InvalidPolicyOwner = 'invalid-policy-owner',
  InvalidSchemaAuthority = 'invalid-schema-authority',
  MissingAuthorityDocument = 'missing-authority-document',
  MissingCompatibilityEvidence = 'missing-compatibility-evidence',
  MissingPolicyDocument = 'missing-policy-document',
  MissingPolicyImport = 'missing-policy-import',
  MissingPolicyReference = 'missing-policy-reference',
  MissingSchemaAuthorityReference = 'missing-schema-authority-reference',
  UnknownPolicyImport = 'unknown-policy-import',
}

export type CortexContractFinding = {
  readonly code: CortexContractFindingCode;
  readonly file: string;
  readonly message: string;
};

export type CompileCortexContractsArgs = {
  readonly registry: CortexContractRegistry;
  readonly documents: readonly CortexContractDocument[];
};

export function compileCortexContracts(
  args: CompileCortexContractsArgs,
): CortexContractFinding[] {
  const findings: CortexContractFinding[] = [];
  const documents = new Map(
    args.documents.map((document) => [
      normalizePath(document.relativePath),
      document,
    ]),
  );
  const contextArgs: UniqueCortexContextsArgs = {
    contexts: args.registry.contexts,
    findings,
  };
  const contexts = uniqueContexts(contextArgs);
  const policyArgs: UniqueCortexPoliciesArgs = {
    policies: args.registry.policies,
    findings,
  };
  const policies = uniquePolicies(policyArgs);

  for (const policy of policies.values()) {
    const policyPath = normalizePath(policy.document);
    if (!documents.has(policyPath)) {
      findings.push({
        code: CortexContractFindingCode.MissingPolicyDocument,
        file: policyPath,
        message: `Cortex policy references a missing document: ${policyPath}`,
      });
    }
    const documentOwner = cortexDocumentOwner(policyPath);
    if (documentOwner.kind === CortexDocumentOwnerResolutionKind.Unrecognized) {
      findings.push({
        code: CortexContractFindingCode.InvalidPolicyOwner,
        file: policyPath,
        message: `Cortex policy ${policyPath} is outside every recognized ownership path.`,
      });
    }
    const safeguardArgs: ValidatePolicySafeguardsArgs = {
      policy,
      policies,
      documents,
      findings,
    };
    validatePolicySafeguards(safeguardArgs);
  }

  for (const context of contexts.values()) {
    const authorityPath = normalizePath(context.authorityDocument);
    const authority = documents.get(authorityPath);
    if (!authority) {
      findings.push({
        code: CortexContractFindingCode.MissingAuthorityDocument,
        file: authorityPath,
        message: `Cortex context references a missing authority document: ${authorityPath}`,
      });
      continue;
    }
    const contextOwner = resolveContextOwner({
      authorityPath,
      findings,
    });
    const contextArgs: ValidateContextArgs = {
      context,
      contextOwner,
      authority,
      policies,
      findings,
    };
    validateContextImports(contextArgs);
    validatePolicyReachability(contextArgs);
  }

  return findings;
}

type UniqueCortexContextsArgs = {
  readonly contexts: readonly CortexContextContract[];
  readonly findings: CortexContractFinding[];
};

function uniqueContexts(
  args: UniqueCortexContextsArgs,
): ReadonlyMap<string, CortexContextContract> {
  const entries = new Map<string, CortexContextContract>();
  for (const context of args.contexts) {
    const authorityPath = normalizePath(context.authorityDocument);
    if (entries.has(authorityPath)) {
      args.findings.push({
        code: CortexContractFindingCode.DuplicateContext,
        file: authorityPath,
        message: `Cortex context authority is registered more than once: ${authorityPath}`,
      });
      continue;
    }
    entries.set(authorityPath, context);
  }
  return entries;
}

type UniqueCortexPoliciesArgs = {
  readonly policies: readonly CortexPolicyContract[];
  readonly findings: CortexContractFinding[];
};

function uniquePolicies(
  args: UniqueCortexPoliciesArgs,
): ReadonlyMap<string, CortexPolicyContract> {
  const entries = new Map<string, CortexPolicyContract>();
  for (const policy of args.policies) {
    const policyPath = normalizePath(policy.document);
    if (entries.has(policyPath)) {
      args.findings.push({
        code: CortexContractFindingCode.DuplicatePolicy,
        file: policyPath,
        message: `Cortex policy document is registered more than once: ${policyPath}`,
      });
      continue;
    }
    entries.set(policyPath, policy);
  }
  return entries;
}

enum CortexDocumentOwnerResolutionKind {
  Known = 'known',
  Unrecognized = 'unrecognized',
}

type CortexDocumentOwnerResolution =
  | {
      readonly kind: CortexDocumentOwnerResolutionKind.Known;
      readonly owner: CortexContractTeam;
    }
  | { readonly kind: CortexDocumentOwnerResolutionKind.Unrecognized };

function cortexDocumentOwner(
  documentPath: string,
): CortexDocumentOwnerResolution {
  if (documentPath === '.cortex/AGENTS.md') {
    return {
      kind: CortexDocumentOwnerResolutionKind.Known,
      owner: CortexContractTeam.GizmoPrime,
    };
  }
  const owners: readonly (readonly [string, CortexContractTeam])[] = [
    ['.cortex/gizmo/', CortexContractTeam.GizmoPrime],
    ['.cortex/shared/', CortexContractTeam.Shared],
    ['.cortex/teams/ai/', CortexContractTeam.Ai],
    ['.cortex/teams/dev-core/', CortexContractTeam.DevelopmentCore],
    ['.cortex/teams/security/', CortexContractTeam.Security],
    ['.cortex/teams/sre/', CortexContractTeam.Sre],
    ['.cortex/teams/web-dev/', CortexContractTeam.WebDevelopment],
  ];
  for (const [prefix, owner] of owners) {
    if (documentPath.startsWith(prefix)) {
      return { kind: CortexDocumentOwnerResolutionKind.Known, owner };
    }
  }
  return { kind: CortexDocumentOwnerResolutionKind.Unrecognized };
}

type ResolveContextOwnerArgs = {
  readonly authorityPath: string;
  readonly findings: CortexContractFinding[];
};

function resolveContextOwner(
  args: ResolveContextOwnerArgs,
): CortexDocumentOwnerResolution {
  const documentOwner = cortexDocumentOwner(args.authorityPath);
  if (documentOwner.kind === CortexDocumentOwnerResolutionKind.Unrecognized) {
    args.findings.push({
      code: CortexContractFindingCode.InvalidContextOwner,
      file: args.authorityPath,
      message: `Cortex context authority is outside every recognized ownership path: ${args.authorityPath}`,
    });
    return documentOwner;
  }
  return documentOwner;
}

type ValidatePolicySafeguardsArgs = {
  readonly policy: CortexPolicyContract;
  readonly policies: ReadonlyMap<string, CortexPolicyContract>;
  readonly documents: ReadonlyMap<string, CortexContractDocument>;
  readonly findings: CortexContractFinding[];
};

function validatePolicySafeguards(args: ValidatePolicySafeguardsArgs): void {
  if (args.policy.kind !== CortexPolicyContractKind.PersistedRepresentation)
    return;
  const authority = args.policies.get(
    normalizePath(args.policy.schemaAuthority),
  );
  if (
    !authority ||
    !authority.capabilities.includes(CortexPolicyCapability.SchemaVersioning)
  ) {
    args.findings.push({
      code: CortexContractFindingCode.InvalidSchemaAuthority,
      file: args.policy.document,
      message: `Persisted policy ${args.policy.document} requires a schema-versioning authority; ${args.policy.schemaAuthority} does not provide it.`,
    });
  } else {
    const policyDocument = args.documents.get(
      normalizePath(args.policy.document),
    );
    if (policyDocument) {
      const referenceArgs: CortexDocumentReferenceArgs = {
        authority: policyDocument,
        targetPath: authority.document,
      };
      if (!referencesDocument(referenceArgs)) {
        args.findings.push({
          code: CortexContractFindingCode.MissingSchemaAuthorityReference,
          file: args.policy.document,
          message: `Persisted policy ${args.policy.document} does not reference its schema authority document ${authority.document}.`,
        });
      }
    }
  }
  if (args.policy.evidence.length === 0) {
    args.findings.push({
      code: CortexContractFindingCode.MissingCompatibilityEvidence,
      file: args.policy.document,
      message: `Persisted policy ${args.policy.document} must require a legacy decode test or migration test.`,
    });
  }
}

type ValidateContextArgs = {
  readonly context: CortexContextContract;
  readonly contextOwner: CortexDocumentOwnerResolution;
  readonly authority: CortexContractDocument;
  readonly policies: ReadonlyMap<string, CortexPolicyContract>;
  readonly findings: CortexContractFinding[];
};

function validateContextImports(args: ValidateContextArgs): void {
  for (const importedPath of args.context.imports) {
    const policyPath = normalizePath(importedPath);
    const policy = args.policies.get(policyPath);
    if (!policy) {
      args.findings.push({
        code: CortexContractFindingCode.UnknownPolicyImport,
        file: args.authority.relativePath,
        message: `Cortex context ${args.context.authorityDocument} imports an unknown policy document: ${policyPath}`,
      });
      continue;
    }
    const referenceArgs: CortexDocumentReferenceArgs = {
      authority: args.authority,
      targetPath: policy.document,
    };
    if (!referencesDocument(referenceArgs)) {
      const findingArgs: MissingPolicyReferenceArgs = {
        context: args.context,
        policy,
      };
      args.findings.push(missingPolicyReference(findingArgs));
    }
  }
}

function validatePolicyReachability(args: ValidateContextArgs): void {
  for (const policy of args.policies.values()) {
    if (contextOwnsPolicy({ contextOwner: args.contextOwner, policy }))
      continue;
    const coverageArgs: SharedPolicyAreaArgs = {
      contextAreas: args.context.ownsAreas,
      policyAreas: policy.areas,
    };
    if (!sharesArea(coverageArgs)) continue;
    const importsPolicy = args.context.imports.some(
      (policyPath) =>
        normalizePath(policyPath) === normalizePath(policy.document),
    );
    if (!importsPolicy) {
      args.findings.push({
        code: CortexContractFindingCode.MissingPolicyImport,
        file: args.authority.relativePath,
        message: `Cortex context ${args.context.authorityDocument} owns an area covered by foreign policy ${policy.document} but does not import it.`,
      });
      continue;
    }
    const referenceArgs: CortexDocumentReferenceArgs = {
      authority: args.authority,
      targetPath: policy.document,
    };
    if (!referencesDocument(referenceArgs)) {
      const alreadyReported = args.findings.some(
        (finding) =>
          finding.code === CortexContractFindingCode.MissingPolicyReference &&
          finding.file === args.authority.relativePath &&
          finding.message.includes(policy.document),
      );
      if (!alreadyReported) {
        const findingArgs: MissingPolicyReferenceArgs = {
          context: args.context,
          policy,
        };
        args.findings.push(missingPolicyReference(findingArgs));
      }
    }
  }
}

type ContextOwnsPolicyArgs = {
  readonly contextOwner: CortexDocumentOwnerResolution;
  readonly policy: CortexPolicyContract;
};

function contextOwnsPolicy(args: ContextOwnsPolicyArgs): boolean {
  if (args.contextOwner.kind !== CortexDocumentOwnerResolutionKind.Known)
    return false;
  const policyOwner = cortexDocumentOwner(normalizePath(args.policy.document));
  return (
    policyOwner.kind === CortexDocumentOwnerResolutionKind.Known &&
    policyOwner.owner === args.contextOwner.owner
  );
}

type MissingPolicyReferenceArgs = {
  readonly context: CortexContextContract;
  readonly policy: CortexPolicyContract;
};

function missingPolicyReference(
  args: MissingPolicyReferenceArgs,
): CortexContractFinding {
  return {
    code: CortexContractFindingCode.MissingPolicyReference,
    file: args.context.authorityDocument,
    message: `Cortex context ${args.context.authorityDocument} imports policy ${args.policy.document} but its authority document does not reference it.`,
  };
}

type CortexDocumentReferenceArgs = {
  readonly authority: CortexContractDocument;
  readonly targetPath: string;
};

function referencesDocument(args: CortexDocumentReferenceArgs): boolean {
  const authorityPath = normalizePath(args.authority.relativePath);
  const target = normalizePath(args.targetPath);
  return markdownReferences(args.authority.content).some((reference) => {
    const documentReference = stripDocumentFragment(reference);
    const resolved = documentReference.startsWith('.cortex/')
      ? normalizePath(documentReference)
      : path.posix.normalize(
          path.posix.join(path.posix.dirname(authorityPath), documentReference),
        );
    return resolved === target;
  });
}

function stripDocumentFragment(reference: string): string {
  const fragmentIndex = reference.indexOf('#');
  return fragmentIndex === -1 ? reference : reference.slice(0, fragmentIndex);
}

type MarkdownReferenceCollection = {
  readonly definitions: ReadonlyMap<string, string>;
  readonly references: string[];
};

function markdownReferences(content: string): readonly string[] {
  const root = unified().use(remarkParse).use(remarkGfm).parse(content);
  const definitions = new Map<string, string>();
  const definitionVisitor = (node: Nodes): void => {
    if (node.type !== 'definition') return;
    definitions.set(node.identifier.toUpperCase(), node.url);
  };
  visitMarkdownNode({ node: root, visitor: definitionVisitor });
  const collection: MarkdownReferenceCollection = {
    definitions,
    references: [],
  };
  const referenceVisitor = (node: Nodes): void => {
    collectMarkdownReference({ node, collection });
  };
  visitMarkdownNode({ node: root, visitor: referenceVisitor });
  return collection.references;
}

type CollectMarkdownReferenceArgs = {
  readonly node: Nodes;
  readonly collection: MarkdownReferenceCollection;
};

function collectMarkdownReference(args: CollectMarkdownReferenceArgs): void {
  if (args.node.type === 'link') {
    args.collection.references.push(args.node.url);
    return;
  }
  if (args.node.type === 'linkReference') {
    const destination = args.collection.definitions.get(
      args.node.identifier.toUpperCase(),
    );
    if (destination) args.collection.references.push(destination);
    return;
  }
  if (args.node.type === 'inlineCode') {
    args.collection.references.push(args.node.value);
  }
}

type VisitMarkdownArgs = {
  readonly node: Nodes;
  readonly visitor: (node: Nodes) => void;
};

function visitMarkdownNode(args: VisitMarkdownArgs): void {
  args.visitor(args.node);
  if (!('children' in args.node)) return;
  for (const child of args.node.children) {
    visitMarkdownNode({ node: child, visitor: args.visitor });
  }
}

type SharedPolicyAreaArgs = {
  readonly contextAreas: readonly CortexPolicyArea[];
  readonly policyAreas: readonly CortexPolicyArea[];
};

function sharesArea(args: SharedPolicyAreaArgs): boolean {
  return args.contextAreas.some((area) => args.policyAreas.includes(area));
}

function normalizePath(filePath: string): string {
  return path.posix.normalize(filePath.replaceAll('\\', '/'));
}
