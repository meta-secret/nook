#!/usr/bin/env bun
import { parseArgs } from 'node:util';
import { AgentAttemptTransport } from './attempt-codec.ts';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { AgentAttemptJournal } from './agent-journal.ts';
import { VerifiedAttemptArtifacts } from './attempt-verification.ts';
import { DelegationJournalSchema } from './delegation-codec.ts';
import { DelegationRunJournal } from './delegation-run-journal.ts';
import {
  AgentAttemptAdapterKind,
  AgentAttemptParentKind,
  DelegatedAgentWorkflowName,
  TaskTerminalKind,
  WorkflowResultKind,
} from './domain.ts';
import { WorkflowResultSchema } from './structured-result-codec.ts';
import type { AgentAttemptJournalConfiguration } from './agent-journal.ts';
import type { ReadParentAttemptArgs } from './attempt-verification.ts';
import type {
  DelegationAdmissionRequest,
  DelegationAttemptDeclaration,
} from './delegation-domain.ts';
import type {
  AdmitDelegationAttemptInput,
  StartDelegationRunInput,
} from './delegation-run-journal.ts';
import type {
  AgentAttemptParent,
  TaskTerminal,
  WorkflowAttemptNumber,
} from './domain.ts';
import { CURRENT_AGENT_ATTEMPT_WORKFLOW_VERSION } from './agent-attempt-version.ts';
import { DelegationRunFinalization } from './delegation-aggregation.ts';
import type { FinalizeDelegationRunInput } from './delegation-aggregation.ts';
import { DelegationPlanTree } from './delegation-plan-tree.ts';
import {
  UntrustedYamlBoundary,
  type UntrustedYamlMap,
  type UntrustedYamlNode,
} from '../lib/guards.ts';

const HELP = `Loom delegated agent journal

Usage:
  loom-agent-delegation start --plan <plan.json> --working-directory <repo-root>
  loom-agent-delegation admit --request <request.json> --working-directory <repo-root>
  loom-agent-delegation record --request <request.json> --working-directory <repo-root>
  loom-agent-delegation finalize --request <request.json> --working-directory <repo-root>

Start persists one immutable source-bound delegation plan. Admit authorizes one
exactly declared attempt before dispatch. Record requires that admission,
creates the finalized content-addressed lifecycle journal and terminal handoff,
then rereads and verifies its event, result, and semantic view. Runtime progress
is live and is not accepted by this persistence boundary. Finalize verifies the
planned all-terminal hierarchy and materializes its root semantic view.
`;

enum DelegationCommandKind {
  Start = 'start',
  Admit = 'admit',
  Record = 'record',
  Finalize = 'finalize',
}

type DelegationStartCommandLine = {
  readonly kind: DelegationCommandKind.Start;
  readonly planPath: string;
  readonly workingDirectory: string;
};

type DelegationRecordCommandLine = {
  readonly kind: DelegationCommandKind.Record;
  readonly requestPath: string;
  readonly workingDirectory: string;
};

type DelegationAdmitCommandLine = {
  readonly kind: DelegationCommandKind.Admit;
  readonly requestPath: string;
  readonly workingDirectory: string;
};

type DelegationFinalizeCommandLine = {
  readonly kind: DelegationCommandKind.Finalize;
  readonly requestPath: string;
  readonly workingDirectory: string;
};

type DelegationCommandLine =
  | DelegationStartCommandLine
  | DelegationAdmitCommandLine
  | DelegationRecordCommandLine
  | DelegationFinalizeCommandLine;

type DelegationStartResponse = {
  readonly receipt: Awaited<
    ReturnType<typeof DelegationRunJournal.startDelegationRun>
  >;
  readonly rootAdmission: Awaited<
    ReturnType<typeof DelegationRunJournal.admitDelegationAttempt>
  >;
};

type DelegationRecordRequest = {
  readonly runId: string;
  readonly sourceCommit: string;
  readonly task: string;
  readonly agent: string;
  readonly attempt: WorkflowAttemptNumber;
  readonly depth: number;
  readonly parent: AgentAttemptParent;
  readonly terminal: TaskTerminal<string>;
};

enum DelegationRecordRequestField {
  RunId = 'runId',
  SourceCommit = 'sourceCommit',
  Task = 'task',
  Agent = 'agent',
  Attempt = 'attempt',
  Depth = 'depth',
  Parent = 'parent',
  Terminal = 'terminal',
}

const TERMINAL_KINDS = new Set<string>(Object.values(TaskTerminalKind));
const RECORD_REQUEST_KEYS = new Set<string>(
  Object.values(DelegationRecordRequestField),
);

export class DelegationJournalCli {
  private constructor(private readonly request: readonly string[]) {}

  static main(arguments_: readonly string[] = process.argv): Promise<number> {
    return new DelegationJournalCli(arguments_).execute();
  }

  private async execute(): Promise<number> {
    const arguments_ = this.request;
    const commandLine = DelegationJournalCli.parseCommandLine(
      arguments_.slice(2),
    );
    if (!commandLine) {
      console.error(HELP);
      return 2;
    }
    if (commandLine.kind === DelegationCommandKind.Start) {
      return DelegationJournalCli.start(commandLine);
    }
    if (commandLine.kind === DelegationCommandKind.Admit) {
      return DelegationJournalCli.admit(commandLine);
    }
    if (commandLine.kind === DelegationCommandKind.Finalize) {
      return DelegationJournalCli.finalize(commandLine);
    }
    return DelegationJournalCli.record(commandLine);
  }

  private static async start(
    commandLine: DelegationStartCommandLine,
  ): Promise<number> {
    const serialized = await readFile(commandLine.planPath, 'utf8');
    const plan = DelegationJournalSchema.decodeDelegationPlan(serialized);
    const input: StartDelegationRunInput = {
      workingDirectory: commandLine.workingDirectory,
      plan,
    };
    const receipt = await DelegationRunJournal.startDelegationRun(input);
    const root = plan.attempts.find(
      (declaration) =>
        declaration.identity.task === plan.rootMaterializer.task &&
        declaration.identity.agent === plan.rootMaterializer.agent &&
        declaration.identity.attempt === plan.rootMaterializer.attempt,
    );
    if (!root) throw new Error('Delegation root materializer is missing.');
    const rootAdmissionRequestInput: AdmissionRequestForDeclarationInput = {
      runId: plan.runId,
      sourceCommit: plan.sourceCommit,
      declaration: root,
    };
    const admissionInput: AdmitDelegationAttemptInput = {
      workingDirectory: commandLine.workingDirectory,
      runId: plan.runId,
      request: DelegationJournalCli.admissionRequestForDeclaration(
        rootAdmissionRequestInput,
      ),
    };
    const rootAdmission =
      await DelegationRunJournal.admitDelegationAttempt(admissionInput);
    const response: DelegationStartResponse = { receipt, rootAdmission };
    process.stderr.write(DelegationPlanTree.render(plan));
    console.log(JSON.stringify(response));
    return 0;
  }

  private static async admit(
    commandLine: DelegationAdmitCommandLine,
  ): Promise<number> {
    const serialized = await readFile(commandLine.requestPath, 'utf8');
    const request =
      DelegationJournalSchema.decodeDelegationAdmissionRequest(serialized);
    const input: AdmitDelegationAttemptInput = {
      workingDirectory: commandLine.workingDirectory,
      runId: request.runId,
      request,
    };
    const receipt = await DelegationRunJournal.admitDelegationAttempt(input);
    console.log(JSON.stringify(receipt));
    return 0;
  }

  private static async finalize(
    commandLine: DelegationFinalizeCommandLine,
  ): Promise<number> {
    const serialized = await readFile(commandLine.requestPath, 'utf8');
    const request =
      DelegationRunFinalization.decodeDelegationFinalizationRequest(serialized);
    const input: FinalizeDelegationRunInput = {
      workingDirectory: commandLine.workingDirectory,
      request,
    };
    const receipt =
      await DelegationRunFinalization.finalizeDelegationRun(input);
    console.log(JSON.stringify(receipt));
    return 0;
  }

  private static async record(
    commandLine: DelegationRecordCommandLine,
  ): Promise<number> {
    const serialized = await readFile(commandLine.requestPath, 'utf8');
    const request = DelegationJournalCli.decodeRecordRequest(serialized);
    DelegationJournalCli.assertRequest(request);
    const terminal = DelegationJournalCli.normalizedTerminal(request.terminal);
    const runDirectory = resolve(
      commandLine.workingDirectory,
      'workflow',
      'processing',
      DelegatedAgentWorkflowName.AgentWork,
      request.runId,
    );
    const admissionRequest: DelegationAdmissionRequest = {
      runId: request.runId,
      sourceCommit: request.sourceCommit,
      identity: {
        task: request.task,
        agent: request.agent,
        attempt: request.attempt,
      },
      depth: request.depth,
      parent: request.parent,
    };
    const admissionInput: AdmitDelegationAttemptInput = {
      workingDirectory: commandLine.workingDirectory,
      runId: request.runId,
      request: admissionRequest,
    };
    const admission =
      await DelegationRunJournal.requireDelegationAttemptAdmission(
        admissionInput,
      );
    const journalConfiguration: AgentAttemptJournalConfiguration = {
      adapter: AgentAttemptAdapterKind.GenericDelegationRecorder,
      runDirectory,
      runId: request.runId,
      workflow: DelegatedAgentWorkflowName.AgentWork,
      workflowVersion: CURRENT_AGENT_ATTEMPT_WORKFLOW_VERSION,
      sourceCommit: request.sourceCommit,
      task: request.task,
      agent: request.agent,
      attempt: request.attempt,
      depth: request.depth,
      parent: request.parent,
      now: () => new Date().toISOString(),
    };
    const preparedJournal = new AgentAttemptJournal<string>(
      journalConfiguration,
    );
    const journal = await preparedJournal.initialize();
    const processing = await journal.finalize(terminal);
    const verificationRequest: ReadParentAttemptArgs = {
      runDirectory,
      runId: request.runId,
      workflowVersion: CURRENT_AGENT_ATTEMPT_WORKFLOW_VERSION,
      sourceCommit: request.sourceCommit,
      identity: {
        task: request.task,
        agent: request.agent,
        attempt: request.attempt,
        depth: request.depth,
      },
    };
    await VerifiedAttemptArtifacts.readVerifiedBarrierAttempt(
      verificationRequest,
    );
    const response = { runDirectory, admission, processing };
    console.log(JSON.stringify(response));
    return 0;
  }

  private static admissionRequestForDeclaration(
    input: AdmissionRequestForDeclarationInput,
  ): DelegationAdmissionRequest {
    return {
      runId: input.runId,
      sourceCommit: input.sourceCommit,
      identity: input.declaration.identity,
      depth: input.declaration.depth,
      parent: input.declaration.parent,
    };
  }

  private static parseCommandLine(
    argv: readonly string[],
  ): DelegationCommandLine | false {
    let parsed;
    try {
      parsed = parseArgs({
        args: [...argv],
        options: {
          plan: { type: 'string' },
          request: { type: 'string' },
          'working-directory': { type: 'string' },
        },
        allowPositionals: true,
        strict: false,
        tokens: true,
      });
    } catch {
      return false;
    }
    const { values, positionals, tokens } = parsed;
    const [command] = positionals;
    const inputOption =
      command === DelegationCommandKind.Start ? 'plan' : 'request';
    const inputPath = values[inputOption];
    const directory = values['working-directory'];
    if (
      positionals.length !== 1 ||
      tokens.length !== 3 ||
      tokens[0]?.kind !== 'positional' ||
      Array.from(tokens.slice(1).entries()).some((entry) => {
        const [index, token] = entry;
        return (
          token.kind !== 'option' ||
          token.name !== [inputOption, 'working-directory'][index] ||
          token.inlineValue ||
          token.index !== index * 2 + 1
        );
      }) ||
      typeof inputPath !== 'string' ||
      !inputPath ||
      inputPath.startsWith('--') ||
      typeof directory !== 'string' ||
      !directory ||
      directory.startsWith('--')
    )
      return false;
    if (command === DelegationCommandKind.Start)
      return {
        kind: command,
        planPath: resolve(inputPath),
        workingDirectory: resolve(directory),
      };
    if (
      command !== DelegationCommandKind.Admit &&
      command !== DelegationCommandKind.Record &&
      command !== DelegationCommandKind.Finalize
    )
      return false;
    return {
      kind: command,
      requestPath: resolve(inputPath),
      workingDirectory: resolve(directory),
    };
  }

  private static decodeRecordRequest(
    serialized: string,
  ): DelegationRecordRequest {
    const value = UntrustedYamlBoundary.fromJson(JSON.parse(serialized));
    if (
      !DelegationJournalCli.isRecord(value) ||
      Object.keys(value).length !== RECORD_REQUEST_KEYS.size ||
      Object.keys(value).some((key) => !RECORD_REQUEST_KEYS.has(key)) ||
      typeof value.runId !== 'string' ||
      typeof value.sourceCommit !== 'string' ||
      typeof value.task !== 'string' ||
      typeof value.agent !== 'string' ||
      typeof value.attempt !== 'number' ||
      !Number.isSafeInteger(value.attempt) ||
      typeof value.depth !== 'number' ||
      !Number.isSafeInteger(value.depth)
    )
      throw new Error(
        'Delegation journal request identity or terminal is invalid.',
      );
    return {
      runId: value.runId,
      sourceCommit: value.sourceCommit,
      task: value.task,
      agent: value.agent,
      attempt: value.attempt,
      depth: value.depth,
      parent: AgentAttemptTransport.decodeParentField({
        node: value,
        key: 'parent',
      }),
      terminal: AgentAttemptTransport.decodeTerminalField({
        node: value,
        key: 'terminal',
      }),
    };
  }

  private static isRecord(value: UntrustedYamlNode): value is UntrustedYamlMap {
    return typeof value === 'object' && Boolean(value) && !Array.isArray(value);
  }

  private static assertRequest(request: DelegationRecordRequest): void {
    if (
      !request ||
      Object.keys(request).length !== RECORD_REQUEST_KEYS.size ||
      !Object.keys(request).every((key) => RECORD_REQUEST_KEYS.has(key)) ||
      typeof request.runId !== 'string' ||
      !DelegationJournalCli.safeFilesystemIdentifier(request.runId) ||
      !/^[0-9a-f]{40}$/.test(request.sourceCommit) ||
      !request.terminal ||
      !TERMINAL_KINDS.has(request.terminal.kind) ||
      request.terminal.task !== request.task ||
      request.terminal.attempt !== request.attempt
    ) {
      throw new Error(
        'Delegation journal request identity or terminal is invalid.',
      );
    }
    if (!DelegationJournalCli.terminalHasExactKeys(request.terminal)) {
      throw new Error('Delegation journal request terminal is invalid.');
    }
    if (
      (request.terminal.kind === TaskTerminalKind.Completed &&
        (typeof request.terminal.threadId !== 'string' ||
          request.terminal.threadId.trim() === '')) ||
      (request.terminal.kind !== TaskTerminalKind.Completed &&
        (typeof request.terminal.summary !== 'string' ||
          request.terminal.summary.trim() === '' ||
          request.terminal.summary.length > 4096))
    ) {
      throw new Error('Delegation journal request terminal is invalid.');
    }
    if (request.terminal.kind === TaskTerminalKind.Completed) {
      const view = request.terminal.output.materializedViewMarkdown;
      if (view.trim() === '' || view.length > 65_536) {
        throw new Error('Delegated agent materialized view must be bounded.');
      }
    }
    if (
      request.parent.kind !== AgentAttemptParentKind.WorkflowRoot &&
      request.parent.kind !== AgentAttemptParentKind.AgentAttempt
    ) {
      throw new Error('Delegation journal request parent is invalid.');
    }
  }

  private static normalizedTerminal(
    terminal: TaskTerminal<string>,
  ): TaskTerminal<string> {
    if (terminal.kind !== TaskTerminalKind.Completed) {
      return {
        kind: terminal.kind,
        task: terminal.task,
        attempt: terminal.attempt,
        summary: terminal.summary,
      };
    }
    if (
      terminal.output.resultKind === WorkflowResultKind.ModuleExpertEvidence ||
      terminal.output.resultKind ===
        WorkflowResultKind.CodeRefactoringEvidence ||
      terminal.output.resultKind ===
        WorkflowResultKind.CortexRefactoringEvidence ||
      terminal.output.resultKind === WorkflowResultKind.SystemCoherenceSynthesis
    ) {
      throw new Error(
        'Generic delegation cannot record isolated expert evidence.',
      );
    }
    return {
      kind: terminal.kind,
      task: terminal.task,
      attempt: terminal.attempt,
      threadId: terminal.threadId,
      output: WorkflowResultSchema.decodeWorkflowTaskOutputNode(
        terminal.output,
      ),
    };
  }

  private static terminalHasExactKeys(terminal: TaskTerminal<string>): boolean {
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

  private static safeFilesystemIdentifier(value: string): boolean {
    return /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value);
  }
}

type AdmissionRequestForDeclarationInput = {
  readonly runId: string;
  readonly sourceCommit: string;
  readonly declaration: DelegationAttemptDeclaration;
};

if (import.meta.main) {
  process.exit(await DelegationJournalCli.main());
}
