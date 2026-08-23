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
import { verifyCortexArticleStructureResult } from './verification.ts';

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
  const auditRequest = decodeCortexArticleRequest(request.serializedRequest);
  const result = decodeCortexArticleResult(request.serializedResult);
  const verificationRequest = { auditRequest, result };
  verifyCortexArticleStructureResult(verificationRequest);
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
