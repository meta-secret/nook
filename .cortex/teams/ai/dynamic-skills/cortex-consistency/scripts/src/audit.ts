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

export class CortexConsistencyContract {
  private constructor(private readonly request: AuditCortexContractsArgs) {}

  static compileCortexContracts(
    args: AuditCortexContractsArgs,
  ): CortexContractFinding[] {
    return new CortexConsistencyContract(args).execute();
  }

  private execute(): CortexContractFinding[] {
    const args = this.request;
    const findings: CortexContractFinding[] = [];
    const documents = new Map(
      args.documents.map((document) => [
        CortexConsistencyContract.normalizePath(document.relativePath),
        document,
      ]),
    );
    const contextArgs: UniqueCortexContextsArgs = {
      contexts: args.registry.contexts,
      findings,
    };
    const contexts = CortexConsistencyContract.uniqueContexts(contextArgs);
    const policyArgs: UniqueCortexPoliciesArgs = {
      policies: args.registry.policies,
      findings,
    };
    const policies = CortexConsistencyContract.uniquePolicies(policyArgs);

    for (const policy of policies.values()) {
      const policyPath = CortexConsistencyContract.normalizePath(
        policy.document,
      );
      if (!documents.has(policyPath)) {
        findings.push({
          code: CortexContractFindingCode.MissingPolicyDocument,
          file: policyPath,
          message: `Cortex policy references a missing document: ${policyPath}`,
        });
      }
      const documentOwner =
        CortexConsistencyContract.cortexDocumentOwner(policyPath);
      if (
        documentOwner.kind === CortexDocumentOwnerResolutionKind.Unrecognized
      ) {
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
      CortexConsistencyContract.validatePolicySafeguards(safeguardArgs);
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
      const contextOwner =
        CortexConsistencyContract.cortexDocumentOwner(authorityPath);
      const contextArgs: ValidateContextArgs = {
        context,
        contextOwner,
        authority,
        policies,
        findings,
      };
      CortexConsistencyContract.validateContextImports(contextArgs);
      CortexConsistencyContract.validatePolicyReachability(contextArgs);
    }

    for (const runtime of args.registry.runtimes) {
      CortexConsistencyContract.validateRuntimeContract({
        runtime,
        documents,
        findings,
      });
    }

    return findings;
  }

  private static validateRuntimeContract(
    request: ValidateRuntimeContractRequest,
  ): void {
    const documentPath = CortexConsistencyContract.normalizePath(
      request.runtime.document,
    );
    const document = request.documents.get(documentPath);
    if (!document) {
      request.findings.push({
        code: CortexContractFindingCode.MissingRuntimeDocument,
        file: documentPath,
        message: `Cortex runtime references a missing document: ${documentPath}`,
      });
      return;
    }
    const commands = document.commands.map(
      CortexConsistencyContract.normalizeCommand,
    );
    for (const command of commands) {
      if (!CortexConsistencyContract.runtimeCommand(command)) continue;
      const recognized = [
        ...request.runtime.allowedCommandPrefixes,
        ...request.runtime.retiredCommandPrefixes,
      ].some((prefix) =>
        CortexConsistencyContract.commandMatchesPrefix({ command, prefix }),
      );
      if (recognized) continue;
      request.findings.push({
        code: CortexContractFindingCode.MissingRuntimeEntrypoint,
        file: documentPath,
        message: `Cortex workflow names an unregistered runtime entrypoint: ${command}`,
      });
    }
    for (const required of request.runtime.requiredCommandPrefixes) {
      if (
        commands.some((command) =>
          CortexConsistencyContract.commandMatchesPrefix({
            command,
            prefix: required,
          }),
        )
      )
        continue;
      request.findings.push({
        code: CortexContractFindingCode.MissingRuntimeEntrypoint,
        file: documentPath,
        message: `Cortex workflow is missing its required runtime entrypoint: ${required}`,
      });
    }
    for (const retired of request.runtime.retiredCommandPrefixes) {
      if (
        !commands.some((command) =>
          CortexConsistencyContract.commandMatchesPrefix({
            command,
            prefix: retired,
          }),
        )
      )
        continue;
      request.findings.push({
        code: CortexContractFindingCode.RetiredRuntimeEntrypoint,
        file: documentPath,
        message: `Cortex workflow names a retired runtime entrypoint: ${retired}`,
      });
    }
  }

  private static commandMatchesPrefix(
    request: CommandPrefixMatchRequest,
  ): boolean {
    return (
      request.command === request.prefix ||
      request.command.startsWith(`${request.prefix} `)
    );
  }

  private static normalizeCommand(command: string): string {
    return command.replaceAll(/\s+/gu, ' ').trim();
  }

  private static runtimeCommand(command: string): boolean {
    return (
      command.startsWith('task ') || /^loom-[A-Za-z0-9:_-]+/u.test(command)
    );
  }

  private static uniqueContexts(
    args: UniqueCortexContextsArgs,
  ): ReadonlyMap<CortexContextAuthorityDocument, CortexContextContract> {
    const entries = new Map<
      CortexContextAuthorityDocument,
      CortexContextContract
    >();
    for (const context of args.contexts) {
      const authorityPath = CortexConsistencyContract.normalizePath(
        context.authorityDocument,
      );
      const authority =
        CortexConsistencyContract.resolveContextAuthority(authorityPath);
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

  private static uniquePolicies(
    args: UniqueCortexPoliciesArgs,
  ): ReadonlyMap<string, CortexPolicyContract> {
    const entries = new Map<string, CortexPolicyContract>();
    for (const policy of args.policies) {
      const policyPath = CortexConsistencyContract.normalizePath(
        policy.document,
      );
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

  private static cortexDocumentOwner(
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

  private static resolveContextAuthority(
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

  private static validatePolicySafeguards(
    args: ValidatePolicySafeguardsArgs,
  ): void {
    if (args.policy.kind !== CortexPolicyContractKind.PersistedRepresentation)
      return;
    const authority = args.policies.get(
      CortexConsistencyContract.normalizePath(args.policy.schemaAuthority),
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
        CortexConsistencyContract.normalizePath(args.policy.document),
      );
      if (policyDocument) {
        const referenceArgs: CortexDocumentReferenceArgs = {
          authority: policyDocument,
          targetPath: authority.document,
        };
        if (!CortexConsistencyContract.referencesDocument(referenceArgs)) {
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

  private static validateContextImports(args: ValidateContextArgs): void {
    for (const importedPath of args.context.imports) {
      const policyPath = CortexConsistencyContract.normalizePath(importedPath);
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
      if (!CortexConsistencyContract.referencesDocument(referenceArgs)) {
        const findingArgs: MissingPolicyReferenceArgs = {
          context: args.context,
          policy,
        };
        args.findings.push(
          CortexConsistencyContract.missingPolicyReference(findingArgs),
        );
      }
    }
  }

  private static validatePolicyReachability(args: ValidateContextArgs): void {
    for (const policy of args.policies.values()) {
      if (
        CortexConsistencyContract.contextOwnsPolicy({
          contextOwner: args.contextOwner,
          policy,
        })
      )
        continue;
      const coverageArgs: SharedPolicyAreaArgs = {
        contextAreas: args.context.ownsAreas,
        policyAreas: policy.areas,
      };
      if (!CortexConsistencyContract.sharesArea(coverageArgs)) continue;
      const importsPolicy = args.context.imports.some(
        (policyPath) =>
          CortexConsistencyContract.normalizePath(policyPath) ===
          CortexConsistencyContract.normalizePath(policy.document),
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
      if (!CortexConsistencyContract.referencesDocument(referenceArgs)) {
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
          args.findings.push(
            CortexConsistencyContract.missingPolicyReference(findingArgs),
          );
        }
      }
    }
  }

  private static contextOwnsPolicy(args: ContextOwnsPolicyArgs): boolean {
    if (args.contextOwner.kind !== CortexDocumentOwnerResolutionKind.Known)
      return false;
    const policyOwner = CortexConsistencyContract.cortexDocumentOwner(
      CortexConsistencyContract.normalizePath(args.policy.document),
    );
    return (
      policyOwner.kind === CortexDocumentOwnerResolutionKind.Known &&
      policyOwner.owner === args.contextOwner.owner
    );
  }

  private static missingPolicyReference(
    args: MissingPolicyReferenceArgs,
  ): CortexContractFinding {
    return {
      code: CortexContractFindingCode.MissingPolicyReference,
      file: args.context.authorityDocument,
      message: `Cortex context ${args.context.authorityDocument} imports policy ${args.policy.document} but its authority document does not reference it.`,
    };
  }

  private static referencesDocument(
    args: CortexDocumentReferenceArgs,
  ): boolean {
    const authorityPath = CortexConsistencyContract.normalizePath(
      args.authority.relativePath,
    );
    const target = CortexConsistencyContract.normalizePath(args.targetPath);
    return args.authority.references.some((reference) => {
      const documentReference =
        CortexConsistencyContract.stripDocumentFragment(reference);
      const resolved = documentReference.startsWith('.cortex/')
        ? CortexConsistencyContract.normalizePath(documentReference)
        : CortexConsistencyContract.normalizePath(
            `${CortexConsistencyContract.directoryName(authorityPath)}/${documentReference}`,
          );
      return resolved === target;
    });
  }

  private static stripDocumentFragment(reference: string): string {
    const suffixIndexes = [
      reference.indexOf('?'),
      reference.indexOf('#'),
    ].filter((index) => index >= 0);
    const suffixIndex = Math.min(...suffixIndexes, reference.length);
    return reference.slice(0, suffixIndex);
  }

  private static sharesArea(args: SharedPolicyAreaArgs): boolean {
    return args.contextAreas.some((area) => args.policyAreas.includes(area));
  }

  private static normalizePath(filePath: string): string {
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

  private static directoryName(filePath: string): string {
    return filePath.split('/').slice(0, -1).join('/');
  }
}

enum CortexContractTeam {
  Ai = 'ai',
  DevelopmentCore = 'development-core',
  GizmoPrime = 'gizmo-prime',
  Security = 'security',
  Shared = 'shared',
  Sre = 'sre',
  WebDevelopment = 'web-development',
}

type ValidateRuntimeContractRequest = {
  readonly runtime: CortexRuntimeContract;
  readonly documents: ReadonlyMap<string, CortexContractDocument>;
  readonly findings: CortexContractFinding[];
};

type CommandPrefixMatchRequest = {
  readonly command: string;
  readonly prefix: string;
};

type UniqueCortexContextsArgs = {
  readonly contexts: readonly CortexContextContract[];
  readonly findings: CortexContractFinding[];
};

type UniqueCortexPoliciesArgs = {
  readonly policies: readonly CortexPolicyContract[];
  readonly findings: CortexContractFinding[];
};

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

type CortexContextAuthorityResolution =
  | {
      readonly kind: CortexDocumentOwnerResolutionKind.Known;
      readonly authorityDocument: CortexContextAuthorityDocument;
    }
  | { readonly kind: CortexDocumentOwnerResolutionKind.Unrecognized };

type ValidatePolicySafeguardsArgs = {
  readonly policy: CortexPolicyContract;
  readonly policies: ReadonlyMap<string, CortexPolicyContract>;
  readonly documents: ReadonlyMap<string, CortexContractDocument>;
  readonly findings: CortexContractFinding[];
};

type ValidateContextArgs = {
  readonly context: CortexContextContract;
  readonly contextOwner: CortexDocumentOwnerResolution;
  readonly authority: CortexContractDocument;
  readonly policies: ReadonlyMap<string, CortexPolicyContract>;
  readonly findings: CortexContractFinding[];
};

type ContextOwnsPolicyArgs = {
  readonly contextOwner: CortexDocumentOwnerResolution;
  readonly policy: CortexPolicyContract;
};

type MissingPolicyReferenceArgs = {
  readonly context: CortexContextContract;
  readonly policy: CortexPolicyContract;
};

type CortexDocumentReferenceArgs = {
  readonly authority: CortexContractDocument;
  readonly targetPath: string;
};

type SharedPolicyAreaArgs = {
  readonly contextAreas: readonly CortexPolicyArea[];
  readonly policyAreas: readonly CortexPolicyArea[];
};
