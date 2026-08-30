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
  AgentProcessingWorkflowName,
  GitCommit,
  IsoTimestamp,
  MaterializedViewReference,
  ProjectionReference,
  TaskTerminal,
  WorkflowAttemptNumber,
  WorkflowEventSequence,
  WorkflowRunId,
  WorkflowVersion,
} from './domain.ts';
import { AgentAttemptEventKind } from './agent-events.ts';
import type {
  AgentAttemptEvent,
  AgentAttemptEventMetadata,
  AgentAttemptEventWithoutMetadata,
} from './agent-events.ts';
import { decodeWorkflowTaskOutput } from './structured-result-codec.ts';
import { MAX_AGENT_HIERARCHY_DEPTH } from './hierarchy.ts';
import {
  consumeModuleExpertCompletionAuthority,
  consumeModuleExpertJournalAuthority,
} from '../module-experts/trusted-runtime.ts';
import {
  consumeStructuralCompletionAuthority,
  consumeStructuralJournalAuthority,
} from '../structural-experts/trusted-runtime.ts';
import type {
  StructuralJournalAuthority,
  StructuralJournalBinding,
  StructuralRuntimeIdentity,
  TrustedStructuralExecution,
} from '../structural-experts/trusted-runtime.ts';
import { assertCurrentAgentAttemptWorkflowVersion } from './agent-attempt-version.ts';
import {
  assertCortexReferences,
  type AssertCortexReferencesArgs,
} from './cortex-references.ts';
import {
  cortexActionId,
  renderAgentAttemptEvent,
} from './agent-event-renderer.ts';
import type {
  ModuleExpertJournalAuthority,
  ModuleExpertJournalBinding,
  ModuleExpertRuntimeIdentity,
  TrustedModuleExpertExecution,
} from '../module-experts/trusted-runtime.ts';

const RECURSIVE_DIRECTORY_OPTIONS: { readonly recursive: true } = {
  recursive: true,
};

export type AgentAttemptJournalAdapter =
  AgentAttemptAdapterKind.GenericDelegationRecorder;

export type AgentAttemptJournalConfiguration = {
  readonly adapter: AgentAttemptJournalAdapter;
  readonly runDirectory: string;
  readonly runId: WorkflowRunId;
  readonly workflow: AgentProcessingWorkflowName;
  readonly workflowVersion: WorkflowVersion;
  readonly sourceCommit: GitCommit;
  readonly task: string;
  readonly agent: string;
  readonly attempt: WorkflowAttemptNumber;
  readonly depth: number;
  readonly parent: AgentAttemptParent;
  readonly now: () => IsoTimestamp;
  readonly knownCortexIdentifiers?: ReadonlySet<string>;
  readonly compactOutput?: (line: string) => void | Promise<void>;
};

export type ModuleExpertAttemptJournalConfiguration = Omit<
  AgentAttemptJournalConfiguration,
  'adapter'
>;

export type CreateModuleExpertAttemptJournalArgs = {
  readonly configuration: ModuleExpertAttemptJournalConfiguration;
  readonly authority: ModuleExpertJournalAuthority;
  readonly identity: ModuleExpertRuntimeIdentity;
};

type ConfigurationIdentityMatchArgs = {
  readonly configuration: ModuleExpertAttemptJournalConfiguration;
  readonly identity: ModuleExpertRuntimeIdentity;
};

export type FinalizeModuleExpertAttemptArgs<TTask extends string> = {
  readonly terminal: TaskTerminal<TTask>;
  readonly execution: TrustedModuleExpertExecution;
};

export type StructuralExpertAttemptJournalConfiguration = Omit<
  AgentAttemptJournalConfiguration,
  'adapter'
>;

export type CreateStructuralExpertAttemptJournalArgs = {
  readonly configuration: StructuralExpertAttemptJournalConfiguration;
  readonly authority: StructuralJournalAuthority;
  readonly identity: StructuralRuntimeIdentity;
};

export type FinalizeStructuralExpertAttemptArgs<TTask extends string> = {
  readonly terminal: TaskTerminal<TTask>;
  readonly execution: TrustedStructuralExecution;
};

const PENDING_MODULE_EXPERT_CONFIGURATIONS = new WeakMap<
  AgentAttemptJournalConfiguration,
  ModuleExpertJournalBinding
>();
const PENDING_STRUCTURAL_EXPERT_CONFIGURATIONS = new WeakMap<
  AgentAttemptJournalConfiguration,
  StructuralJournalBinding
>();

export class AgentAttemptJournal<TTask extends string> {
  readonly attemptDirectory: string;
  readonly eventsPath: string;
  private readonly configuration: AgentAttemptJournalConfiguration;
  private sequence: WorkflowEventSequence;
  private pendingAppend: Promise<void>;
  private finalized: boolean;
  private readonly moduleExpertJournalBinding:
    ModuleExpertJournalBinding | false;
  private trustedModuleExpertFinalization: boolean;
  private readonly structuralExpertJournalBinding:
    StructuralJournalBinding | false;
  private trustedStructuralExpertFinalization: boolean;

  constructor(configuration: AgentAttemptJournalConfiguration) {
    const pendingBinding =
      PENDING_MODULE_EXPERT_CONFIGURATIONS.get(configuration);
    const pendingStructuralBinding =
      PENDING_STRUCTURAL_EXPERT_CONFIGURATIONS.get(configuration);
    const adapter = configuration.adapter as AgentAttemptAdapterKind;
    if (adapter === AgentAttemptAdapterKind.ModuleExpertInvocation) {
      if (!pendingBinding) {
        throw new Error(
          'Module expert journals require runtime completion authority.',
        );
      }
      PENDING_MODULE_EXPERT_CONFIGURATIONS.delete(configuration);
    } else if (adapter === AgentAttemptAdapterKind.StructuralExpertInvocation) {
      if (!pendingStructuralBinding) {
        throw new Error(
          'Structural expert journals require runtime completion authority.',
        );
      }
      PENDING_STRUCTURAL_EXPERT_CONFIGURATIONS.delete(configuration);
    } else if (!Object.values(AgentAttemptAdapterKind).includes(adapter)) {
      throw new Error('Agent attempt adapter provenance is invalid.');
    }
    assertCurrentAgentAttemptWorkflowVersion(configuration.workflowVersion);
    assertFilesystemIdentifier(configuration.task);
    assertFilesystemIdentifier(configuration.agent);
    assertFilesystemIdentifier(configuration.runId);
    assertFilesystemIdentifier(configuration.workflow);
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
    assertParentLineage(configuration);
    this.configuration = configuration;
    this.attemptDirectory = join(
      configuration.runDirectory,
      'agents',
      configuration.task,
      `attempt-${configuration.attempt}`,
    );
    this.eventsPath = join(this.attemptDirectory, 'events.jsonl');
    this.sequence = 0;
    this.pendingAppend = Promise.resolve();
    this.finalized = false;
    this.moduleExpertJournalBinding = pendingBinding ?? false;
    this.trustedModuleExpertFinalization = false;
    this.structuralExpertJournalBinding = pendingStructuralBinding ?? false;
    this.trustedStructuralExpertFinalization = false;
  }

  get eventHighWaterMark(): WorkflowEventSequence {
    return this.sequence;
  }

  async initialize(): Promise<void> {
    await mkdir(dirname(this.attemptDirectory), RECURSIVE_DIRECTORY_OPTIONS);
    await mkdir(this.attemptDirectory);
    const event: AgentAttemptEventWithoutMetadata = {
      kind: AgentAttemptEventKind.AttemptStarted,
    };
    await this.append(event);
  }

  async append(
    event: AgentAttemptEventWithoutMetadata,
  ): Promise<AgentAttemptEvent> {
    if (this.finalized) {
      throw new Error('Cannot append to a finalized agent attempt journal.');
    }
    if (!eventHasExactKeys(event)) {
      throw new Error('Agent attempt event fields are invalid.');
    }
    if (
      event.kind === AgentAttemptEventKind.RuntimeActivity &&
      (event.detail.length > 1024 || containsForbiddenControl(event.detail))
    ) {
      throw new Error('Agent runtime activity detail must be bounded.');
    }
    if (event.kind === AgentAttemptEventKind.RuntimeActivity) {
      if (
        event.cortexReferences.length > 0 &&
        !this.configuration.knownCortexIdentifiers
      ) {
        throw new Error(
          'Agent runtime activity Cortex references require a source-bound registry.',
        );
      }
      const referenceArgs: AssertCortexReferencesArgs = {
        references: event.cortexReferences,
        knownIdentifiers: this.configuration.knownCortexIdentifiers ?? false,
      };
      assertCortexReferences(referenceArgs);
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
      actionId: cortexActionId(this.sequence),
      occurredAt,
    };
    const completeEvent = { ...metadata, ...event } as AgentAttemptEvent;
    const serialized = `${JSON.stringify(completeEvent)}\n`;
    const appendOperation = this.pendingAppend.then(async () => {
      await appendFile(this.eventsPath, serialized, 'utf8');
    });
    this.pendingAppend = appendOperation;
    await appendOperation;
    const compactOutput =
      this.configuration.compactOutput ??
      ((line: string): void => {
        process.stderr.write(line);
      });
    try {
      await compactOutput(renderAgentAttemptEvent(completeEvent));
    } catch {
      // Compact human evidence is optional and cannot gate the journal.
    }
    return completeEvent;
  }

  async finalize(
    terminal: TaskTerminal<TTask>,
  ): Promise<AgentAttemptProcessingReference> {
    this.assertTerminal(terminal);
    const jsonProjection: JsonProjectionInput<TTask> = {
      filename: 'result.json',
      value: terminal,
    };
    const result = await this.projectJson(jsonProjection);
    const resultEvent: AgentAttemptEventWithoutMetadata = {
      kind: AgentAttemptEventKind.ResultProjected,
      result,
    };
    await this.append(resultEvent);
    const view = await this.projectView(terminal);
    if (view.presence === MaterializedViewPresence.Recorded) {
      const viewEvent: AgentAttemptEventWithoutMetadata = {
        kind: AgentAttemptEventKind.ViewProjected,
        view,
      };
      await this.append(viewEvent);
    }
    const terminalEvent: AgentAttemptEventWithoutMetadata = {
      kind: AgentAttemptEventKind.AttemptTerminalRecorded,
      terminalKind: terminal.kind,
      result,
      view,
    };
    await this.append(terminalEvent);
    this.finalized = true;
    await this.pendingAppend;
    const eventsSerialized = await readFile(this.eventsPath, 'utf8');
    const events: ProjectionReference = {
      path: this.relativePath('events.jsonl'),
      sha256: sha256(eventsSerialized),
    };
    return { kind: TaskProcessingKind.AgentAttempt, events, result, view };
  }

  async finalizeModuleExpert(
    args: FinalizeModuleExpertAttemptArgs<TTask>,
  ): Promise<AgentAttemptProcessingReference> {
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
    consumeModuleExpertCompletionAuthority(consumeArgs);
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
    consumeStructuralCompletionAuthority(consumeRequest);
    this.trustedStructuralExpertFinalization = true;
    try {
      return await this.finalize(terminal);
    } finally {
      this.trustedStructuralExpertFinalization = false;
    }
  }

  private assertTerminal(terminal: TaskTerminal<TTask>): void {
    if (
      terminal.task !== this.configuration.task ||
      terminal.attempt !== this.configuration.attempt
    ) {
      throw new Error('Agent terminal identity differs from its journal.');
    }
    if (terminal.kind === TaskTerminalKind.Completed) {
      const output = decodeWorkflowTaskOutput(JSON.stringify(terminal.output));
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
      containsForbiddenControl(terminal.summary)
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
    await atomicWrite(operation);
    return {
      path: this.relativePath(input.filename),
      sha256: sha256(input.serialized),
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
}

function eventHasExactKeys(event: AgentAttemptEventWithoutMetadata): boolean {
  const expectedByKind: Record<AgentAttemptEventKind, ReadonlySet<string>> = {
    [AgentAttemptEventKind.AttemptStarted]: new Set(['kind']),
    [AgentAttemptEventKind.RuntimeActivity]: new Set([
      'kind',
      'activity',
      'detail',
      'cortexReferences',
    ]),
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

export function createModuleExpertAttemptJournal<TTask extends string>(
  args: CreateModuleExpertAttemptJournalArgs,
): AgentAttemptJournal<TTask> {
  const matchArgs: ConfigurationIdentityMatchArgs = {
    configuration: args.configuration,
    identity: args.identity,
  };
  if (!configurationMatchesIdentity(matchArgs)) {
    throw new Error('Module expert journal identity is invalid.');
  }
  const consumeArgs = {
    authority: args.authority,
    identity: args.identity,
  };
  const binding = consumeModuleExpertJournalAuthority(consumeArgs);
  const parentValue: AgentAttemptParent = { ...args.configuration.parent };
  const parent = Object.freeze(parentValue);
  const configuration: AgentAttemptJournalConfiguration = {
    ...args.configuration,
    parent,
    adapter: AgentAttemptAdapterKind.GenericDelegationRecorder,
  };
  PENDING_MODULE_EXPERT_CONFIGURATIONS.set(configuration, binding);
  const adapterSet = Reflect.set(
    configuration,
    'adapter',
    AgentAttemptAdapterKind.ModuleExpertInvocation,
  );
  if (!adapterSet) {
    PENDING_MODULE_EXPERT_CONFIGURATIONS.delete(configuration);
    throw new Error('Module expert journal provenance could not be sealed.');
  }
  return new AgentAttemptJournal<TTask>(configuration);
}

export function createStructuralExpertAttemptJournal<TTask extends string>(
  args: CreateStructuralExpertAttemptJournalArgs,
): AgentAttemptJournal<TTask> {
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
  const binding = consumeStructuralJournalAuthority(consumeRequest);
  const parentValue: AgentAttemptParent = { ...args.configuration.parent };
  const parent = Object.freeze(parentValue);
  const configuration: AgentAttemptJournalConfiguration = {
    ...args.configuration,
    parent,
    adapter: AgentAttemptAdapterKind.GenericDelegationRecorder,
  };
  PENDING_STRUCTURAL_EXPERT_CONFIGURATIONS.set(configuration, binding);
  const adapterSet = Reflect.set(
    configuration,
    'adapter',
    AgentAttemptAdapterKind.StructuralExpertInvocation,
  );
  if (!adapterSet) {
    PENDING_STRUCTURAL_EXPERT_CONFIGURATIONS.delete(configuration);
    throw new Error(
      'Structural expert journal provenance could not be sealed.',
    );
  }
  return new AgentAttemptJournal<TTask>(configuration);
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

async function atomicWrite(operation: AtomicWriteOperation): Promise<void> {
  const temporaryPath = `${operation.path}.tmp`;
  await writeFile(temporaryPath, operation.serialized, 'utf8');
  await rename(temporaryPath, operation.path);
}

function sha256(serialized: string): string {
  return createHash('sha256').update(serialized).digest('hex');
}

function configurationMatchesIdentity(
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

function assertFilesystemIdentifier(identifier: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(identifier)) {
    throw new Error(`Unsafe agent processing identifier: ${identifier}`);
  }
}

function assertParentLineage(
  configuration: AgentAttemptJournalConfiguration,
): void {
  const parent = configuration.parent;
  if (parent.kind === AgentAttemptParentKind.WorkflowRoot) {
    if (configuration.depth !== 1 || Object.keys(parent).length !== 1) {
      throw new Error('Root agent attempt lineage is invalid.');
    }
    return;
  }
  assertFilesystemIdentifier(parent.task);
  assertFilesystemIdentifier(parent.agent);
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

function containsForbiddenControl(value: string): boolean {
  return Array.from(value).some((character) => {
    const code = character.charCodeAt(0);
    return (
      code === 127 || (code < 32 && code !== 9 && code !== 10 && code !== 13)
    );
  });
}
