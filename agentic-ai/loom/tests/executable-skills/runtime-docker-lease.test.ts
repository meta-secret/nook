import { expect, test } from 'bun:test';
import { LoomFailureCode } from '../../src/loom-failure.ts';
import {
  executeWithExecutableSkillDockerLease,
  type ExecuteWithExecutableSkillDockerLeaseRequest,
} from '../../src/executable-skills/runtime-docker-lease.ts';
import type {
  BoundedProcessOutput,
  RunBoundedProcessRequest,
} from '../../src/executable-skills/source-analysis-process.ts';

type DockerLeaseFixture = {
  readonly commands: string[][];
  readonly deadlines: number[];
  readonly request: ExecuteWithExecutableSkillDockerLeaseRequest;
};

type CreateDockerLeaseFixtureRequest = {
  readonly actualOwnerToken: string;
  readonly requestedOwnerToken: string;
  readonly runLifecycle: () => Promise<void>;
};

function createDockerLeaseFixture(
  request: CreateDockerLeaseFixtureRequest,
): DockerLeaseFixture {
  const commands: string[][] = [];
  const deadlines: number[] = [];
  const executeProcess = async (
    processRequest: RunBoundedProcessRequest,
  ): Promise<BoundedProcessOutput> => {
    const command = [...processRequest.command];
    commands.push(command);
    deadlines.push(processRequest.deadlineExpiresAt);
    if (command.includes('inspect')) {
      return {
        exitCode: 0,
        stderr: '',
        stdout: `${request.actualOwnerToken}\n`,
      };
    }
    return {
      exitCode: 0,
      stderr: '',
      stdout: 'nook-executable-skill-runtime-lease\n',
    };
  };
  const leaseRequest: ExecuteWithExecutableSkillDockerLeaseRequest = {
    cwd: '/repository',
    deadlineExpiresAt: Date.now() + 40_000,
    dockerExecutable: '/trusted/docker',
    endpoint: 'unix:///trusted/docker.sock',
    execute: request.runLifecycle,
    executeProcess,
    ownerToken: request.requestedOwnerToken,
    signal: false,
  };
  return { commands, deadlines, request: leaseRequest };
}

test('executes and removes only for the Docker lease owner', async () => {
  let executions = 0;
  const fixtureRequest: CreateDockerLeaseFixtureRequest = {
    actualOwnerToken: 'a'.repeat(32),
    requestedOwnerToken: 'a'.repeat(32),
    runLifecycle: async () => {
      executions += 1;
    },
  };
  const fixture = createDockerLeaseFixture(fixtureRequest);

  await executeWithExecutableSkillDockerLease(fixture.request);

  expect(executions).toBe(1);
  expect(
    fixture.commands.filter((command) => command.includes('rm')),
  ).toHaveLength(1);
  expect(fixture.commands.some((command) => command.includes('TMPDIR'))).toBe(
    false,
  );
  expect(fixture.deadlines.at(-2)).toBe(
    fixture.request.deadlineExpiresAt - 2_000,
  );
  expect(fixture.deadlines.at(-1)).toBe(fixture.request.deadlineExpiresAt);
});

test('a losing Docker lease contender performs no lifecycle or cleanup', async () => {
  let executions = 0;
  const fixtureRequest: CreateDockerLeaseFixtureRequest = {
    actualOwnerToken: 'a'.repeat(32),
    requestedOwnerToken: 'b'.repeat(32),
    runLifecycle: async () => {
      executions += 1;
    },
  };
  const fixture = createDockerLeaseFixture(fixtureRequest);
  const expectedFailure = {
    code: LoomFailureCode.ExecutableSkillRuntimeFailed,
    message: expect.stringContaining('lease is already owned'),
  };

  await expect(
    executeWithExecutableSkillDockerLease(fixture.request),
  ).rejects.toMatchObject(expectedFailure);
  expect(executions).toBe(0);
  expect(
    fixture.commands.filter((command) => command.includes('rm')),
  ).toHaveLength(0);
});
