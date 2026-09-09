import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import {
  AgentAttemptEventKind,
  type AgentAttemptEvent,
  type AgentAttemptTerminalRecordedEvent,
} from './agent-events.ts';
import { AgentAttemptReplay } from './agent-replay.ts';
import {
  AgentAttemptAdapterKind,
  DelegatedAgentWorkflowName,
  MaterializedViewAuthorKind,
  MaterializedViewPresence,
  TaskTerminalKind,
  WorkflowResultKind,
  type CompletedTaskTerminal,
  type MaterializedViewReference,
  type ProjectionReference,
  type TaskTerminal,
} from './domain.ts';
import {
  MAX_MATERIALIZED_VIEW_MARKDOWN_LENGTH,
  WorkflowResultSchema,
} from './structured-result-codec.ts';

/** Owns the verified attempt artifacts registry and its capability transitions. */
export class VerifiedAttemptArtifacts {
  private constructor() {}
  private static readonly MAX_PARENT_EVENTS_BYTES = 1_048_576;

  private static readonly MAX_PARENT_RESULT_BYTES = 262_144;

  private static readonly PERSISTED_VIEW_LINE_ENDING_LENGTH = 1;

  private static readonly MAX_UTF8_BYTES_PER_UTF16_CODE_UNIT = 3;

  private static readonly MAX_PARENT_VIEW_CHARACTERS =
    MAX_MATERIALIZED_VIEW_MARKDOWN_LENGTH +
    VerifiedAttemptArtifacts.PERSISTED_VIEW_LINE_ENDING_LENGTH;

  private static readonly MAX_PARENT_VIEW_BYTES =
    MAX_MATERIALIZED_VIEW_MARKDOWN_LENGTH *
      VerifiedAttemptArtifacts.MAX_UTF8_BYTES_PER_UTF16_CODE_UNIT +
    VerifiedAttemptArtifacts.PERSISTED_VIEW_LINE_ENDING_LENGTH;

  private static readonly TASK_TERMINAL_KINDS = new Set<string>(
    Object.values(TaskTerminalKind),
  );

  static async readVerifiedParentAttempt(
    args: ReadParentAttemptArgs,
  ): Promise<VerifiedParentAttempt> {
    const attempt =
      await VerifiedAttemptArtifacts.readVerifiedBarrierAttempt(args);
    if (attempt.terminal.kind !== TaskTerminalKind.Completed) {
      VerifiedAttemptArtifacts.authorizationFailed();
    }
    return {
      firstEvent: attempt.firstEvent,
      result: attempt.result,
      terminal: attempt.terminal,
      view: attempt.view,
    };
  }

  static async readVerifiedBarrierAttempt(
    args: ReadParentAttemptArgs,
  ): Promise<VerifiedBarrierAttempt> {
    const attemptDirectory = join(
      args.runDirectory,
      'agents',
      args.identity.task,
      `attempt-${args.identity.attempt}`,
    );
    let eventsSerialized: string;
    let resultSerialized: string;
    let viewSerialized: string;
    try {
      const eventsRead: ReadVerifiedProjectionArgs = {
        runDirectory: args.runDirectory,
        path: join(attemptDirectory, 'events.jsonl'),
        maxBytes: VerifiedAttemptArtifacts.MAX_PARENT_EVENTS_BYTES,
      };
      const resultRead: ReadVerifiedProjectionArgs = {
        runDirectory: args.runDirectory,
        path: join(attemptDirectory, 'result.json'),
        maxBytes: VerifiedAttemptArtifacts.MAX_PARENT_RESULT_BYTES,
      };
      const viewRead: ReadVerifiedProjectionArgs = {
        runDirectory: args.runDirectory,
        path: join(attemptDirectory, 'view.md'),
        maxBytes: VerifiedAttemptArtifacts.MAX_PARENT_VIEW_BYTES,
      };
      [eventsSerialized, resultSerialized, viewSerialized] = await Promise.all([
        VerifiedAttemptArtifacts.readVerifiedProjection(eventsRead),
        VerifiedAttemptArtifacts.readVerifiedProjection(resultRead),
        VerifiedAttemptArtifacts.readVerifiedProjection(viewRead),
      ]);
    } catch {
      VerifiedAttemptArtifacts.authorizationFailed();
    }
    if (
      viewSerialized.length >
      VerifiedAttemptArtifacts.MAX_PARENT_VIEW_CHARACTERS
    ) {
      VerifiedAttemptArtifacts.authorizationFailed();
    }
    let events: readonly AgentAttemptEvent[];
    let terminal: TaskTerminal<string>;
    try {
      events = eventsSerialized
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line) as AgentAttemptEvent);
      terminal = JSON.parse(resultSerialized) as TaskTerminal<string>;
    } catch {
      VerifiedAttemptArtifacts.authorizationFailed();
    }
    const replayRequest = { events };
    let replayed: ReturnType<typeof AgentAttemptReplay.replay>;
    try {
      replayed = AgentAttemptReplay.replay(replayRequest);
    } catch {
      VerifiedAttemptArtifacts.authorizationFailed();
    }
    const firstEvent = events[0];
    const terminalEvents = events.filter(
      (event) => event.kind === AgentAttemptEventKind.AttemptTerminalRecorded,
    ) as readonly AgentAttemptTerminalRecordedEvent[];
    const terminalEvent = terminalEvents[0];
    if (
      !firstEvent ||
      !terminalEvent ||
      terminalEvents.length !== 1 ||
      !VerifiedAttemptArtifacts.TASK_TERMINAL_KINDS.has(terminal.kind) ||
      replayed.terminalKind !== terminal.kind ||
      terminalEvent.terminalKind !== terminal.kind ||
      firstEvent.runId !== args.runId ||
      firstEvent.workflow !== DelegatedAgentWorkflowName.AgentWork ||
      firstEvent.workflowVersion !== args.workflowVersion ||
      firstEvent.sourceCommit !== args.sourceCommit ||
      firstEvent.task !== args.identity.task ||
      firstEvent.agent !== args.identity.agent ||
      firstEvent.attempt !== args.identity.attempt ||
      firstEvent.depth !== args.identity.depth ||
      !VerifiedAttemptArtifacts.barrierTerminalHasExactKeys(terminal) ||
      terminal.task !== args.identity.task ||
      terminal.attempt !== args.identity.attempt ||
      terminalEvent.result.path !==
        join(
          'agents',
          args.identity.task,
          `attempt-${args.identity.attempt}`,
          'result.json',
        ) ||
      VerifiedAttemptArtifacts.sha256(resultSerialized) !==
        terminalEvent.result.sha256 ||
      terminalEvent.view.presence !== MaterializedViewPresence.Recorded ||
      terminalEvent.view.projection.path !==
        join(
          'agents',
          args.identity.task,
          `attempt-${args.identity.attempt}`,
          'view.md',
        ) ||
      VerifiedAttemptArtifacts.sha256(viewSerialized) !==
        terminalEvent.view.projection.sha256 ||
      JSON.stringify(replayed.view) !== JSON.stringify(terminalEvent.view)
    ) {
      VerifiedAttemptArtifacts.authorizationFailed();
    }
    if (terminal.kind !== TaskTerminalKind.Completed) {
      const expectedView = VerifiedAttemptArtifacts.failedAttemptView(terminal);
      if (
        terminal.summary.trim() === '' ||
        terminal.summary.length > 4096 ||
        viewSerialized !== expectedView ||
        terminalEvent.view.authorKind !== MaterializedViewAuthorKind.LoomRuntime
      ) {
        VerifiedAttemptArtifacts.authorizationFailed();
      }
      return {
        firstEvent,
        result: terminalEvent.result,
        terminal,
        view: terminalEvent.view,
        resultJson: JSON.stringify(terminal),
        viewMarkdown: viewSerialized,
      };
    }
    if (terminal.threadId.trim() === '')
      VerifiedAttemptArtifacts.authorizationFailed();
    let decodedOutput: ReturnType<
      typeof WorkflowResultSchema.decodeWorkflowTaskOutput
    >;
    try {
      decodedOutput = WorkflowResultSchema.decodeWorkflowTaskOutput(
        JSON.stringify(terminal.output),
      );
    } catch {
      VerifiedAttemptArtifacts.authorizationFailed();
    }
    if (
      viewSerialized !== `${decodedOutput.materializedViewMarkdown.trim()}\n` ||
      terminalEvent.view.authorKind !== MaterializedViewAuthorKind.Agent ||
      (decodedOutput.resultKind === WorkflowResultKind.ModuleExpertEvidence &&
        firstEvent.adapter !== AgentAttemptAdapterKind.ModuleExpertInvocation)
    ) {
      VerifiedAttemptArtifacts.authorizationFailed();
    }
    const normalizedTerminal: CompletedTaskTerminal<string> = {
      ...terminal,
      output: decodedOutput,
    };
    return {
      firstEvent,
      result: terminalEvent.result,
      terminal: normalizedTerminal,
      view: terminalEvent.view,
      resultJson: JSON.stringify(normalizedTerminal),
      viewMarkdown: viewSerialized,
    };
  }

  static async readVerifiedProjection(
    args: ReadVerifiedProjectionArgs,
  ): Promise<string> {
    const projectionPath =
      await VerifiedAttemptArtifacts.verifiedParentProjectionPath(args);
    const handle = await open(
      projectionPath,
      constants.O_RDONLY | constants.O_NOFOLLOW,
    );
    try {
      const status = await handle.stat();
      if (!status.isFile()) VerifiedAttemptArtifacts.authorizationFailed();
      const buffer = Buffer.alloc(args.maxBytes + 1);
      let bytesRead = 0;
      while (bytesRead < buffer.length) {
        const read = await handle.read(
          buffer,
          bytesRead,
          buffer.length - bytesRead,
          bytesRead,
        );
        if (read.bytesRead === 0) break;
        bytesRead += read.bytesRead;
      }
      if (bytesRead > args.maxBytes)
        VerifiedAttemptArtifacts.authorizationFailed();
      return buffer.subarray(0, bytesRead).toString('utf8');
    } finally {
      await handle.close();
    }
  }

  private static async verifiedParentProjectionPath(
    args: ReadVerifiedProjectionArgs,
  ): Promise<string> {
    const runDirectory = resolve(args.runDirectory);
    const projectionPath = resolve(args.path);
    const projectionRelativePath = relative(runDirectory, projectionPath);
    if (
      projectionRelativePath === '' ||
      VerifiedAttemptArtifacts.pathEscapesRunDirectory(projectionRelativePath)
    ) {
      VerifiedAttemptArtifacts.authorizationFailed();
    }
    const runDirectoryStatus = await lstat(runDirectory);
    if (
      runDirectoryStatus.isSymbolicLink() ||
      !runDirectoryStatus.isDirectory()
    ) {
      VerifiedAttemptArtifacts.authorizationFailed();
    }
    const pathSegments = projectionRelativePath.split(sep);
    let currentPath = runDirectory;
    for (const [index, segment] of pathSegments.entries()) {
      currentPath = join(currentPath, segment);
      const status = await lstat(currentPath);
      const isProjectionFile = index === pathSegments.length - 1;
      if (
        status.isSymbolicLink() ||
        (isProjectionFile ? !status.isFile() : !status.isDirectory())
      ) {
        VerifiedAttemptArtifacts.authorizationFailed();
      }
    }
    const resolvedRunDirectory = await realpath(runDirectory);
    const resolvedProjectionPath = await realpath(projectionPath);
    const resolvedRelativePath = relative(
      resolvedRunDirectory,
      resolvedProjectionPath,
    );
    if (
      resolvedRelativePath === '' ||
      VerifiedAttemptArtifacts.pathEscapesRunDirectory(resolvedRelativePath)
    ) {
      VerifiedAttemptArtifacts.authorizationFailed();
    }
    return projectionPath;
  }

  private static pathEscapesRunDirectory(relativePath: string): boolean {
    return (
      isAbsolute(relativePath) ||
      relativePath === '..' ||
      relativePath.startsWith(`..${sep}`)
    );
  }

  private static barrierTerminalHasExactKeys(
    terminal: TaskTerminal<string>,
  ): boolean {
    const expected = new Set(
      terminal.kind === TaskTerminalKind.Completed
        ? ['kind', 'task', 'attempt', 'threadId', 'output']
        : ['kind', 'task', 'attempt', 'summary'],
    );
    const keys = Object.keys(terminal);
    return (
      keys.length === expected.size && keys.every((key) => expected.has(key))
    );
  }

  private static failedAttemptView(terminal: NonCompletedTaskTerminal): string {
    return [
      '# Agent attempt failure view',
      '',
      `Status: ${terminal.kind}`,
      '',
      'This view was produced by Loom because the agent did not complete an authored semantic view.',
      '',
      `Normalized outcome: ${terminal.summary}`,
      '',
    ].join('\n');
  }

  private static sha256(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }

  private static authorizationFailed(): never {
    throw new Error('Module expert parent authorization failed.');
  }
}

type NonCompletedTaskTerminal = Exclude<
  TaskTerminal<string>,
  CompletedTaskTerminal<string>
>;

export type ParentAttemptIdentity = {
  readonly task: string;
  readonly agent: string;
  readonly attempt: number;
  readonly depth: number;
};

export type ReadParentAttemptArgs = {
  readonly runDirectory: string;
  readonly runId: string;
  readonly workflowVersion: string;
  readonly sourceCommit: string;
  readonly identity: ParentAttemptIdentity;
};

export type VerifiedParentAttempt = {
  readonly firstEvent: AgentAttemptEvent;
  readonly result: ProjectionReference;
  readonly terminal: CompletedTaskTerminal<string>;
  readonly view: MaterializedViewReference;
};

export type VerifiedBarrierAttempt = {
  readonly firstEvent: AgentAttemptEvent;
  readonly result: ProjectionReference;
  readonly terminal: TaskTerminal<string>;
  readonly view: MaterializedViewReference;
  readonly resultJson: string;
  readonly viewMarkdown: string;
};

export type ReadVerifiedProjectionArgs = {
  readonly runDirectory: string;
  readonly path: string;
  readonly maxBytes: number;
};
