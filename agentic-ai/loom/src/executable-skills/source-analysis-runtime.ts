import { fileURLToPath } from 'node:url';
import {
  ExecutableSkillSourceAnalysisResultKind,
  type ExecutableSkillSourceAnalysis,
} from './source-policy.ts';

export type RunExecutableSkillSourceAnalysisRequest = {
  readonly deadlineExpiresAt: number;
  readonly relativePath: string;
  readonly signal: AbortSignal | false;
  readonly source: string;
};

type SourceAnalysisTransport =
  | {
      readonly kind: ExecutableSkillSourceAnalysisResultKind.Completed;
      readonly moduleSpecifiers: readonly string[];
    }
  | {
      readonly kind: ExecutableSkillSourceAnalysisResultKind.Failed;
      readonly message: string;
    };

type SourceAnalysisRequestTransport = {
  readonly relativePath: string;
  readonly source: string;
};

type SourceAnalysisInterruption = {
  readonly dispose: () => void;
  readonly promise: Promise<SourceAnalysisControlOutcome.Interrupted>;
};

enum SourceAnalysisControlOutcome {
  Interrupted = 'interrupted',
  Written = 'written',
}

type SourceAnalysisInputOutcome = SourceAnalysisControlOutcome.Written | Error;

type ReadSourceAnalysisStreamRequest = {
  readonly maximumBytes: number;
  readonly stream: ReadableStream<Uint8Array>;
};

const SOURCE_ANALYSIS_WORKER = fileURLToPath(
  new URL('./source-analysis-worker.ts', import.meta.url),
);
const MAXIMUM_SOURCE_ANALYSIS_INPUT_BYTES = 6 * 8 * 1024 * 1024 + 4096;
const MAXIMUM_SOURCE_ANALYSIS_OUTPUT_BYTES = 256 * 1024;

export async function runExecutableSkillSourceAnalysis(
  request: RunExecutableSkillSourceAnalysisRequest,
): Promise<ExecutableSkillSourceAnalysis> {
  assertSourceAnalysisActive(request);
  const transport: SourceAnalysisRequestTransport = {
    relativePath: request.relativePath,
    source: request.source,
  };
  const payload = JSON.stringify(transport);
  if (
    Buffer.byteLength(payload, 'utf8') > MAXIMUM_SOURCE_ANALYSIS_INPUT_BYTES
  ) {
    throw new Error(
      'Executable skill source analysis input exceeds its bound.',
    );
  }
  const options = {
    env: { PATH: '/usr/local/bin:/usr/bin:/bin:/opt/homebrew/bin' },
    stdin: 'pipe',
    stdout: 'pipe',
    stderr: 'pipe',
  } as const;
  const subprocess = Bun.spawn(
    [process.execPath, SOURCE_ANALYSIS_WORKER],
    options,
  );
  const outputRequest: ReadSourceAnalysisStreamRequest = {
    maximumBytes: MAXIMUM_SOURCE_ANALYSIS_OUTPUT_BYTES,
    stream: subprocess.stdout,
  };
  const errorRequest: ReadSourceAnalysisStreamRequest = {
    maximumBytes: 32 * 1024,
    stream: subprocess.stderr,
  };
  const output = readSourceAnalysisStream(outputRequest);
  const errors = readSourceAnalysisStream(errorRequest);
  const interruption = waitForSourceAnalysisInterruption(request);
  try {
    subprocess.stdin.write(payload);
    const input = Promise.resolve(subprocess.stdin.end());
    const inputOutcome: Promise<SourceAnalysisInputOutcome> = input.then(
      () => SourceAnalysisControlOutcome.Written,
      (error) =>
        error instanceof Error
          ? error
          : new Error('Executable skill source analysis input failed.'),
    );
    const firstInput = await Promise.race([inputOutcome, interruption.promise]);
    if (
      firstInput instanceof Error ||
      firstInput === SourceAnalysisControlOutcome.Interrupted
    ) {
      subprocess.kill(9);
      await subprocess.exited;
      await Promise.allSettled([input, output, errors]);
      if (firstInput instanceof Error) throw firstInput;
      assertSourceAnalysisActive(request);
      throw new Error('Executable skill source analysis was interrupted.');
    }
    const completion = subprocess.exited.then((exitCode) => ({ exitCode }));
    const streamFailure = Promise.race([
      waitForSourceAnalysisStreamFailure(output),
      waitForSourceAnalysisStreamFailure(errors),
    ]);
    const first = await Promise.race([
      completion,
      interruption.promise,
      streamFailure,
    ]);
    if (
      first instanceof Error ||
      first === SourceAnalysisControlOutcome.Interrupted
    ) {
      subprocess.kill(9);
      await subprocess.exited;
      await Promise.allSettled([output, errors]);
      if (first instanceof Error) throw first;
      assertSourceAnalysisActive(request);
      throw new Error('Executable skill source analysis was interrupted.');
    }
    const stdout = await output;
    const stderr = await errors;
    assertSourceAnalysisActive(request);
    if (first.exitCode !== 0) {
      throw new Error(stderr || 'Executable skill source analysis failed.');
    }
    return decodeSourceAnalysisResult(stdout);
  } catch (error) {
    assertSourceAnalysisActive(request);
    throw error;
  } finally {
    interruption.dispose();
    if (typeof subprocess.exitCode !== 'number') subprocess.kill(9);
    await subprocess.exited;
  }
}

function decodeSourceAnalysisResult(
  serialized: string,
): ExecutableSkillSourceAnalysis {
  const result = JSON.parse(serialized) as SourceAnalysisTransport;
  if (!result || typeof result.kind !== 'string') {
    throw new Error('Executable skill source analysis result is invalid.');
  }
  if (result.kind === ExecutableSkillSourceAnalysisResultKind.Failed) {
    if (
      Object.keys(result).length !== 2 ||
      typeof result.message !== 'string' ||
      result.message.length === 0 ||
      result.message.length > 4096
    ) {
      throw new Error('Executable skill source analysis failure is invalid.');
    }
    throw new Error(result.message);
  }
  if (
    result.kind !== ExecutableSkillSourceAnalysisResultKind.Completed ||
    Object.keys(result).length !== 2 ||
    !Array.isArray(result.moduleSpecifiers) ||
    result.moduleSpecifiers.length > 257 ||
    result.moduleSpecifiers.some(
      (specifier) => typeof specifier !== 'string' || specifier.length > 4096,
    )
  ) {
    throw new Error('Executable skill source analysis result is invalid.');
  }
  return { moduleSpecifiers: Object.freeze([...result.moduleSpecifiers]) };
}

function assertSourceAnalysisActive(
  request: RunExecutableSkillSourceAnalysisRequest,
): void {
  if (request.signal !== false && request.signal.aborted) {
    throw new Error('Executable skill lifecycle was cancelled.');
  }
  if (Date.now() >= request.deadlineExpiresAt) {
    throw new Error('Executable skill source analysis deadline expired.');
  }
}

function waitForSourceAnalysisInterruption(
  request: RunExecutableSkillSourceAnalysisRequest,
): SourceAnalysisInterruption {
  let listener: (() => void) | false = false;
  let timer: ReturnType<typeof setTimeout> | false = false;
  const promise = new Promise<SourceAnalysisControlOutcome.Interrupted>(
    (resolve) => {
      timer = setTimeout(
        resolve,
        Math.max(0, request.deadlineExpiresAt - Date.now()),
        SourceAnalysisControlOutcome.Interrupted,
      );
      if (request.signal !== false) {
        if (request.signal.aborted) {
          resolve(SourceAnalysisControlOutcome.Interrupted);
          return;
        }
        listener = () => resolve(SourceAnalysisControlOutcome.Interrupted);
        request.signal.addEventListener('abort', listener);
      }
    },
  );
  return {
    promise,
    dispose: () => {
      if (timer !== false) clearTimeout(timer);
      if (request.signal !== false && listener !== false) {
        request.signal.removeEventListener('abort', listener);
      }
    },
  };
}

async function waitForSourceAnalysisStreamFailure(
  stream: Promise<string>,
): Promise<Error> {
  try {
    await stream;
    return await new Promise<Error>(() => false);
  } catch (error) {
    return error instanceof Error
      ? error
      : new Error('Executable skill source analysis stream failed.');
  }
}

async function readSourceAnalysisStream(
  request: ReadSourceAnalysisStreamRequest,
): Promise<string> {
  const reader = request.stream.getReader();
  const decoder = new TextDecoder();
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
          'Executable skill source analysis output exceeds its bound.',
        );
      }
      const options = { stream: true } as const;
      output += decoder.decode(chunk.value, options);
    }
    return output + decoder.decode();
  } finally {
    reader.releaseLock();
  }
}
