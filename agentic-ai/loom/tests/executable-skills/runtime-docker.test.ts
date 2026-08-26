import { expect, test } from 'bun:test';
import { LoomFailureCode } from '../../src/loom-failure.ts';
import type { AuditedExecutableSkillRegistry } from '../../src/executable-skills/registry.ts';
import {
  assertExecutableSkillContainerDeadline,
  assertExecutableSkillContainerInventory,
  executeExecutableSkillContainerWithDependencies,
  executeExecutableSkillResourceTeardownWithDependencies,
  EXECUTABLE_SKILL_DOCKER_AUTHORITY_FORMAT,
  planExecutableSkillContainer,
  planExecutableSkillTeardownInventoryActivity,
  resolveExecutableSkillContainerState,
  type ExecutableSkillResourceTeardownDependencies,
  type ExecutableSkillResourceTeardownRequest,
  type ExecutableSkillTeardownInventoryActivityRequest,
  type ExecutableSkillContainerPlanRequest,
  type ExecutableSkillContainerDeadlineValidationRequest,
  type ExecutableSkillDockerDependencies,
  type ExecuteExecutableSkillContainerRequest,
  type ExecuteExecutableSkillContainerWithDependenciesRequest,
  type ExecuteExecutableSkillResourceTeardownWithDependenciesRequest,
} from '../../src/executable-skills/runtime-docker.ts';

test('accepts the exact total deadline minimum and rejects one millisecond less', () => {
  const now = 1_000_000;
  const exactRequest: ExecutableSkillContainerDeadlineValidationRequest = {
    deadlineExpiresAt: now + 40_000,
    now,
    signalAborted: false,
  };
  assertExecutableSkillContainerDeadline(exactRequest);
  const shortRequest: ExecutableSkillContainerDeadlineValidationRequest = {
    ...exactRequest,
    deadlineExpiresAt: exactRequest.deadlineExpiresAt - 1,
  };

  const expectedFailure = {
    code: LoomFailureCode.ExecutableSkillRuntimeFailed,
    message: expect.stringContaining('runtime deadline is invalid'),
  };
  expect(() => assertExecutableSkillContainerDeadline(shortRequest)).toThrow(
    expect.objectContaining(expectedFailure),
  );
});

test('plans an attested no-network read-only container', () => {
  const request: ExecutableSkillContainerPlanRequest = {
    containerName: 'nook-skill-1234',
    imageDigest: `sha256:${'a'.repeat(64)}`,
    runnerContainerPath: '/opt/nook-skill/fixture/src/runner.ts',
    skillId: 'fixture',
  };
  const plan = planExecutableSkillContainer(request);

  for (const required of [
    '--network=none',
    '--read-only',
    '--cap-drop=ALL',
    '--security-opt=no-new-privileges',
    '--security-opt=seccomp=builtin',
    '--pids-limit=64',
    '--memory=256m',
    '--memory-swap=256m',
    '--cpus=1',
    '--ipc=private',
    '--cgroupns=private',
    '--log-driver=none',
    '--restart=no',
    '--user=65532:65532',
  ]) {
    expect(plan.createArguments).toContain(required);
  }
  expect(plan.createArguments).not.toContain('--volume');
  expect(plan.createArguments).not.toContain('--mount');
  expect(plan.expectedInspection).toContain(
    'none|true|false|false|false|268435456|268435456|1000000000|64',
  );
  expect(plan.expectedInspection).toContain(
    '["ALL"]|["no-new-privileges","seccomp=builtin"]',
  );
  expect(plan.expectedInspection).toContain(
    '|0|0|0|runc|private||||private||none|no',
  );
  expect(Object.isFrozen(plan)).toBe(true);
  expect(Object.isFrozen(plan.createArguments)).toBe(true);
  expect(EXECUTABLE_SKILL_DOCKER_AUTHORITY_FORMAT).toContain('{{.ID}}');
  expect(EXECUTABLE_SKILL_DOCKER_AUTHORITY_FORMAT).toContain('{{.OSType}}');
  expect(EXECUTABLE_SKILL_DOCKER_AUTHORITY_FORMAT).toContain(
    '{{.DefaultRuntime}}',
  );
  expect(EXECUTABLE_SKILL_DOCKER_AUTHORITY_FORMAT).toContain(
    '{{json .SecurityOptions}}',
  );
  expect(EXECUTABLE_SKILL_DOCKER_AUTHORITY_FORMAT).toContain(
    '{{.CgroupVersion}}',
  );
});

test('keeps post-teardown inventory independent from operation interruption', () => {
  const controller = new AbortController();
  controller.abort();
  const request: ExecutableSkillTeardownInventoryActivityRequest = {
    operationDeadlineExpiresAt: Date.now() - 1,
    operationSignal: controller.signal,
    totalDeadlineExpiresAt: Date.now() + 30_000,
  };

  const activity = planExecutableSkillTeardownInventoryActivity(request);

  expect(activity.deadlineExpiresAt).toBeGreaterThan(Date.now() + 1_000);
  expect(activity.signal).toBe(false);
});

test('rejects forged registry authority before Docker execution', async () => {
  const forgedValue: AuditedExecutableSkillRegistry = { auditId: 'forged' };
  const registryAuthority = Object.freeze(forgedValue);
  let executed = false;
  const dependencies: ExecutableSkillDockerDependencies = {
    dockerExecutable: '/trusted/docker',
    executeProcess: async () => {
      executed = true;
      return { exitCode: 0, stderr: '', stdout: '' };
    },
    uniqueId: () => '12345678-1234-1234-1234-123456789abc',
  };
  const request: ExecuteExecutableSkillContainerRequest = {
    deadlineExpiresAt: Date.now() + 40_000,
    registryAuthority,
    serializedRequest: '{}',
    signal: false,
    skillId: 'fixture',
  };
  const execution: ExecuteExecutableSkillContainerWithDependenciesRequest = {
    dependencies,
    request,
  };
  const expectedFailure = {
    code: LoomFailureCode.ExecutableSkillRuntimeFailed,
    message: expect.stringContaining('registry authority is invalid'),
  };

  await expect(
    executeExecutableSkillContainerWithDependencies(execution),
  ).rejects.toMatchObject(expectedFailure);
  expect(executed).toBe(false);
});

test('fails closed when executable skill container inventory is not empty', () => {
  const clean = { exitCode: 0, stderr: '', stdout: '' };
  assertExecutableSkillContainerInventory(clean);

  for (const stale of [
    { exitCode: 0, stderr: '', stdout: 'container-id\n' },
    { exitCode: 1, stderr: 'daemon failed', stdout: '' },
    { exitCode: 0, stderr: 'unexpected warning', stdout: '' },
  ]) {
    const expectedFailure = {
      code: LoomFailureCode.ExecutableSkillRuntimeFailed,
      message: expect.stringContaining('preexisting container'),
    };
    expect(() => assertExecutableSkillContainerInventory(stale)).toThrow(
      expect.objectContaining(expectedFailure),
    );
  }
});

test('accepts only a successful non-OOM container state', () => {
  const successful = { exitCode: 0, stderr: '', stdout: 'false|0\n' };
  const expectedState = {
    exitCode: 0,
    oomKilled: false,
  };
  expect(resolveExecutableSkillContainerState(successful)).toEqual(
    expectedState,
  );
  for (const failed of [
    { exitCode: 0, stderr: '', stdout: 'true|137\n' },
    { exitCode: 0, stderr: '', stdout: 'false|1\n' },
  ]) {
    const state = resolveExecutableSkillContainerState(failed);
    expect(state.exitCode !== 0 || state.oomKilled).toBe(true);
  }
  const malformed = { exitCode: 0, stderr: '', stdout: 'invalid' };
  const expectedFailure = {
    code: LoomFailureCode.ExecutableSkillRuntimeFailed,
    message: expect.stringContaining('container state is invalid'),
  };
  expect(() => resolveExecutableSkillContainerState(malformed)).toThrow(
    expect.objectContaining(expectedFailure),
  );
});

test('retries container teardown until absence is confirmed', async () => {
  let containerAttempts = 0;
  let imageRemovals = 0;
  const dependencies: ExecutableSkillResourceTeardownDependencies = {
    assertContainerInventoryEmpty: async () => {},
    confirmContainerRemoved: async () => {
      containerAttempts += 1;
      return containerAttempts === 2;
    },
    removeImage: async () => {
      imageRemovals += 1;
    },
  };
  const request: ExecutableSkillResourceTeardownRequest = {
    containerMayExist: true,
    imageMayExist: true,
  };
  const teardown: ExecuteExecutableSkillResourceTeardownWithDependenciesRequest =
    { dependencies, request };

  await executeExecutableSkillResourceTeardownWithDependencies(teardown);

  expect(containerAttempts).toBe(2);
  expect(imageRemovals).toBe(1);
});

test('does not remove a container when create ownership was not established', async () => {
  let containerAttempts = 0;
  let imageRemovals = 0;
  const dependencies: ExecutableSkillResourceTeardownDependencies = {
    assertContainerInventoryEmpty: async () => {},
    confirmContainerRemoved: async () => {
      containerAttempts += 1;
      return true;
    },
    removeImage: async () => {
      imageRemovals += 1;
    },
  };
  const request: ExecutableSkillResourceTeardownRequest = {
    containerMayExist: false,
    imageMayExist: true,
  };
  const teardown: ExecuteExecutableSkillResourceTeardownWithDependenciesRequest =
    { dependencies, request };

  await executeExecutableSkillResourceTeardownWithDependencies(teardown);

  expect(containerAttempts).toBe(0);
  expect(imageRemovals).toBe(1);
});

test('removes the image after container teardown exhausts every attempt', async () => {
  let containerAttempts = 0;
  let imageRemovals = 0;
  const dependencies: ExecutableSkillResourceTeardownDependencies = {
    assertContainerInventoryEmpty: async () => {},
    confirmContainerRemoved: async () => {
      containerAttempts += 1;
      return false;
    },
    removeImage: async () => {
      imageRemovals += 1;
    },
  };
  const request: ExecutableSkillResourceTeardownRequest = {
    containerMayExist: true,
    imageMayExist: true,
  };
  const teardown: ExecuteExecutableSkillResourceTeardownWithDependenciesRequest =
    { dependencies, request };
  const expectedFailure = {
    code: LoomFailureCode.ExecutableSkillRuntimeFailed,
    message: expect.stringContaining('container absence was not confirmed'),
  };

  await expect(
    executeExecutableSkillResourceTeardownWithDependencies(teardown),
  ).rejects.toMatchObject(expectedFailure);
  expect(containerAttempts).toBe(3);
  expect(imageRemovals).toBe(1);
});

test('removes the image when post-teardown inventory is not empty', async () => {
  let imageRemovals = 0;
  const dependencies: ExecutableSkillResourceTeardownDependencies = {
    assertContainerInventoryEmpty: async () => {
      throw new Error(
        'Executable skill runtime found a preexisting container.',
      );
    },
    confirmContainerRemoved: async () => true,
    removeImage: async () => {
      imageRemovals += 1;
    },
  };
  const request: ExecutableSkillResourceTeardownRequest = {
    containerMayExist: true,
    imageMayExist: true,
  };
  const teardown: ExecuteExecutableSkillResourceTeardownWithDependenciesRequest =
    { dependencies, request };
  const expectedFailure = {
    code: LoomFailureCode.ExecutableSkillRuntimeFailed,
    message: expect.stringContaining('preexisting container'),
  };

  await expect(
    executeExecutableSkillResourceTeardownWithDependencies(teardown),
  ).rejects.toMatchObject(expectedFailure);
  expect(imageRemovals).toBe(1);
});
