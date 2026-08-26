import { Buffer } from 'node:buffer';
import path from 'node:path';
import {
  runBoundedProcess,
  type RunBoundedProcessRequest,
} from './source-analysis-process.ts';
import type {
  ReadSourceAnalysisSnapshotRequest,
  SourceAnalysisSnapshotInput,
} from './source-analysis-snapshot.ts';
import {
  MAXIMUM_SNAPSHOT_FILE_BYTES,
  MAXIMUM_SNAPSHOT_TOTAL_BYTES,
} from './source-analysis-snapshot.ts';

type SnapshotWorkerRequest = {
  readonly deadlineExpiresAt: number;
  readonly relativePaths: readonly string[];
};

type SnapshotWorkerInputTransport = {
  readonly contentsBase64: string;
  readonly relativePath: string;
};

type SnapshotWorkerResult = {
  readonly inputs: readonly SnapshotWorkerInputTransport[];
};

const MAXIMUM_SNAPSHOT_REQUEST_BYTES = 16 * 1024;
const MAXIMUM_SNAPSHOT_RESULT_BYTES = 6 * 1024 * 1024;
const MAXIMUM_SNAPSHOT_STDERR_BYTES = 64 * 1024;

export async function readBoundedSourceAnalysisSnapshot(
  request: ReadSourceAnalysisSnapshotRequest,
): Promise<readonly SourceAnalysisSnapshotInput[]> {
  const workerRequest: SnapshotWorkerRequest = {
    deadlineExpiresAt: request.deadlineExpiresAt,
    relativePaths: request.relativePaths,
  };
  const serializedRequest = JSON.stringify(workerRequest);
  const workerPath = path.join(
    import.meta.dir,
    'source-analysis-snapshot-worker.ts',
  );
  const processRequest: RunBoundedProcessRequest = {
    command: [process.execPath, 'run', workerPath],
    cwd: request.repoRoot,
    deadlineExpiresAt: request.deadlineExpiresAt,
    maximumStderrBytes: MAXIMUM_SNAPSHOT_STDERR_BYTES,
    maximumStdinBytes: MAXIMUM_SNAPSHOT_REQUEST_BYTES,
    maximumStdoutBytes: MAXIMUM_SNAPSHOT_RESULT_BYTES,
    signal: request.signal,
    stdin: serializedRequest,
  };
  const output = await runBoundedProcess(processRequest);
  if (output.exitCode !== 0) {
    throw new Error('Sealed source analysis image snapshot failed.');
  }
  const decodeRequest: DecodeSnapshotResultRequest = {
    relativePaths: request.relativePaths,
    serialized: output.stdout,
  };
  return decodeSnapshotResult(decodeRequest);
}

type DecodeSnapshotResultRequest = {
  readonly relativePaths: readonly string[];
  readonly serialized: string;
};

function decodeSnapshotResult(
  request: DecodeSnapshotResultRequest,
): readonly SourceAnalysisSnapshotInput[] {
  const result = JSON.parse(request.serialized) as SnapshotWorkerResult;
  if (
    !Array.isArray(result.inputs) ||
    result.inputs.length !== request.relativePaths.length
  ) {
    throw new Error('Sealed source analysis image snapshot result is invalid.');
  }
  const inputs: SourceAnalysisSnapshotInput[] = [];
  let totalBytes = 0;
  for (const [index, transport] of result.inputs.entries()) {
    const expectedPath = request.relativePaths[index];
    if (
      typeof transport?.relativePath !== 'string' ||
      typeof transport.contentsBase64 !== 'string' ||
      transport.relativePath !== expectedPath
    ) {
      throw new Error(
        'Sealed source analysis image snapshot result is invalid.',
      );
    }
    const decoded = Buffer.from(transport.contentsBase64, 'base64');
    if (decoded.toString('base64') !== transport.contentsBase64) {
      throw new Error(
        'Sealed source analysis image snapshot result is invalid.',
      );
    }
    if (
      decoded.byteLength > MAXIMUM_SNAPSHOT_FILE_BYTES ||
      totalBytes + decoded.byteLength > MAXIMUM_SNAPSHOT_TOTAL_BYTES
    ) {
      throw new Error(
        'Sealed source analysis image snapshot result is invalid.',
      );
    }
    totalBytes += decoded.byteLength;
    const input: SourceAnalysisSnapshotInput = {
      contents: Uint8Array.from(decoded),
      relativePath: transport.relativePath,
    };
    inputs.push(input);
  }
  return inputs;
}
