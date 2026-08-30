export enum DelegatedAgentWorkflowName {
  AgentWork = 'delegated-agent-work',
}

export type AgentProcessingWorkflowName = DelegatedAgentWorkflowName;

export enum WorkflowExecutorKind {
  Agent = 'agent',
}

export enum AgentWorkspacePolicy {
  ReadOnly = 'read-only',
}

export enum AgentAttemptAdapterKind {
  GenericDelegationRecorder = 'generic-delegation-recorder',
  ModuleExpertInvocation = 'module-expert-invocation',
  StructuralExpertInvocation = 'structural-expert-invocation',
}

export enum AgentReasoningEffort {
  Low = 'low',
  Medium = 'medium',
  High = 'high',
}

export enum TaskTerminalKind {
  Completed = 'completed',
  Failed = 'failed',
  Blocked = 'blocked',
  Cancelled = 'cancelled',
  TimedOut = 'timed-out',
  Skipped = 'skipped',
}

export enum WorkflowArtifactKind {
  File = 'file',
  Report = 'report',
}

export enum WorkflowFindingSeverity {
  Information = 'information',
  Warning = 'warning',
  Error = 'error',
}

export enum WorkflowResultKind {
  CodeRefactoringEvidence = 'code-refactoring-evidence',
  CortexEvidence = 'cortex-evidence',
  CortexRefactoringEvidence = 'cortex-refactoring-evidence',
  ModuleDevelopmentPlan = 'module-development-plan',
  ModuleExpertEvidence = 'module-expert-evidence',
  StructuralExpertPlan = 'structural-expert-plan',
  SystemCoherenceSynthesis = 'system-coherence-synthesis',
}

export type WorkflowRunId = string;
export type WorkflowVersion = string;
export type WorkflowEventSequence = number;
export type WorkflowAttemptNumber = number;
export type IsoTimestamp = string;
export type GitCommit = string;

export type AgentProfile<TAgent extends string> = {
  readonly name: TAgent;
  readonly instructionPrefix: string;
  readonly workspacePolicy: AgentWorkspacePolicy;
  readonly reasoningEffort: AgentReasoningEffort;
};

export type AgentTaskExecution<TAgent extends string> = {
  readonly kind: WorkflowExecutorKind.Agent;
  readonly agent: TAgent;
  readonly instruction: string;
  readonly resultKind: WorkflowResultKind;
};

export type TaskResourceClaims = {
  readonly read: readonly string[];
  readonly write: readonly string[];
};

export type TaskResourcePatternPair = {
  readonly first: string;
  readonly second: string;
};

enum ResourceClaimKind {
  Git = 'git',
  Exact = 'exact',
  Subtree = 'subtree',
  DirectGlob = 'direct-glob',
  RecursiveBasename = 'recursive-basename',
}

type ResourceClaimDescriptor = {
  readonly kind: ResourceClaimKind;
  readonly path: string;
  readonly basename: string;
};

export function isValidTaskResourceClaim(claim: string): boolean {
  return parseResourceClaim(claim) !== false;
}

export function taskResourcePatternsOverlap(
  pair: TaskResourcePatternPair,
): boolean {
  const first = parseResourceClaim(pair.first);
  const second = parseResourceClaim(pair.second);
  if (!first || !second) return false;
  if (first.kind === ResourceClaimKind.Git) {
    return second.kind === ResourceClaimKind.Git && first.path === second.path;
  }
  if (second.kind === ResourceClaimKind.Git) return false;
  if (
    first.kind === ResourceClaimKind.RecursiveBasename ||
    second.kind === ResourceClaimKind.RecursiveBasename
  ) {
    const descriptors: ResourceDescriptorPair = { first, second };
    return recursiveBasenameOverlaps(descriptors);
  }
  if (
    first.kind === ResourceClaimKind.DirectGlob ||
    second.kind === ResourceClaimKind.DirectGlob
  ) {
    const overlap: ResourceDescriptorPair = { first, second };
    return directGlobOverlaps(overlap);
  }
  const pathPair: TaskResourcePatternPair = {
    first: first.path,
    second: second.path,
  };
  return pathsAreNested(pathPair);
}

function parseResourceClaim(claim: string): ResourceClaimDescriptor | false {
  if (!hasCanonicalResourcePathSegments(claim)) return false;
  if (/^git:[A-Za-z0-9._/-]+$/.test(claim)) {
    return { kind: ResourceClaimKind.Git, path: claim, basename: '' };
  }
  const literalPath = '[A-Za-z0-9._-]+(?:/[A-Za-z0-9._-]+)*';
  if (new RegExp(`^${literalPath}$`).test(claim)) {
    return { kind: ResourceClaimKind.Exact, path: claim, basename: '' };
  }
  if (new RegExp(`^${literalPath}/\\*\\*$`).test(claim)) {
    return {
      kind: ResourceClaimKind.Subtree,
      path: claim.slice(0, -3),
      basename: '',
    };
  }
  const globBasename = '\\*(?:\\.[A-Za-z0-9_-]+)?';
  const directMatch = claim.match(
    new RegExp(`^(${literalPath})/(${globBasename})$`),
  );
  if (directMatch?.[1] && directMatch[2]) {
    return {
      kind: ResourceClaimKind.DirectGlob,
      path: directMatch[1],
      basename: directMatch[2],
    };
  }
  const recursiveMatch = claim.match(
    new RegExp(`^\\*\\*/([A-Za-z0-9._-]+|${globBasename})$`),
  );
  if (recursiveMatch?.[1]) {
    return {
      kind: ResourceClaimKind.RecursiveBasename,
      path: '',
      basename: recursiveMatch[1],
    };
  }
  return false;
}

function hasCanonicalResourcePathSegments(claim: string): boolean {
  const path = claim.startsWith('git:') ? claim.slice(4) : claim;
  return path
    .split('/')
    .every((segment) => segment !== '.' && segment !== '..');
}

function pathsAreNested(pair: TaskResourcePatternPair): boolean {
  return (
    pair.first === pair.second ||
    pair.first.startsWith(`${pair.second}/`) ||
    pair.second.startsWith(`${pair.first}/`)
  );
}

type ResourceDescriptorPair = {
  readonly first: ResourceClaimDescriptor;
  readonly second: ResourceClaimDescriptor;
};

type RecursiveExactOverlapInspection = {
  readonly recursiveBasename: string;
  readonly exactPath: string;
};

function recursiveBasenameOverlaps(pair: ResourceDescriptorPair): boolean {
  const recursive =
    pair.first.kind === ResourceClaimKind.RecursiveBasename
      ? pair.first
      : pair.second;
  const other = recursive === pair.first ? pair.second : pair.first;
  if (other.kind === ResourceClaimKind.Subtree) return true;
  if (other.kind === ResourceClaimKind.DirectGlob) return true;
  if (other.kind === ResourceClaimKind.RecursiveBasename) return true;
  if (other.kind === ResourceClaimKind.Exact) {
    const inspection: RecursiveExactOverlapInspection = {
      recursiveBasename: recursive.basename,
      exactPath: other.path,
    };
    return exactPathOverlapsRecursiveBasename(inspection);
  }
  return false;
}

function exactPathOverlapsRecursiveBasename(
  inspection: RecursiveExactOverlapInspection,
): boolean {
  const matchingSegment = inspection.exactPath.split('/').some((segment) => {
    const basenames: TaskResourcePatternPair = {
      first: inspection.recursiveBasename,
      second: segment,
    };
    return globBasenamesOverlap(basenames);
  });
  return matchingSegment || exactClaimCanNameDirectory(inspection.exactPath);
}

function exactClaimCanNameDirectory(resourcePath: string): boolean {
  const basename = basenameOfPath(resourcePath);
  return basename.startsWith('.') || !basename.includes('.');
}

function basenameOfPath(resourcePath: string): string {
  return resourcePath.split('/').at(-1) ?? resourcePath;
}

function directGlobOverlaps(pair: ResourceDescriptorPair): boolean {
  const first = pair.first;
  const second = pair.second;
  if (
    first.kind === ResourceClaimKind.DirectGlob &&
    second.kind === ResourceClaimKind.DirectGlob
  ) {
    if (first.path !== second.path) {
      const outer = second.path.startsWith(`${first.path}/`)
        ? first
        : first.path.startsWith(`${second.path}/`)
          ? second
          : false;
      if (!outer) return false;
      const inner = outer === first ? second : first;
      const relative = inner.path.slice(outer.path.length + 1);
      const firstSegment = relative.split('/')[0] ?? '';
      const nestedBasenames: TaskResourcePatternPair = {
        first: outer.basename,
        second: firstSegment,
      };
      return globBasenamesOverlap(nestedBasenames);
    }
    const basenames: TaskResourcePatternPair = {
      first: first.basename,
      second: second.basename,
    };
    return globBasenamesOverlap(basenames);
  }
  const glob = first.kind === ResourceClaimKind.DirectGlob ? first : second;
  const concrete = glob === first ? second : first;
  if (concrete.path === glob.path) return true;
  if (concrete.path.startsWith(`${glob.path}/`)) {
    const relative = concrete.path.slice(glob.path.length + 1);
    const firstSegment = relative.split('/')[0] ?? '';
    const basenames: TaskResourcePatternPair = {
      first: glob.basename,
      second: firstSegment,
    };
    return globBasenamesOverlap(basenames);
  }
  return glob.path.startsWith(`${concrete.path}/`);
}

function globBasenamesOverlap(pair: TaskResourcePatternPair): boolean {
  if (pair.first === '*' || pair.second === '*') return true;
  if (!pair.first.startsWith('*') && !pair.second.startsWith('*')) {
    return pair.first === pair.second;
  }
  if (pair.first.startsWith('*') && pair.second.startsWith('*')) {
    return pair.first === pair.second;
  }
  const glob = pair.first.startsWith('*') ? pair.first : pair.second;
  const literal = glob === pair.first ? pair.second : pair.first;
  return literal.endsWith(glob.slice(1));
}

export type WorkflowFinding = {
  readonly severity: WorkflowFindingSeverity;
  readonly title: string;
  readonly summary: string;
  readonly evidence: readonly string[];
  readonly affectedPaths: readonly string[];
};

export type WorkflowArtifactReference = {
  readonly kind: WorkflowArtifactKind;
  readonly location: string;
  readonly description: string;
};

export type ModuleExpertContinuation = {
  readonly externalApi: readonly string[];
  readonly dependencies: readonly string[];
  readonly consumers: readonly string[];
  readonly behaviorInvariants: readonly string[];
  readonly securityInvariants: readonly string[];
  readonly compatibilityInvariants: readonly string[];
  readonly owningTests: readonly string[];
  readonly focusedValidation: readonly string[];
  readonly risks: readonly string[];
  readonly unresolvedDecisions: readonly string[];
  readonly parentActions: readonly string[];
};

export type ModuleExpertAuthorization = {
  readonly task: string;
  readonly expert: string;
  readonly attempt: WorkflowAttemptNumber;
  readonly depth: number;
  readonly parent: ParentAgentAttempt;
};

export enum StructuralExpertAuthorizationKind {
  RepositoryEvidence = 'repository-evidence',
  VerifiedViewSynthesis = 'verified-view-synthesis',
}

export type StructuralChildProjectionAuthorization = {
  readonly task: string;
  readonly expert: string;
  readonly attempt: WorkflowAttemptNumber;
  readonly resultPath: string;
  readonly resultSha256: string;
  readonly viewPath: string;
  readonly viewSha256: string;
};

export type StructuralChildLanePreauthorization = {
  readonly task: string;
  readonly expert: string;
  readonly attempt: WorkflowAttemptNumber;
};

type StructuralExpertAuthorizationFields = {
  readonly task: string;
  readonly expert: string;
  readonly attempt: WorkflowAttemptNumber;
  readonly depth: 2;
  readonly parent: ParentAgentAttempt;
};

export type StructuralEvidenceAuthorization =
  StructuralExpertAuthorizationFields & {
    readonly kind: StructuralExpertAuthorizationKind.RepositoryEvidence;
    readonly evidencePaths: readonly string[];
  };

export type StructuralSynthesisPreauthorization =
  StructuralExpertAuthorizationFields & {
    readonly kind: StructuralExpertAuthorizationKind.VerifiedViewSynthesis;
    readonly childLanes: readonly StructuralChildLanePreauthorization[];
  };

export type StructuralExpertAuthorization =
  StructuralEvidenceAuthorization | StructuralSynthesisPreauthorization;

export enum StructuralFindingCategory {
  Architecture = 'architecture',
  Design = 'design',
  CodeQuality = 'code-quality',
  TypeSafety = 'type-safety',
  Tests = 'tests',
  DependencyDirection = 'dependency-direction',
  AuthorityConflict = 'authority-conflict',
  ObsoleteClaim = 'obsolete-claim',
  HistoricalClaim = 'historical-claim',
  Duplication = 'duplication',
  Complexity = 'complexity',
  KnowledgeGraph = 'knowledge-graph',
  DeterministicExtraction = 'deterministic-extraction',
}

export enum StructuralFindingSeverity {
  Advisory = 'advisory',
  Low = 'low',
  Medium = 'medium',
  High = 'high',
  Critical = 'critical',
}

export enum StructuralFindingDisposition {
  Keep = 'keep',
  Simplify = 'simplify',
  Merge = 'merge',
  Split = 'split',
  Relocate = 'relocate',
  LabelHistorical = 'label-historical',
  Remove = 'remove',
  ProposeDeterministicExtraction = 'propose-deterministic-extraction',
  Investigate = 'investigate',
}

export type StructuralFindingEvidence = {
  readonly path: string;
  readonly locator: string;
  readonly observation: string;
};

export type StructuralFinding<
  TCategory extends StructuralFindingCategory = StructuralFindingCategory,
> = {
  readonly findingId: string;
  readonly category: TCategory;
  readonly severity: StructuralFindingSeverity;
  readonly disposition: StructuralFindingDisposition;
  readonly summary: string;
  readonly evidence: readonly StructuralFindingEvidence[];
  readonly affectedPaths: readonly string[];
  readonly currentOwner: string;
  readonly proposedOwner: string;
  readonly preservedInvariants: readonly string[];
  readonly validation: readonly string[];
  readonly unresolvedDecision: string;
};

export enum StructuralAssessmentKind {
  Findings = 'findings',
  None = 'none',
}

export type StructuralFindingsAssessment<
  TCategory extends StructuralFindingCategory,
> = {
  readonly kind: StructuralAssessmentKind.Findings;
  readonly findings: readonly [
    StructuralFinding<TCategory>,
    ...StructuralFinding<TCategory>[],
  ];
};

export type StructuralNoneAssessment = {
  readonly kind: StructuralAssessmentKind.None;
  readonly reason: string;
};

export type StructuralFindingAssessment<
  TCategory extends StructuralFindingCategory,
> = StructuralFindingsAssessment<TCategory> | StructuralNoneAssessment;

export enum StructuralInstructionClassificationKind {
  ProjectKnowledge = 'project-knowledge',
  AgentProtocol = 'agent-protocol',
  ProjectWorkflow = 'project-workflow',
  EphemeralKnowledge = 'ephemeral-knowledge',
  DeterministicMechanic = 'deterministic-mechanic',
  SemanticPolicy = 'semantic-policy',
}

export type StructuralInstructionClassification = {
  readonly instructionId: string;
  readonly classification: StructuralInstructionClassificationKind;
  readonly authorityPath: string;
  readonly summary: string;
  readonly evidence: readonly StructuralFindingEvidence[];
};

export enum LoomExtractionClassification {
  Deterministic = 'deterministic',
  Mixed = 'mixed',
  Semantic = 'semantic',
}

export enum LoomExtractionTarget {
  LoomLeaf = 'loom-leaf',
  TaskEntrypoint = 'task-entrypoint',
}

export type LoomExtractionCandidate = {
  readonly candidateId: string;
  readonly classification: LoomExtractionClassification;
  readonly target: LoomExtractionTarget;
  readonly summary: string;
  readonly declaredInputs: readonly string[];
  readonly declaredOutputs: readonly string[];
  readonly failureBehavior: readonly string[];
  readonly residualSemanticPolicy: readonly string[];
  readonly evidence: readonly StructuralFindingEvidence[];
};

export type CodeRefactoringContinuation = {
  readonly scopeModules: readonly string[];
  readonly acceptedExternalContracts: readonly string[];
  readonly preservedBehaviorInvariants: readonly string[];
  readonly preservedSecurityInvariants: readonly string[];
  readonly architectureFindings: StructuralFindingAssessment<StructuralFindingCategory.Architecture>;
  readonly designFindings: StructuralFindingAssessment<StructuralFindingCategory.Design>;
  readonly codeQualityFindings: StructuralFindingAssessment<StructuralFindingCategory.CodeQuality>;
  readonly typeSafetyFindings: StructuralFindingAssessment<StructuralFindingCategory.TypeSafety>;
  readonly testFindings: StructuralFindingAssessment<StructuralFindingCategory.Tests>;
  readonly dependencyDirectionFindings: StructuralFindingAssessment<StructuralFindingCategory.DependencyDirection>;
  readonly proposedSlices: readonly string[];
  readonly focusedValidation: readonly string[];
  readonly risks: readonly string[];
  readonly unresolvedDecisions: readonly string[];
  readonly parentActions: readonly string[];
};

export type CortexRefactoringContinuation = {
  readonly authoritySet: readonly string[];
  readonly canonicalOwners: readonly string[];
  readonly conflicts: StructuralFindingAssessment<StructuralFindingCategory.AuthorityConflict>;
  readonly obsoleteClaims: StructuralFindingAssessment<StructuralFindingCategory.ObsoleteClaim>;
  readonly historicalClaims: StructuralFindingAssessment<StructuralFindingCategory.HistoricalClaim>;
  readonly duplications: StructuralFindingAssessment<StructuralFindingCategory.Duplication>;
  readonly complexityFindings: StructuralFindingAssessment<StructuralFindingCategory.Complexity>;
  readonly instructionClassifications: readonly StructuralInstructionClassification[];
  readonly loomExtractionCandidates: readonly LoomExtractionCandidate[];
  readonly knowledgeGraphImpacts: StructuralFindingAssessment<StructuralFindingCategory.KnowledgeGraph>;
  readonly proposedSlices: readonly string[];
  readonly risks: readonly string[];
  readonly unresolvedDecisions: readonly string[];
  readonly parentActions: readonly string[];
};

export type SystemCoherenceContinuation = {
  readonly consumedArtifacts: readonly string[];
  readonly coverageGaps: readonly string[];
  readonly crossSurfaceInvariants: readonly string[];
  readonly contradictions: readonly string[];
  readonly acceptedProposals: readonly string[];
  readonly rejectedProposals: readonly string[];
  readonly orderedSlices: readonly string[];
  readonly serializationPoints: readonly string[];
  readonly validationMatrix: readonly string[];
  readonly unresolvedDecisions: readonly string[];
  readonly deliveryOwnerActions: readonly string[];
};

type WorkflowTaskOutputFields = {
  readonly summary: string;
  readonly materializedViewMarkdown: string;
  readonly findings: readonly WorkflowFinding[];
  readonly notesForParent: readonly string[];
  readonly artifacts: readonly WorkflowArtifactReference[];
};

export type StandardWorkflowTaskOutput = WorkflowTaskOutputFields & {
  readonly resultKind: WorkflowResultKind.CortexEvidence;
  readonly continuation?: never;
  readonly moduleExpertAuthorizations?: never;
  readonly structuralExpertAuthorizations?: never;
};

export type ModuleDevelopmentPlanTaskOutput = WorkflowTaskOutputFields & {
  readonly resultKind: WorkflowResultKind.ModuleDevelopmentPlan;
  readonly continuation?: never;
  readonly moduleExpertAuthorizations: readonly ModuleExpertAuthorization[];
  readonly structuralExpertAuthorizations?: never;
};

export type ModuleExpertTaskOutput = WorkflowTaskOutputFields & {
  readonly resultKind: WorkflowResultKind.ModuleExpertEvidence;
  readonly continuation: ModuleExpertContinuation;
  readonly moduleExpertAuthorizations?: never;
  readonly structuralExpertAuthorizations?: never;
};

export type StructuralExpertPlanTaskOutput = WorkflowTaskOutputFields & {
  readonly resultKind: WorkflowResultKind.StructuralExpertPlan;
  readonly continuation?: never;
  readonly moduleExpertAuthorizations?: never;
  readonly structuralExpertAuthorizations: readonly StructuralExpertAuthorization[];
};

export type CodeRefactoringTaskOutput = WorkflowTaskOutputFields & {
  readonly resultKind: WorkflowResultKind.CodeRefactoringEvidence;
  readonly continuation: CodeRefactoringContinuation;
  readonly moduleExpertAuthorizations?: never;
  readonly structuralExpertAuthorizations?: never;
};

export type CortexRefactoringTaskOutput = WorkflowTaskOutputFields & {
  readonly resultKind: WorkflowResultKind.CortexRefactoringEvidence;
  readonly continuation: CortexRefactoringContinuation;
  readonly moduleExpertAuthorizations?: never;
  readonly structuralExpertAuthorizations?: never;
};

export type SystemCoherenceTaskOutput = WorkflowTaskOutputFields & {
  readonly resultKind: WorkflowResultKind.SystemCoherenceSynthesis;
  readonly continuation: SystemCoherenceContinuation;
  readonly moduleExpertAuthorizations?: never;
  readonly structuralExpertAuthorizations?: never;
};

export type StructuralTaskOutput =
  | CodeRefactoringTaskOutput
  | CortexRefactoringTaskOutput
  | StructuralExpertPlanTaskOutput
  | SystemCoherenceTaskOutput;

export type WorkflowTaskOutput =
  | CodeRefactoringTaskOutput
  | CortexRefactoringTaskOutput
  | StandardWorkflowTaskOutput
  | ModuleDevelopmentPlanTaskOutput
  | ModuleExpertTaskOutput
  | StructuralExpertPlanTaskOutput
  | SystemCoherenceTaskOutput;

export type ProjectionReference = {
  readonly path: string;
  readonly sha256: string;
};

export enum MaterializedViewPresence {
  Recorded = 'recorded',
  Unavailable = 'unavailable',
}

export enum MaterializedViewAuthorKind {
  Agent = 'agent',
  LoomRuntime = 'loom-runtime',
}

export type RecordedMaterializedView = {
  readonly presence: MaterializedViewPresence.Recorded;
  readonly authorKind: MaterializedViewAuthorKind;
  readonly projection: ProjectionReference;
  readonly eventHighWaterMark: WorkflowEventSequence;
};

export type UnavailableMaterializedView = {
  readonly presence: MaterializedViewPresence.Unavailable;
  readonly reason: string;
};

export type MaterializedViewReference =
  RecordedMaterializedView | UnavailableMaterializedView;

export enum AgentAttemptParentKind {
  WorkflowRoot = 'workflow-root',
  AgentAttempt = 'agent-attempt',
}

export type WorkflowRootParent = {
  readonly kind: AgentAttemptParentKind.WorkflowRoot;
};

export type ParentAgentAttempt = {
  readonly kind: AgentAttemptParentKind.AgentAttempt;
  readonly task: string;
  readonly agent: string;
  readonly attempt: WorkflowAttemptNumber;
};

export type AgentAttemptParent = WorkflowRootParent | ParentAgentAttempt;

export enum TaskProcessingKind {
  AgentAttempt = 'agent-attempt',
}

export type AgentAttemptProcessingReference = {
  readonly kind: TaskProcessingKind.AgentAttempt;
  readonly events: ProjectionReference;
  readonly result: ProjectionReference;
  readonly view: MaterializedViewReference;
};

export type TaskProcessingReference = AgentAttemptProcessingReference;

export type CompletedTaskTerminal<TTask extends string> = {
  readonly kind: TaskTerminalKind.Completed;
  readonly task: TTask;
  readonly attempt: WorkflowAttemptNumber;
  readonly threadId: string;
  readonly output: WorkflowTaskOutput;
};

export type FailedTaskTerminal<TTask extends string> = {
  readonly kind: TaskTerminalKind.Failed;
  readonly task: TTask;
  readonly attempt: WorkflowAttemptNumber;
  readonly summary: string;
};

export type BlockedTaskTerminal<TTask extends string> = {
  readonly kind: TaskTerminalKind.Blocked;
  readonly task: TTask;
  readonly attempt: WorkflowAttemptNumber;
  readonly summary: string;
};

export type CancelledTaskTerminal<TTask extends string> = {
  readonly kind: TaskTerminalKind.Cancelled;
  readonly task: TTask;
  readonly attempt: WorkflowAttemptNumber;
  readonly summary: string;
};

export type TimedOutTaskTerminal<TTask extends string> = {
  readonly kind: TaskTerminalKind.TimedOut;
  readonly task: TTask;
  readonly attempt: WorkflowAttemptNumber;
  readonly summary: string;
};

export type SkippedTaskTerminal<TTask extends string> = {
  readonly kind: TaskTerminalKind.Skipped;
  readonly task: TTask;
  readonly attempt: WorkflowAttemptNumber;
  readonly summary: string;
};

export type TaskTerminal<TTask extends string> =
  | CompletedTaskTerminal<TTask>
  | FailedTaskTerminal<TTask>
  | BlockedTaskTerminal<TTask>
  | CancelledTaskTerminal<TTask>
  | TimedOutTaskTerminal<TTask>
  | SkippedTaskTerminal<TTask>;
