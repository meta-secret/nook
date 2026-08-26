import {
  decodeSourceAnalysisRequest,
  encodeSourceAnalysisFailure,
  encodeSourceAnalysisResult,
} from './source-analysis-codec.ts';
import { analyzeExecutableSkillSource } from './source-policy.ts';

const SEALED_ANALYZER_ENVIRONMENT = 'NOOK_SEALED_SOURCE_ANALYZER';

async function runSealedSourceAnalysisWorker(): Promise<void> {
  let serializedResult: string;
  try {
    if (process.env[SEALED_ANALYZER_ENVIRONMENT] !== '1') {
      throw new Error('Source analysis worker requires its sealed image.');
    }
    const request = decodeSourceAnalysisRequest(await Bun.stdin.text());
    const analysis = analyzeExecutableSkillSource(request);
    serializedResult = encodeSourceAnalysisResult(analysis);
  } catch (error) {
    const failure =
      error instanceof Error
        ? error
        : new Error('Sealed source analysis failed.');
    serializedResult = encodeSourceAnalysisFailure(failure);
  }
  await Bun.write(Bun.stdout, serializedResult);
}

await runSealedSourceAnalysisWorker();
