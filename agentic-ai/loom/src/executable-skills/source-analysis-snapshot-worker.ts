import { Buffer } from 'node:buffer';
import {
  readSourceAnalysisSnapshot,
  type ReadSourceAnalysisSnapshotRequest,
  type SourceAnalysisSnapshotInput,
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

async function main(): Promise<void> {
  const serialized = await Bun.stdin.text();
  const request = JSON.parse(serialized) as SnapshotWorkerRequest;
  if (
    !Number.isSafeInteger(request.deadlineExpiresAt) ||
    !Array.isArray(request.relativePaths) ||
    !request.relativePaths.every((entry) => typeof entry === 'string')
  ) {
    throw new Error('Sealed source analysis snapshot request is invalid.');
  }
  const snapshotRequest: ReadSourceAnalysisSnapshotRequest = {
    deadlineExpiresAt: request.deadlineExpiresAt,
    relativePaths: request.relativePaths,
    repoRoot: process.cwd(),
    signal: false,
  };
  const inputs = await readSourceAnalysisSnapshot(snapshotRequest);
  const transports = inputs.map(encodeInput);
  const result: SnapshotWorkerResult = { inputs: transports };
  await Bun.write(Bun.stdout, JSON.stringify(result));
}

function encodeInput(
  input: SourceAnalysisSnapshotInput,
): SnapshotWorkerInputTransport {
  return {
    contentsBase64: Buffer.from(input.contents).toString('base64'),
    relativePath: input.relativePath,
  };
}

await main();
