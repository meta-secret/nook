import { createHash } from 'node:crypto';
import {
  appendFile,
  mkdir,
  readFile,
  rename,
  writeFile,
} from 'node:fs/promises';
import { dirname, join } from 'node:path';
import {
  AgentAttemptAdapterKind,
  AgentAttemptParentKind,
  MaterializedViewAuthorKind,
  MaterializedViewPresence,
  TaskTerminalKind,
  TaskProcessingKind,
  WorkflowResultKind,
} from './domain.ts';
import type {
  AgentAttemptParent,
  AgentAttemptProcessingReference,
  MaterializedViewReference,
  ProjectionReference,
  TaskTerminal,
  WorkflowEventSequence,
} from './domain.ts';
import { AgentAttemptEventKind } from './agent-events.ts';
import type {
  AgentAttemptEvent,
  AgentAttemptEventMetadata,
  AgentAttemptEventWithoutMetadata,
} from './agent-events.ts';
import { WorkflowResultSchema } from './structured-result-codec.ts';
import { MAX_AGENT_HIERARCHY_DEPTH } from './hierarchy.ts';
import { ModuleExpertRuntimeAuthority } from '../module-experts/trusted-runtime.ts';
import { StructuralExpertRuntimeAuthority } from '../structural-experts/trusted-runtime.ts';
import type { StructuralJournalBinding } from '../structural-experts/trusted-runtime.ts';
import { AgentAttemptSchema } from './agent-attempt-version.ts';
import {
  type AssertCortexReferencesArgs,
  CortexIdentifierSyntax,
} from './cortex-references.ts';
import { AgentEventPresentation } from './agent-event-renderer.ts';
import {
  RuntimeActivityObservationField,
  WorkflowRuntimeActivityKind,
} from './events.ts';
import type { RuntimeActivityObservation } from './events.ts';
import type { ModuleExpertJournalBinding } from '../module-experts/trusted-runtime.ts';

const RECURSIVE_DIRECTORY_OPTIONS: { readonly recursive: true } = {
  recursive: true,
};

import type {
  AgentAttemptJournalConfiguration,
  CreateModuleExpertAttemptJournalArgs,
  ConfigurationIdentityMatchArgs,
  FinalizeModuleExpertAttemptArgs,
  CreateStructuralExpertAttemptJournalArgs,
  FinalizeStructuralExpertAttemptArgs,
} from './agent-journal-contract.ts';
export type {
  AgentAttemptJournalAdapter,
  AgentAttemptJournalConfiguration,
  ModuleExpertAttemptJournalConfiguration,
  CreateModuleExpertAttemptJournalArgs,
  FinalizeModuleExpertAttemptArgs,
  StructuralExpertAttemptJournalConfiguration,
  CreateStructuralExpertAttemptJournalArgs,
  FinalizeStructuralExpertAttemptArgs,
} from './agent-journal-contract.ts';

class AgentJournalRecords<TTask extends string> {
  readonly attemptDirectory: string;
  readonly eventsPath: string;
  private readonly configuration: AgentAttemptJournalConfiguration;
  private sequence: WorkflowEventSequence;
  private liveSequence: WorkflowEventSequence;
  private pendingAppend: Promise<void>;
  private phase = JournalPhase.Prepared;
  private readonly moduleExpertJournalBinding:
    ModuleExpertJournalBinding | false;
  private trustedModuleExpertFinalization: boolean;
  private readonly structuralExpertJournalBinding:
    StructuralJournalBinding | false;
  private trustedStructuralExpertFinalization: boolean;

  constructor(configuration: AgentAttemptJournalConfiguration) {
    const pendingBinding =
      AgentJournalRecords.PENDING_MODULE_EXPERT_CONFIGURATIONS.get(
        configuration,
      );
    const pendingStructuralBinding =
      AgentJournalRecords.PENDING_STRUCTURAL_EXPERT_CONFIGURATIONS.get(
        configuration,
      );
    const adapter = configuration.adapter as AgentAttemptAdapterKind;
    if (adapter === AgentAttemptAdapterKind.ModuleExpertInvocation) {
      if (!pendingBinding) {
        throw new Error(
          'Module expert journals require runtime completion authority.',
        );
      }
      AgentJournalRecords.PENDING_MODULE_EXPERT_CONFIGURATIONS.delete(
        configuration,
      );
    } else if (adapter === AgentAttemptAdapterKind.StructuralExpertInvocation) {
      if (!pendingStructuralBinding) {
        throw new Error(
          'Structural expert journals require runtime completion authority.',
        );
      }
      AgentJournalRecords.PENDING_STRUCTURAL_EXPERT_CONFIGURATIONS.delete(
        configuration,
      );
    } else if (!Object.values(AgentAttemptAdapterKind).includes(adapter)) {
      throw new Error('Agent attempt adapter provenance is invalid.');
    }
    const invocationContextSha256 = configuration.invocationContextSha256;
    if (
      adapter === AgentAttemptAdapterKind.ModuleExpertInvocation
        ? !invocationContextSha256 ||
          !/^[0-9a-f]{64}$/u.test(invocationContextSha256)
        : invocationContextSha256
    ) {
      throw new Error('Agent attempt invocation context binding is invalid.');
    }
    AgentAttemptSchema.assertCurrent(configuration.workflowVersion);
    AgentJournalRecords.assertFilesystemIdentifier(configuration.task);
    AgentJournalRecords.assertFilesystemIdentifier(configuration.agent);
    AgentJournalRecords.assertFilesystemIdentifier(configuration.runId);
    AgentJournalRecords.assertFilesystemIdentifier(configuration.workflow);
    if (
      !Number.isSafeInteger(configuration.attempt) ||
      configuration.attempt < 1 ||
      !Number.isSafeInteger(configuration.depth) ||
      configuration.depth < 1 ||
      configuration.depth > MAX_AGENT_HIERARCHY_DEPTH
    ) {
      throw new Error('Agent attempt and hierarchy depth must be bounded.');
    }
    if (
      configuration.workflowVersion.trim() === '' ||
      configuration.workflowVersion.length > 128 ||
      !/^[0-9a-f]{40}$/.test(configuration.sourceCommit)
    ) {
      throw new Error('Agent attempt source identity must be bounded.');
    }
    AgentJournalRecords.assertParentLineage(configuration);
    this.configuration = configuration;
    this.attemptDirectory = join(
      configuration.runDirectory,
      'agents',
      configuration.task,
      `attempt-${configuration.attempt}`,
    );
    this.eventsPath = join(this.attemptDirectory, 'events.jsonl');
    this.sequence = 0;
    this.liveSequence = 0;
    this.pendingAppend = Promise.resolve();
    const [defaulted1 = false] = [pendingBinding];
    this.moduleExpertJournalBinding = defaulted1;
    this.trustedModuleExpertFinalization = false;
    const [defaulted2 = false] = [pendingStructuralBinding];
    this.structuralExpertJournalBinding = defaulted2;
    this.trustedStructuralExpertFinalization = false;
  }

  get eventHighWaterMark(): WorkflowEventSequence {
    return this.sequence;
  }

  async initialize(): Promise<void> {
    this.assertPhase(JournalPhase.Prepared);
    this.phase = JournalPhase.Initializing;
    await mkdir(dirname(this.attemptDirectory), RECURSIVE_DIRECTORY_OPTIONS);
    await mkdir(this.attemptDirectory);
    const invocationContextSha256 = this.configuration.invocationContextSha256;
    const event: AgentAttemptEventWithoutMetadata = invocationContextSha256
      ? {
          kind: AgentAttemptEventKind.AttemptStarted,
          invocationContextSha256,
        }
      : { kind: AgentAttemptEventKind.AttemptStarted };
    await this.appendRecord(event);
    this.phase = JournalPhase.Active;
  }

  async append(
    event: AgentAttemptEventWithoutMetadata,
  ): Promise<AgentAttemptEvent> {
    this.assertPhase(JournalPhase.Active);
    return this.appendRecord(event);
  }

  private async appendRecord(
    event: AgentAttemptEventWithoutMetadata,
  ): Promise<AgentAttemptEvent> {
    if (!AgentJournalRecords.eventHasExactKeys(event)) {
      throw new Error('Agent attempt event fields are invalid.');
    }
    this.sequence += 1;
    const occurredAt = this.configuration.now();
    if (Number.isNaN(Date.parse(occurredAt))) {
      throw new Error('Agent attempt event timestamp is invalid.');
    }
    const metadata: AgentAttemptEventMetadata = {
      adapter: this.configuration.adapter,
      runId: this.configuration.runId,
      workflow: this.configuration.workflow,
      workflowVersion: this.configuration.workflowVersion,
      sourceCommit: this.configuration.sourceCommit,
      task: this.configuration.task,
      agent: this.configuration.agent,
      attempt: this.configuration.attempt,
      depth: this.configuration.depth,
      parent: this.configuration.parent,
      sequence: this.sequence,
      actionId: AgentEventPresentation.cortexActionId(this.sequence),
      occurredAt,
    };
    const completeEvent = { ...metadata, ...event } as AgentAttemptEvent;
    const serialized = `${JSON.stringify(completeEvent)}\n`;
    const appendOperation = this.pendingAppend.then(async () => {
      await appendFile(this.eventsPath, serialized, 'utf8');
    });
    this.pendingAppend = appendOperation;
    await appendOperation;
    const [
      compactOutput = (line: string): void => {
        process.stderr.write(line);
      },
    ] = [this.configuration.compactOutput];
    try {
      await compactOutput(
        AgentEventPresentation.renderAgentAttemptEvent(completeEvent),
      );
    } catch {
      // Compact human evidence is optional and cannot gate the journal.
    }
    return completeEvent;
  }

  async observe(observation: RuntimeActivityObservation): Promise<void> {
    this.assertPhase(JournalPhase.Active);
    const observationKeys = Object.keys(observation);
    if (
      observationKeys.length < 2 ||
      observationKeys.length > 3 ||
      !observationKeys.every((key) =>
        Object.values(RuntimeActivityObservationField).some(
          (field) => field === key,
        ),
      ) ||
      typeof observation.detail !== 'string' ||
      observation.detail.length > 4096
    ) {
      throw new Error('Agent runtime activity fields are invalid.');
    }
    if (
      !Object.values(WorkflowRuntimeActivityKind).includes(observation.activity)
    ) {
      throw new Error('Agent runtime activity is invalid.');
    }
    const [references = []] = [observation.cortexReferences];
    if (references.length > 0 && !this.configuration.knownCortexIdentifiers) {
      throw new Error(
        'Agent runtime activity Cortex references require a source-bound registry.',
      );
    }
    const [defaulted3 = false] = [this.configuration.knownCortexIdentifiers];
    const referenceArgs: AssertCortexReferencesArgs = {
      references,
      knownIdentifiers: defaulted3,
    };
    CortexIdentifierSyntax.assertCortexReferences(referenceArgs);
    this.liveSequence += 1;
    const [
      compactOutput = (line: string): void => {
        process.stderr.write(line);
      },
    ] = [this.configuration.compactOutput];
    try {
      await compactOutput(
        AgentEventPresentation.renderRuntimeActivityObservation({
          identity: {
            task: this.configuration.task,
            attempt: this.configuration.attempt,
            sequence: this.liveSequence,
          },
          observation,
        }),
      );
    } catch {
      // Live human evidence is optional and cannot gate the journal.
    }
  }

  async finalize(
    terminal: TaskTerminal<TTask>,
  ): Promise<AgentAttemptProcessingReference> {
    this.assertPhase(JournalPhase.Active);
    this.assertTerminal(terminal);
    this.phase = JournalPhase.Finalizing;
    // Accepted appends drain before projections; new aliases can no longer append.
    await this.pendingAppend;
    const jsonProjection: JsonProjectionInput<TTask> = {
      filename: 'result.json',
      value: terminal,
    };
    const result = await this.projectJson(jsonProjection);
    const resultEvent: AgentAttemptEventWithoutMetadata = {
      kind: AgentAttemptEventKind.ResultProjected,
      result,
    };
    await this.appendRecord(resultEvent);
    const view = await this.projectView(terminal);
    if (view.presence === MaterializedViewPresence.Recorded) {
      const viewEvent: AgentAttemptEventWithoutMetadata = {
        kind: AgentAttemptEventKind.ViewProjected,
        view,
      };
      await this.appendRecord(viewEvent);
    }
    const terminalEvent: AgentAttemptEventWithoutMetadata = {
      kind: AgentAttemptEventKind.AttemptTerminalRecorded,
      terminalKind: terminal.kind,
      result,
      view,
    };
    await this.appendRecord(terminalEvent);
    await this.pendingAppend;
    const eventsSerialized = await readFile(this.eventsPath, 'utf8');
    const events: ProjectionReference = {
      path: this.relativePath('events.jsonl'),
      sha256: AgentJournalRecords.sha256(eventsSerialized),
    };
    this.phase = JournalPhase.Completed;
    return { kind: TaskProcessingKind.AgentAttempt, events, result, view };
  }

  async finalizeModuleExpert(
    args: FinalizeModuleExpertAttemptArgs<TTask>,
  ): Promise<AgentAttemptProcessingReference> {
    this.assertPhase(JournalPhase.Active);
    if (!this.moduleExpertJournalBinding) {
      throw new Error('Module expert journal binding is missing.');
    }
    const terminal = args.terminal;
    if (terminal.kind !== TaskTerminalKind.Completed) {
      throw new Error('Module expert completion terminal is invalid.');
    }
    const terminalCompletion = {
      threadId: terminal.threadId,
      output: terminal.output,
    };
    const consumeArgs = {
      binding: this.moduleExpertJournalBinding,
      execution: args.execution,
      terminalCompletion,
    };
    ModuleExpertRuntimeAuthority.consumeModuleExpertCompletionAuthority(
      consumeArgs,
    );
    this.trustedModuleExpertFinalization = true;
    try {
      return await this.finalize(terminal);
    } finally {
      this.trustedModuleExpertFinalization = false;
    }
  }

  async finalizeStructuralExpert(
    args: FinalizeStructuralExpertAttemptArgs<TTask>,
  ): Promise<AgentAttemptProcessingReference> {
    this.assertPhase(JournalPhase.Active);
    if (!this.structuralExpertJournalBinding) {
      throw new Error('Structural expert journal binding is missing.');
    }
    const terminal = args.terminal;
    if (terminal.kind !== TaskTerminalKind.Completed) {
      throw new Error('Structural expert completion terminal is invalid.');
    }
    const terminalCompletion = {
      threadId: terminal.threadId,
      output: terminal.output,
    };
    const consumeRequest = {
      binding: this.structuralExpertJournalBinding,
      execution: args.execution,
      terminalCompletion,
    };
    StructuralExpertRuntimeAuthority.consumeStructuralCompletionAuthority(
      consumeRequest,
    );
    this.trustedStructuralExpertFinalization = true;
    try {
      return await this.finalize(terminal);
    } finally {
      this.trustedStructuralExpertFinalization = false;
    }
  }

  private assertPhase(expected: JournalPhase): void {
    if (this.phase !== expected)
      throw new Error(
        `Agent attempt journal is ${this.phase}; expected ${expected}.`,
      );
  }

  private assertTerminal(terminal: TaskTerminal<TTask>): void {
    if (
      terminal.task !== this.configuration.task ||
      terminal.attempt !== this.configuration.attempt
    ) {
      throw new Error('Agent terminal identity differs from its journal.');
    }
    if (terminal.kind === TaskTerminalKind.Completed) {
      const output = WorkflowResultSchema.decodeWorkflowTaskOutputNode(
        terminal.output,
      );
      const adapter = this.configuration.adapter as AgentAttemptAdapterKind;
      if (
        output.resultKind === WorkflowResultKind.ModuleExpertEvidence &&
        (adapter !== AgentAttemptAdapterKind.ModuleExpertInvocation ||
          !this.trustedModuleExpertFinalization)
      ) {
        throw new Error(
          'Module expert evidence requires the isolated invocation adapter.',
        );
      }
      const structuralEvidence =
        output.resultKind === WorkflowResultKind.CodeRefactoringEvidence ||
        output.resultKind === WorkflowResultKind.CortexRefactoringEvidence ||
        output.resultKind === WorkflowResultKind.SystemCoherenceSynthesis;
      if (
        structuralEvidence &&
        (adapter !== AgentAttemptAdapterKind.StructuralExpertInvocation ||
          !this.trustedStructuralExpertFinalization)
      ) {
        throw new Error(
          'Structural expert evidence requires the isolated invocation adapter.',
        );
      }
      const view = terminal.output?.materializedViewMarkdown;
      if (
        typeof terminal.threadId !== 'string' ||
        terminal.threadId.trim() === '' ||
        typeof view !== 'string' ||
        view.trim() === '' ||
        view.length > 65_536
      ) {
        throw new Error('Completed agent terminal view must be bounded.');
      }
      return;
    }
    if (
      typeof terminal.summary !== 'string' ||
      terminal.summary.trim() === '' ||
      terminal.summary.length > 4096 ||
      AgentJournalRecords.containsForbiddenControl(terminal.summary)
    ) {
      throw new Error('Agent terminal failure summary must be bounded.');
    }
  }

  private async projectView(
    terminal: TaskTerminal<TTask>,
  ): Promise<MaterializedViewReference> {
    if (terminal.kind !== TaskTerminalKind.Completed) {
      const markdown = [
        '# Agent attempt failure view',
        '',
        `Status: ${terminal.kind}`,
        '',
        'This view was produced by Loom because the agent did not complete an authored semantic view.',
        '',
        `Normalized outcome: ${terminal.summary}`,
      ].join('\n');
      const textProjection: TextProjectionInput = {
        filename: 'view.md',
        serialized: `${markdown}\n`,
      };
      const projection = await this.projectText(textProjection);
      return {
        presence: MaterializedViewPresence.Recorded,
        authorKind: MaterializedViewAuthorKind.LoomRuntime,
        projection,
        eventHighWaterMark: this.eventHighWaterMark,
      };
    }
    const serialized = `${terminal.output.materializedViewMarkdown.trim()}\n`;
    const textProjection: TextProjectionInput = {
      filename: 'view.md',
      serialized,
    };
    const projection = await this.projectText(textProjection);
    return {
      presence: MaterializedViewPresence.Recorded,
      authorKind: MaterializedViewAuthorKind.Agent,
      projection,
      eventHighWaterMark: this.eventHighWaterMark,
    };
  }

  private async projectJson(
    input: JsonProjectionInput<TTask>,
  ): Promise<ProjectionReference> {
    const textProjection: TextProjectionInput = {
      filename: input.filename,
      serialized: `${JSON.stringify(input.value)}\n`,
    };
    return this.projectText(textProjection);
  }

  private async projectText(
    input: TextProjectionInput,
  ): Promise<ProjectionReference> {
    const absolutePath = join(this.attemptDirectory, input.filename);
    const operation: AtomicWriteOperation = {
      path: absolutePath,
      serialized: input.serialized,
    };
    await AgentJournalRecords.atomicWrite(operation);
    return {
      path: this.relativePath(input.filename),
      sha256: AgentJournalRecords.sha256(input.serialized),
    };
  }

  private relativePath(filename: string): string {
    return join(
      'agents',
      this.configuration.task,
      `attempt-${this.configuration.attempt}`,
      filename,
    );
  }

  private static readonly PENDING_MODULE_EXPERT_CONFIGURATIONS = new WeakMap<
    AgentAttemptJournalConfiguration,
    ModuleExpertJournalBinding
  >();

  private static readonly PENDING_STRUCTURAL_EXPERT_CONFIGURATIONS =
    new WeakMap<AgentAttemptJournalConfiguration, StructuralJournalBinding>();

  private static eventHasExactKeys(
    event: AgentAttemptEventWithoutMetadata,
  ): boolean {
    const startFields =
      event.kind === AgentAttemptEventKind.AttemptStarted &&
      event.invocationContextSha256
        ? ['kind', 'invocationContextSha256']
        : ['kind'];
    const expectedByKind: Record<AgentAttemptEventKind, ReadonlySet<string>> = {
      [AgentAttemptEventKind.AttemptStarted]: new Set(startFields),
      [AgentAttemptEventKind.ResultProjected]: new Set(['kind', 'result']),
      [AgentAttemptEventKind.ViewProjected]: new Set(['kind', 'view']),
      [AgentAttemptEventKind.AttemptTerminalRecorded]: new Set([
        'kind',
        'terminalKind',
        'result',
        'view',
      ]),
    };
    const expected = expectedByKind[event.kind];
    if (!expected) return false;
    const keys = Object.keys(event);
    return (
      keys.length === expected.size && keys.every((key) => expected.has(key))
    );
  }

  static createModuleExpert<TTask extends string>(
    args: CreateModuleExpertAttemptJournalArgs,
  ): AgentJournalRecords<TTask> {
    const matchArgs: ConfigurationIdentityMatchArgs = {
      configuration: args.configuration,
      identity: args.identity,
    };
    if (!AgentJournalRecords.configurationMatchesIdentity(matchArgs)) {
      throw new Error('Module expert journal identity is invalid.');
    }
    const consumeArgs = {
      authority: args.authority,
      identity: args.identity,
    };
    const binding =
      ModuleExpertRuntimeAuthority.consumeModuleExpertJournalAuthority(
        consumeArgs,
      );
    const parentValue: AgentAttemptParent = { ...args.configuration.parent };
    const parent = Object.freeze(parentValue);
    const configuration: AgentAttemptJournalConfiguration = {
      ...args.configuration,
      parent,
      adapter: AgentAttemptAdapterKind.GenericDelegationRecorder,
    };
    AgentJournalRecords.PENDING_MODULE_EXPERT_CONFIGURATIONS.set(
      configuration,
      binding,
    );
    const adapterSet = Reflect.set(
      configuration,
      'adapter',
      AgentAttemptAdapterKind.ModuleExpertInvocation,
    );
    if (!adapterSet) {
      AgentJournalRecords.PENDING_MODULE_EXPERT_CONFIGURATIONS.delete(
        configuration,
      );
      throw new Error('Module expert journal provenance could not be sealed.');
    }
    return new AgentJournalRecords<TTask>(configuration);
  }

  static createStructuralExpert<TTask extends string>(
    args: CreateStructuralExpertAttemptJournalArgs,
  ): AgentJournalRecords<TTask> {
    const identityMatches =
      args.configuration.runDirectory === args.identity.runDirectory &&
      args.configuration.runId === args.identity.runId &&
      args.configuration.workflow === args.identity.workflow &&
      args.configuration.workflowVersion === args.identity.workflowVersion &&
      args.configuration.sourceCommit === args.identity.sourceCommit &&
      args.configuration.task === args.identity.task &&
      args.configuration.agent === args.identity.agent &&
      args.configuration.attempt === args.identity.attempt &&
      args.configuration.depth === args.identity.depth &&
      JSON.stringify(args.configuration.parent) ===
        JSON.stringify(args.identity.parent);
    if (!identityMatches) {
      throw new Error('Structural expert journal identity is invalid.');
    }
    const consumeRequest = {
      authority: args.authority,
      identity: args.identity,
    };
    const binding =
      StructuralExpertRuntimeAuthority.consumeStructuralJournalAuthority(
        consumeRequest,
      );
    const parentValue: AgentAttemptParent = { ...args.configuration.parent };
    const parent = Object.freeze(parentValue);
    const configuration: AgentAttemptJournalConfiguration = {
      ...args.configuration,
      parent,
      adapter: AgentAttemptAdapterKind.GenericDelegationRecorder,
    };
    AgentJournalRecords.PENDING_STRUCTURAL_EXPERT_CONFIGURATIONS.set(
      configuration,
      binding,
    );
    const adapterSet = Reflect.set(
      configuration,
      'adapter',
      AgentAttemptAdapterKind.StructuralExpertInvocation,
    );
    if (!adapterSet) {
      AgentJournalRecords.PENDING_STRUCTURAL_EXPERT_CONFIGURATIONS.delete(
        configuration,
      );
      throw new Error(
        'Structural expert journal provenance could not be sealed.',
      );
    }
    return new AgentJournalRecords<TTask>(configuration);
  }

  private static async atomicWrite(
    operation: AtomicWriteOperation,
  ): Promise<void> {
    const temporaryPath = `${operation.path}.tmp`;
    await writeFile(temporaryPath, operation.serialized, 'utf8');
    await rename(temporaryPath, operation.path);
  }

  private static sha256(serialized: string): string {
    return createHash('sha256').update(serialized).digest('hex');
  }

  private static configurationMatchesIdentity(
    args: ConfigurationIdentityMatchArgs,
  ): boolean {
    const { configuration, identity } = args;
    return (
      configuration.runDirectory === identity.runDirectory &&
      configuration.workflow === identity.workflow &&
      configuration.workflowVersion === identity.workflowVersion &&
      configuration.runId === identity.runId &&
      configuration.sourceCommit === identity.sourceCommit &&
      configuration.task === identity.task &&
      configuration.agent === identity.agent &&
      configuration.attempt === identity.attempt &&
      configuration.depth === identity.depth &&
      JSON.stringify(configuration.parent) === JSON.stringify(identity.parent)
    );
  }

  private static assertFilesystemIdentifier(identifier: string): void {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(identifier)) {
      throw new Error(`Unsafe agent processing identifier: ${identifier}`);
    }
  }

  private static assertParentLineage(
    configuration: AgentAttemptJournalConfiguration,
  ): void {
    const parent = configuration.parent;
    if (parent.kind === AgentAttemptParentKind.WorkflowRoot) {
      if (configuration.depth !== 1 || Object.keys(parent).length !== 1) {
        throw new Error('Root agent attempt lineage is invalid.');
      }
      return;
    }
    AgentJournalRecords.assertFilesystemIdentifier(parent.task);
    AgentJournalRecords.assertFilesystemIdentifier(parent.agent);
    if (
      configuration.depth < 2 ||
      !Number.isSafeInteger(parent.attempt) ||
      parent.attempt < 1 ||
      (parent.task === configuration.task &&
        parent.agent === configuration.agent &&
        parent.attempt === configuration.attempt)
    ) {
      throw new Error('Parent agent attempt lineage is invalid.');
    }
  }

  private static containsForbiddenControl(value: string): boolean {
    return Array.from(value).some((character) => {
      const code = character.charCodeAt(0);
      return (
        code === 127 || (code < 32 && code !== 9 && code !== 10 && code !== 13)
      );
    });
  }
}

type JsonProjectionInput<TTask extends string> = {
  readonly filename: string;
  readonly value: TaskTerminal<TTask>;
};

type TextProjectionInput = {
  readonly filename: string;
  readonly serialized: string;
};

type AtomicWriteOperation = {
  readonly path: string;
  readonly serialized: string;
};

enum JournalPhase {
  Prepared = 'prepared',
  Initializing = 'initializing',
  Active = 'active',
  Finalizing = 'finalizing',
  Completed = 'completed',
}
const JOURNAL_TRANSITION = Symbol('journal-transition');
type JournalTransition<TTask extends string> = {
  readonly key: typeof JOURNAL_TRANSITION;
  readonly records: AgentJournalRecords<TTask>;
};

/** Prepared storage has no observation, append or completion capability. */
export class AgentAttemptJournal<TTask extends string> {
  private readonly records: AgentJournalRecords<TTask>;
  constructor(configuration: AgentAttemptJournalConfiguration) {
    this.records = new AgentJournalRecords(configuration);
  }
  async initialize(): Promise<ActiveAgentAttemptJournal<TTask>> {
    await this.records.initialize();
    return ActiveAgentAttemptJournal.activate({
      key: JOURNAL_TRANSITION,
      records: this.records,
    });
  }
  static createModuleExpert<TTask extends string>(
    args: CreateModuleExpertAttemptJournalArgs,
  ): PreparedModuleExpertJournal<TTask> {
    return PreparedModuleExpertJournal.prepare({
      key: JOURNAL_TRANSITION,
      records: AgentJournalRecords.createModuleExpert<TTask>(args),
    });
  }
  static createStructuralExpert<TTask extends string>(
    args: CreateStructuralExpertAttemptJournalArgs,
  ): PreparedStructuralExpertJournal<TTask> {
    return PreparedStructuralExpertJournal.prepare({
      key: JOURNAL_TRANSITION,
      records: AgentJournalRecords.createStructuralExpert<TTask>(args),
    });
  }
}

export class ActiveAgentAttemptJournal<TTask extends string> {
  private constructor(private readonly records: AgentJournalRecords<TTask>) {}
  static activate<TTask extends string>(
    request: JournalTransition<TTask>,
  ): ActiveAgentAttemptJournal<TTask> {
    if (request.key !== JOURNAL_TRANSITION)
      throw new Error('Invalid journal transition.');
    return new ActiveAgentAttemptJournal(request.records);
  }
  get attemptDirectory(): string {
    return this.records.attemptDirectory;
  }
  get eventsPath(): string {
    return this.records.eventsPath;
  }
  get eventHighWaterMark(): WorkflowEventSequence {
    return this.records.eventHighWaterMark;
  }
  append(event: AgentAttemptEventWithoutMetadata): Promise<AgentAttemptEvent> {
    return this.records.append(event);
  }
  observe(observation: RuntimeActivityObservation): Promise<void> {
    return this.records.observe(observation);
  }
  finalize(
    terminal: TaskTerminal<TTask>,
  ): Promise<AgentAttemptProcessingReference> {
    return this.records.finalize(terminal);
  }
}

export class PreparedModuleExpertJournal<TTask extends string> {
  private constructor(private readonly records: AgentJournalRecords<TTask>) {}
  static prepare<TTask extends string>(
    request: JournalTransition<TTask>,
  ): PreparedModuleExpertJournal<TTask> {
    if (request.key !== JOURNAL_TRANSITION)
      throw new Error('Invalid journal transition.');
    return new PreparedModuleExpertJournal(request.records);
  }
  async initialize(): Promise<ActiveModuleExpertJournal<TTask>> {
    await this.records.initialize();
    return ActiveModuleExpertJournal.activate({
      key: JOURNAL_TRANSITION,
      records: this.records,
    });
  }
}
export class ActiveModuleExpertJournal<TTask extends string> {
  private constructor(private readonly records: AgentJournalRecords<TTask>) {}
  static activate<TTask extends string>(
    request: JournalTransition<TTask>,
  ): ActiveModuleExpertJournal<TTask> {
    if (request.key !== JOURNAL_TRANSITION)
      throw new Error('Invalid journal transition.');
    return new ActiveModuleExpertJournal(request.records);
  }
  get eventHighWaterMark(): WorkflowEventSequence {
    return this.records.eventHighWaterMark;
  }
  observe(observation: RuntimeActivityObservation): Promise<void> {
    return this.records.observe(observation);
  }
  finalize(
    terminal: Exclude<
      TaskTerminal<TTask>,
      { readonly kind: TaskTerminalKind.Completed }
    >,
  ): Promise<AgentAttemptProcessingReference> {
    return this.records.finalize(terminal);
  }
  finalizeModuleExpert(
    args: FinalizeModuleExpertAttemptArgs<TTask>,
  ): Promise<AgentAttemptProcessingReference> {
    return this.records.finalizeModuleExpert(args);
  }
}

export class PreparedStructuralExpertJournal<TTask extends string> {
  private constructor(private readonly records: AgentJournalRecords<TTask>) {}
  static prepare<TTask extends string>(
    request: JournalTransition<TTask>,
  ): PreparedStructuralExpertJournal<TTask> {
    if (request.key !== JOURNAL_TRANSITION)
      throw new Error('Invalid journal transition.');
    return new PreparedStructuralExpertJournal(request.records);
  }
  async initialize(): Promise<ActiveStructuralExpertJournal<TTask>> {
    await this.records.initialize();
    return ActiveStructuralExpertJournal.activate({
      key: JOURNAL_TRANSITION,
      records: this.records,
    });
  }
}
export class ActiveStructuralExpertJournal<TTask extends string> {
  private constructor(private readonly records: AgentJournalRecords<TTask>) {}
  static activate<TTask extends string>(
    request: JournalTransition<TTask>,
  ): ActiveStructuralExpertJournal<TTask> {
    if (request.key !== JOURNAL_TRANSITION)
      throw new Error('Invalid journal transition.');
    return new ActiveStructuralExpertJournal(request.records);
  }
  get eventHighWaterMark(): WorkflowEventSequence {
    return this.records.eventHighWaterMark;
  }
  observe(observation: RuntimeActivityObservation): Promise<void> {
    return this.records.observe(observation);
  }
  finalize(
    terminal: Exclude<
      TaskTerminal<TTask>,
      { readonly kind: TaskTerminalKind.Completed }
    >,
  ): Promise<AgentAttemptProcessingReference> {
    return this.records.finalize(terminal);
  }
  finalizeStructuralExpert(
    args: FinalizeStructuralExpertAttemptArgs<TTask>,
  ): Promise<AgentAttemptProcessingReference> {
    return this.records.finalizeStructuralExpert(args);
  }
}
