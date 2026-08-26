export type RunBoundedProcessRequest = {
  readonly command: readonly string[];
  readonly cwd: string;
  readonly deadlineExpiresAt: number;
  readonly maximumStderrBytes: number;
  readonly maximumStdinBytes: number;
  readonly maximumStdoutBytes: number;
  readonly signal: AbortSignal | false;
  readonly stdin: string | false;
};

export type BoundedProcessOutput = {
  readonly exitCode: number;
  readonly stderr: string;
  readonly stdout: string;
};

type ReadBoundedStreamRequest = {
  readonly label: string;
  readonly maximumBytes: number;
  readonly stream: ReadableStream<Uint8Array>;
};

type BoundedStreamDecoderConfiguration = {
  readonly fatal: boolean;
};

type BoundedStreamDecodeConfiguration = {
  readonly stream: boolean;
};

type ProcessInterruption = {
  readonly dispose: () => void;
  readonly promise: Promise<ProcessRaceOutcome>;
};

type WaitForProcessExitRequest = {
  readonly deadlineExpiresAt: number;
  readonly exited: Promise<number>;
};

type KillProcessGroupRequest = {
  readonly pid: number;
};

type BoundedProcessEnvironment = {
  readonly HOME: string;
  readonly PATH: string;
  readonly TMPDIR: string;
};

const PROCESS_TERMINATION_RESERVE_MILLISECONDS = 1_000;
const MAXIMUM_BOUNDED_PROCESS_MILLISECONDS = 5 * 60 * 1_000;

enum ProcessRaceKind {
  Completed = 'completed',
  Interrupted = 'interrupted',
}

type ProcessRaceOutcome =
  | {
      readonly exitCode: number;
      readonly kind: ProcessRaceKind.Completed;
      readonly stderr: string;
      readonly stdout: string;
    }
  | {
      readonly kind: ProcessRaceKind.Interrupted;
    };

export async function runBoundedProcess(
  request: RunBoundedProcessRequest,
): Promise<BoundedProcessOutput> {
  assertBoundedProcessRequest(request);
  const environment: BoundedProcessEnvironment = {
    HOME: '/var/empty',
    PATH: '/usr/bin:/bin',
    TMPDIR: '/tmp',
  };
  const options = {
    cwd: request.cwd,
    detached: true,
    env: environment,
    stdin: 'pipe',
    stdout: 'pipe',
    stderr: 'pipe',
  } as const;
  const command = [...request.command];
  const subprocess = Bun.spawn(command, options);
  const stdoutRequest: ReadBoundedStreamRequest = {
    label: 'stdout',
    maximumBytes: request.maximumStdoutBytes,
    stream: subprocess.stdout,
  };
  const stderrRequest: ReadBoundedStreamRequest = {
    label: 'stderr',
    maximumBytes: request.maximumStderrBytes,
    stream: subprocess.stderr,
  };
  const stdout = readBoundedStream(stdoutRequest);
  const stderr = readBoundedStream(stderrRequest);
  const interruption = createProcessInterruption(request);
  let input: Promise<number> | false = false;
  let streamsSettled = false;
  try {
    if (request.stdin !== false) subprocess.stdin.write(request.stdin);
    input = Promise.resolve(subprocess.stdin.end());
    const completion = Promise.all([
      subprocess.exited,
      input,
      stdout,
      stderr,
    ]).then(([exitCode, , completedStdout, completedStderr]) => {
      const outcome: ProcessRaceOutcome = {
        exitCode,
        kind: ProcessRaceKind.Completed,
        stderr: completedStderr,
        stdout: completedStdout,
      };
      return outcome;
    });
    const raceCandidates: readonly Promise<ProcessRaceOutcome>[] = [
      completion,
      interruption.promise,
    ];
    const outcome = await Promise.race(raceCandidates);
    if (outcome.kind !== ProcessRaceKind.Completed) {
      if (request.signal !== false && request.signal.aborted) {
        throw new Error('Sealed source analysis was aborted.');
      }
      throw new Error('Sealed source analysis deadline expired.');
    }
    streamsSettled = true;
    assertProcessActive(request);
    return {
      exitCode: outcome.exitCode,
      stderr: outcome.stderr,
      stdout: outcome.stdout,
    };
  } finally {
    interruption.dispose();
    const killRequest: KillProcessGroupRequest = { pid: subprocess.pid };
    killProcessGroup(killRequest);
    if (typeof subprocess.exitCode !== 'number') {
      subprocess.kill(9);
    }
    const exitRequest: WaitForProcessExitRequest = {
      deadlineExpiresAt: request.deadlineExpiresAt,
      exited: subprocess.exited,
    };
    await waitForProcessExit(exitRequest);
    if (!streamsSettled) await Promise.allSettled([input, stdout, stderr]);
  }
}

function killProcessGroup(request: KillProcessGroupRequest): void {
  try {
    process.kill(-request.pid, 'SIGKILL');
  } catch {
    // The group may already be gone; the bounded exit wait remains authoritative.
  }
}

function assertBoundedProcessRequest(request: RunBoundedProcessRequest): void {
  assertProcessActive(request);
  const remaining = request.deadlineExpiresAt - Date.now();
  if (
    !Number.isSafeInteger(request.deadlineExpiresAt) ||
    remaining <= PROCESS_TERMINATION_RESERVE_MILLISECONDS ||
    remaining > MAXIMUM_BOUNDED_PROCESS_MILLISECONDS ||
    request.command.length === 0 ||
    !Number.isSafeInteger(request.maximumStdoutBytes) ||
    request.maximumStdoutBytes < 0 ||
    !Number.isSafeInteger(request.maximumStderrBytes) ||
    request.maximumStderrBytes < 0 ||
    !Number.isSafeInteger(request.maximumStdinBytes) ||
    request.maximumStdinBytes < 0 ||
    (request.stdin !== false &&
      new TextEncoder().encode(request.stdin).byteLength >
        request.maximumStdinBytes)
  ) {
    throw new Error('Bounded process request is invalid.');
  }
}

function assertProcessActive(request: RunBoundedProcessRequest): void {
  if (request.signal !== false && request.signal.aborted) {
    throw new Error('Sealed source analysis was aborted.');
  }
  if (Date.now() >= request.deadlineExpiresAt) {
    throw new Error('Sealed source analysis deadline expired.');
  }
}

function createProcessInterruption(
  request: RunBoundedProcessRequest,
): ProcessInterruption {
  let listener: (() => void) | false = false;
  const resolveInterruption = (
    resolve: (outcome: ProcessRaceOutcome) => void,
  ): void => {
    const outcome: ProcessRaceOutcome = {
      kind: ProcessRaceKind.Interrupted,
    };
    resolve(outcome);
  };
  let timer: ReturnType<typeof setTimeout> | false = false;
  const promise = new Promise<ProcessRaceOutcome>((resolve) => {
    const delay = Math.max(
      0,
      request.deadlineExpiresAt -
        PROCESS_TERMINATION_RESERVE_MILLISECONDS -
        Date.now(),
    );
    timer = setTimeout(() => resolveInterruption(resolve), delay);
    if (request.signal !== false) {
      listener = () => resolveInterruption(resolve);
      request.signal.addEventListener('abort', listener);
    }
  });
  return {
    dispose: () => {
      if (timer !== false) clearTimeout(timer);
      if (request.signal !== false && listener !== false) {
        request.signal.removeEventListener('abort', listener);
      }
    },
    promise,
  };
}

async function waitForProcessExit(
  request: WaitForProcessExitRequest,
): Promise<void> {
  const remaining = request.deadlineExpiresAt - Date.now();
  if (remaining <= 0) {
    throw new Error('Bounded process termination was not confirmed.');
  }
  let timer: ReturnType<typeof setTimeout> | false = false;
  const expired = new Promise<false>((resolve) => {
    timer = setTimeout(() => resolve(false), remaining);
  });
  const outcome = await Promise.race([request.exited, expired]);
  if (timer !== false) clearTimeout(timer);
  if (outcome === false) {
    throw new Error('Bounded process termination was not confirmed.');
  }
}

async function readBoundedStream(
  request: ReadBoundedStreamRequest,
): Promise<string> {
  const reader = request.stream.getReader();
  const decoderOptions: BoundedStreamDecoderConfiguration = { fatal: true };
  const decoder = new TextDecoder('utf-8', decoderOptions);
  let bytes = 0;
  let output = '';
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > request.maximumBytes) {
        await reader.cancel();
        throw new Error(
          `Bounded process ${request.label} exceeds its byte limit.`,
        );
      }
      const decodeOptions: BoundedStreamDecodeConfiguration = { stream: true };
      output += decoder.decode(chunk.value, decodeOptions);
    }
    return output + decoder.decode();
  } finally {
    reader.releaseLock();
  }
}
