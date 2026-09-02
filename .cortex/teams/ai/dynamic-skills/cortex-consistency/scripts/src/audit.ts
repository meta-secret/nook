import {
  CortexContractFindingCode,
  CortexContextAuthorityDocument,
  CortexPolicyArea,
  CortexPolicyCapability,
  CortexPolicyContractKind,
  type AuditCortexContractsArgs,
  type CortexContextContract,
  type CortexContractDocument,
  type CortexContractFinding,
  type CortexPolicyContract,
  type CortexRuntimeContract,
} from './domain.ts';

enum CortexContractTeam {
  Ai = 'ai',
  DevelopmentCore = 'development-core',
  GizmoPrime = 'gizmo-prime',
  Security = 'security',
  Shared = 'shared',
  Sre = 'sre',
  WebDevelopment = 'web-development',
}

export function compileCortexContracts(
  args: AuditCortexContractsArgs,
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

  for (const [authorityPath, context] of contexts) {
    const authority = documents.get(authorityPath);
    if (!authority) {
      findings.push({
        code: CortexContractFindingCode.MissingAuthorityDocument,
        file: authorityPath,
        message: `Cortex context references a missing authority document: ${authorityPath}`,
      });
      continue;
    }
    const contextOwner = cortexDocumentOwner(authorityPath);
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

  for (const runtime of args.registry.runtimes) {
    validateRuntimeContract({ runtime, documents, findings });
  }

  return findings;
}

type ValidateRuntimeContractRequest = {
  readonly runtime: CortexRuntimeContract;
  readonly documents: ReadonlyMap<string, CortexContractDocument>;
  readonly findings: CortexContractFinding[];
};

function validateRuntimeContract(
  request: ValidateRuntimeContractRequest,
): void {
  const documentPath = normalizePath(request.runtime.document);
  const document = request.documents.get(documentPath);
  if (!document) return;
  const commands = document.commands.map(normalizeCommand);
  for (const command of commands) {
    if (!runtimeCommand(command)) continue;
    const recognized = [
      ...request.runtime.allowedCommandPrefixes,
      ...request.runtime.retiredCommandPrefixes,
    ].some((prefix) => command.startsWith(prefix));
    if (recognized) continue;
    request.findings.push({
      code: CortexContractFindingCode.MissingRuntimeEntrypoint,
      file: documentPath,
      message: `Cortex workflow names an unregistered runtime entrypoint: ${command}`,
    });
  }
  for (const required of request.runtime.requiredCommandPrefixes) {
    if (commands.some((command) => command.startsWith(required))) continue;
    request.findings.push({
      code: CortexContractFindingCode.MissingRuntimeEntrypoint,
      file: documentPath,
      message: `Cortex workflow is missing its required runtime entrypoint: ${required}`,
    });
  }
  for (const retired of request.runtime.retiredCommandPrefixes) {
    if (!commands.some((command) => command.startsWith(retired))) continue;
    request.findings.push({
      code: CortexContractFindingCode.RetiredRuntimeEntrypoint,
      file: documentPath,
      message: `Cortex workflow names a retired runtime entrypoint: ${retired}`,
    });
  }
}

function normalizeCommand(command: string): string {
  return command.replaceAll(/\s+/gu, ' ').trim();
}

function runtimeCommand(command: string): boolean {
  return command.startsWith('task ') || /^loom-[A-Za-z0-9:_-]+/u.test(command);
}

type UniqueCortexContextsArgs = {
  readonly contexts: readonly CortexContextContract[];
  readonly findings: CortexContractFinding[];
};

function uniqueContexts(
  args: UniqueCortexContextsArgs,
): ReadonlyMap<CortexContextAuthorityDocument, CortexContextContract> {
  const entries = new Map<
    CortexContextAuthorityDocument,
    CortexContextContract
  >();
  for (const context of args.contexts) {
    const authorityPath = normalizePath(context.authorityDocument);
    const authority = resolveContextAuthority(authorityPath);
    if (authority.kind === CortexDocumentOwnerResolutionKind.Unrecognized) {
      args.findings.push({
        code: CortexContractFindingCode.InvalidContextOwner,
        file: authorityPath,
        message: `Cortex context authority is not a canonical AGENTS.md document: ${authorityPath}`,
      });
      continue;
    }
    if (entries.has(authority.authorityDocument)) {
      args.findings.push({
        code: CortexContractFindingCode.DuplicateContext,
        file: authorityPath,
        message: `Cortex context authority is registered more than once: ${authorityPath}`,
      });
      continue;
    }
    entries.set(authority.authorityDocument, context);
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

type CortexContextAuthorityResolution =
  | {
      readonly kind: CortexDocumentOwnerResolutionKind.Known;
      readonly authorityDocument: CortexContextAuthorityDocument;
    }
  | { readonly kind: CortexDocumentOwnerResolutionKind.Unrecognized };
function resolveContextAuthority(
  authorityPath: string,
): CortexContextAuthorityResolution {
  for (const authority of Object.values(CortexContextAuthorityDocument)) {
    if (authority === authorityPath) {
      return {
        kind: CortexDocumentOwnerResolutionKind.Known,
        authorityDocument: authority,
      };
    }
  }
  return { kind: CortexDocumentOwnerResolutionKind.Unrecognized };
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
  return args.authority.references.some((reference) => {
    const documentReference = stripDocumentFragment(reference);
    const resolved = documentReference.startsWith('.cortex/')
      ? normalizePath(documentReference)
      : normalizePath(`${directoryName(authorityPath)}/${documentReference}`);
    return resolved === target;
  });
}

function stripDocumentFragment(reference: string): string {
  const suffixIndexes = [reference.indexOf('?'), reference.indexOf('#')].filter(
    (index) => index >= 0,
  );
  const suffixIndex = Math.min(...suffixIndexes, reference.length);
  return reference.slice(0, suffixIndex);
}

type SharedPolicyAreaArgs = {
  readonly contextAreas: readonly CortexPolicyArea[];
  readonly policyAreas: readonly CortexPolicyArea[];
};

function sharesArea(args: SharedPolicyAreaArgs): boolean {
  return args.contextAreas.some((area) => args.policyAreas.includes(area));
}

function normalizePath(filePath: string): string {
  const normalized: string[] = [];
  for (const segment of filePath.replaceAll('\\', '/').split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') {
      const previous = normalized.at(-1);
      if (previous && previous !== '..') normalized.pop();
      else normalized.push(segment);
      continue;
    }
    normalized.push(segment);
  }
  return normalized.join('/');
}

function directoryName(filePath: string): string {
  return filePath.split('/').slice(0, -1).join('/');
}
