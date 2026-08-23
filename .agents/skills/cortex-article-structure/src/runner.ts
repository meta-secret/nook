import { auditCortexArticleStructure } from './audit.ts';
import {
  decodeCortexArticleRequest,
  decodeCortexArticleResult,
  encodeCortexArticleResult,
} from './codec.ts';
import {
  CortexArticleContractKind,
  type CortexArticleStructureResult,
} from './domain.ts';

type ValidateCortexArticleOutputRequest = {
  readonly serializedRequest: string;
  readonly serializedResult: string;
};

async function executeCortexArticleStructure(
  serializedRequest: string,
): Promise<string> {
  const request = decodeCortexArticleRequest(serializedRequest);
  const result: CortexArticleStructureResult = {
    kind: CortexArticleContractKind.Result,
    findings: auditCortexArticleStructure(request),
  };
  return encodeCortexArticleResult(result);
}

async function validateCortexArticleStructure(
  request: ValidateCortexArticleOutputRequest,
): Promise<void> {
  const decodedRequest = decodeCortexArticleRequest(request.serializedRequest);
  const decodedResult = decodeCortexArticleResult(request.serializedResult);
  const maximumLines = new Map(
    decodedRequest.documents.map((document) => [
      document.relativePath,
      lineCount(document.content),
    ]),
  );
  if (decodedRequest.migrationLedger.content !== false) {
    maximumLines.set(
      decodedRequest.migrationLedger.relativePath,
      lineCount(decodedRequest.migrationLedger.content),
    );
  }
  const findingIdentities = new Set<string>();
  for (const finding of decodedResult.findings) {
    const availableLines = maximumLines.get(finding.file);
    const identity = JSON.stringify(finding);
    if (
      typeof availableLines !== 'number' ||
      finding.line > availableLines ||
      findingIdentities.has(identity)
    ) {
      throw new Error('Cortex article-structure result validation failed.');
    }
    findingIdentities.add(identity);
  }
}

function lineCount(content: string): number {
  return content.split(/\r?\n/u).length;
}

export async function runCortexArticleStructureSkill(
  serializedRequest: string,
): Promise<string> {
  const serializedResult =
    await executeCortexArticleStructure(serializedRequest);
  const validationRequest: ValidateCortexArticleOutputRequest = {
    serializedRequest,
    serializedResult,
  };
  await validateCortexArticleStructure(validationRequest);
  return serializedResult;
}

if (import.meta.main) {
  const serializedRequest = await Bun.stdin.text();
  const serializedResult =
    await runCortexArticleStructureSkill(serializedRequest);
  await Bun.write(Bun.stdout, serializedResult);
}
