import {
  analyzeExecutableSkillSource,
  ExecutableSkillSourceAnalysisResultKind,
  type AnalyzeExecutableSkillSourceRequest,
} from './source-policy.ts';

type SourceAnalysisWorkerRequest = {
  readonly relativePath: string | false;
  readonly source: string | false;
};

type SourceAnalysisWorkerResult =
  | {
      readonly kind: ExecutableSkillSourceAnalysisResultKind.Completed;
      readonly moduleSpecifiers: readonly string[];
    }
  | {
      readonly kind: ExecutableSkillSourceAnalysisResultKind.Failed;
      readonly message: string;
    };

function decodeWorkerRequest(
  serialized: string,
): AnalyzeExecutableSkillSourceRequest {
  const transport = JSON.parse(serialized) as SourceAnalysisWorkerRequest;
  if (
    !transport ||
    Object.keys(transport).length !== 2 ||
    !Object.hasOwn(transport, 'relativePath') ||
    !Object.hasOwn(transport, 'source') ||
    typeof transport.relativePath !== 'string' ||
    typeof transport.source !== 'string'
  ) {
    throw new Error('Executable skill source analysis request is invalid.');
  }
  return {
    relativePath: transport.relativePath,
    source: transport.source,
  };
}

async function main(): Promise<void> {
  let result: SourceAnalysisWorkerResult;
  try {
    const request = decodeWorkerRequest(await Bun.stdin.text());
    const analysis = analyzeExecutableSkillSource(request);
    result = {
      kind: ExecutableSkillSourceAnalysisResultKind.Completed,
      moduleSpecifiers: analysis.moduleSpecifiers,
    };
  } catch (error) {
    result = {
      kind: ExecutableSkillSourceAnalysisResultKind.Failed,
      message:
        error instanceof Error ? error.message : 'Source analysis failed.',
    };
  }
  await Bun.write(Bun.stdout, JSON.stringify(result));
}

await main();
