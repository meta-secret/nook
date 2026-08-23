import { readFileSync } from 'node:fs';
import path from 'node:path';
import { findRepoRoot } from '../lib/repo.ts';
import {
  ExecutableSkillHostResultContract,
  type RegisteredExecutableSkill,
} from './domain.ts';
import { decodeExecutableSkillManifest } from './manifest-codec.ts';
import { materializeSkillAcceptanceProbeClosure } from './closure.ts';
import { assertExecutableSkillNotCancelled } from './lifecycle-cancellation.ts';
import {
  PROVISIONING_TIMEOUT_MS,
  dockerDeadline,
  ensureSkillImage,
  runDockerSkill,
  type DockerSkillOutput,
  type EnsureSkillImageRequest,
  type RunDockerSkillRequest,
} from './runtime.ts';

export enum ExecutableSkillAcceptanceProbe {
  Containment = 'containment',
  Overflow = 'overflow',
  Timeout = 'timeout',
}

export type ExecutableSkillAcceptanceEvidence = {
  readonly containerEnvironment: readonly string[];
  readonly probe: ExecutableSkillAcceptanceProbe;
  readonly serializedOutput: string;
};

export type ExecuteExecutableSkillAcceptanceProbeRequest = {
  readonly probe: ExecutableSkillAcceptanceProbe;
  readonly rebuildImage: boolean;
  readonly signal: AbortSignal | false;
};

export async function executeExecutableSkillAcceptanceProbe(
  request: ExecuteExecutableSkillAcceptanceProbeRequest,
): Promise<ExecutableSkillAcceptanceEvidence> {
  assertExecutableSkillNotCancelled(request.signal);
  const repositoryRoot = findRepoRoot();
  const fixtureRoot = '.agents/skills/cortex-article-structure/tests/fixtures';
  const manifestName = acceptanceManifestName(request.probe);
  const manifestPath = path.join(repositoryRoot, fixtureRoot, manifestName);
  const manifest = decodeExecutableSkillManifest(
    readFileSync(manifestPath, 'utf8'),
  );
  const definition: RegisteredExecutableSkill = {
    skillId: 'cortex-article-structure',
    manifest,
    manifestPath: `${fixtureRoot}/${manifestName}`,
    resultContract: ExecutableSkillHostResultContract.CortexArticleStructureV1,
    runnerPath: `${fixtureRoot}/${request.probe}-runner.ts`,
  };
  const provisioningDeadline = dockerDeadline(PROVISIONING_TIMEOUT_MS);
  const closureRequest = {
    deadlineExpiresAt: provisioningDeadline.expiresAt,
    definition,
    repositoryRoot,
    signal: request.signal,
  };
  const closure = await materializeSkillAcceptanceProbeClosure(closureRequest);
  let output: DockerSkillOutput;
  try {
    const imageRequest: EnsureSkillImageRequest = {
      closure,
      deadline: provisioningDeadline,
      rebuild: request.rebuildImage,
      signal: request.signal,
    };
    const image = await ensureSkillImage(imageRequest);
    const dockerRequest: RunDockerSkillRequest = {
      closure,
      deadline: dockerDeadline(manifest.limits.timeoutMs),
      image,
      resultBytes: manifest.limits.resultBytes,
      serializedRequest: '{}',
      signal: request.signal,
    };
    output = await runDockerSkill(dockerRequest);
  } finally {
    closure.dispose();
  }
  if (output.exitCode !== 0) {
    throw new Error('Executable skill acceptance container failed.');
  }
  const evidence: ExecutableSkillAcceptanceEvidence = {
    containerEnvironment: output.containerEnvironment,
    probe: request.probe,
    serializedOutput: output.stdout,
  };
  return Object.freeze(evidence);
}

function acceptanceManifestName(probe: ExecutableSkillAcceptanceProbe): string {
  if (probe === ExecutableSkillAcceptanceProbe.Timeout) {
    return 'timeout-manifest.json';
  }
  if (probe === ExecutableSkillAcceptanceProbe.Overflow) {
    return 'overflow-manifest.json';
  }
  return 'containment-manifest.json';
}
