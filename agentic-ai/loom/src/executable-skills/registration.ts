import type {
  ExecutableSkillManifest,
  RegisteredExecutableSkill,
} from './domain.ts';
import { ExecutableSkillValidationKind } from './domain.ts';

export const MAXIMUM_EXECUTABLE_SKILL_REGISTRATIONS = 32;

export type ExecutableSkillRegistrationFailureRequest = {
  readonly message: string;
  readonly path: string;
  readonly skillId: string;
};

export class ExecutableSkillRegistrationError extends Error {
  readonly path: string;
  readonly skillId: string;

  constructor(request: ExecutableSkillRegistrationFailureRequest) {
    super(request.message);
    this.name = 'ExecutableSkillRegistrationError';
    this.path = request.path;
    this.skillId = request.skillId;
  }
}

export type ExecutableSkillRegistry = readonly RegisteredExecutableSkill[];

export type CreateExecutableSkillRegistryRequest = {
  readonly assertActive: (() => void) | false;
  readonly entries: readonly RegisteredExecutableSkill[];
};

export function createExecutableSkillRegistry(
  request: CreateExecutableSkillRegistryRequest,
): ExecutableSkillRegistry {
  if (request.assertActive !== false) request.assertActive();
  if (request.entries.length > MAXIMUM_EXECUTABLE_SKILL_REGISTRATIONS) {
    const failureRequest: ExecutableSkillRegistrationFailureRequest = {
      message: 'Executable skill registry exceeds its registration limit.',
      path: '.agents/skills',
      skillId: 'registry',
    };
    throw new ExecutableSkillRegistrationError(failureRequest);
  }
  const skillIds = new Set<string>();
  const registrations: RegisteredExecutableSkill[] = [];
  for (const entry of request.entries) {
    if (request.assertActive !== false) request.assertActive();
    if (skillIds.has(entry.skillId)) {
      throw new Error(`Duplicate executable skill ID: ${entry.skillId}`);
    }
    assertRegistrationIdentity(entry);
    skillIds.add(entry.skillId);
    const registration = freezeRegistration(entry);
    const insertion = registrations.findIndex(
      (candidate) => candidate.skillId > registration.skillId,
    );
    if (insertion < 0) registrations.push(registration);
    else registrations.splice(insertion, 0, registration);
  }
  return Object.freeze(registrations);
}

export type FindRegisteredExecutableSkillRequest = {
  readonly registry: ExecutableSkillRegistry;
  readonly skillId: string;
};

export function findRegisteredExecutableSkill(
  request: FindRegisteredExecutableSkillRequest,
): RegisteredExecutableSkill | false {
  return (
    request.registry.find((entry) => entry.skillId === request.skillId) || false
  );
}

export type SameExecutableSkillManifestRequest = {
  readonly left: ExecutableSkillManifest;
  readonly right: ExecutableSkillManifest;
};

export function sameExecutableSkillManifest(
  request: SameExecutableSkillManifestRequest,
): boolean {
  const left = request.left;
  const right = request.right;
  return (
    left.schemaVersion === right.schemaVersion &&
    left.id === right.id &&
    left.executionKind === right.executionKind &&
    left.requestKind === right.requestKind &&
    left.resultKind === right.resultKind &&
    left.limits.requestBytes === right.limits.requestBytes &&
    left.limits.resultBytes === right.limits.resultBytes &&
    left.limits.timeoutMs === right.limits.timeoutMs &&
    left.policyPaths.join('\0') === right.policyPaths.join('\0')
  );
}

function freezeRegistration(
  entry: RegisteredExecutableSkill,
): RegisteredExecutableSkill {
  const limits = { ...entry.manifest.limits };
  const policyPaths = [...entry.manifest.policyPaths];
  const manifest: ExecutableSkillManifest = {
    ...entry.manifest,
    limits: Object.freeze(limits),
    policyPaths: Object.freeze(policyPaths),
  };
  const registration: RegisteredExecutableSkill = {
    skillId: entry.skillId,
    manifest: Object.freeze(manifest),
    manifestPath: entry.manifestPath,
    requestValidation: entry.requestValidation,
    resultValidation: entry.resultValidation,
    runnerPath: entry.runnerPath,
  };
  return Object.freeze(registration);
}

function assertRegistrationIdentity(entry: RegisteredExecutableSkill): void {
  const expectedRoot = `.agents/skills/${entry.skillId}/`;
  const expectedManifestPath = `${expectedRoot}executable-skill.json`;
  if (
    entry.manifest.id !== entry.skillId ||
    entry.requestValidation !== ExecutableSkillValidationKind.KindAndSchemaV1 ||
    entry.resultValidation !== ExecutableSkillValidationKind.KindAndSchemaV1 ||
    entry.manifestPath !== expectedManifestPath ||
    !entry.runnerPath.startsWith(expectedRoot) ||
    !entry.runnerPath.endsWith('.ts') ||
    entry.runnerPath
      .split('/')
      .some((part) => part === '' || part === '.' || part === '..')
  ) {
    const failureRequest: ExecutableSkillRegistrationFailureRequest = {
      message:
        'Executable skill registration identity does not match its manifest and package root.',
      path: entry.manifestPath,
      skillId: entry.skillId,
    };
    throw new ExecutableSkillRegistrationError(failureRequest);
  }
}
