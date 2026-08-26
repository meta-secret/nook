import { expect, test } from 'bun:test';
import type { RunBoundedProcessRequest } from '../../src/executable-skills/source-analysis-process.ts';
import {
  recoverStaleExecutableSkillDockerResources,
  type ExecutableSkillDockerRecoveryRequest,
} from '../../src/executable-skills/runtime-docker-recovery.ts';

const TOKEN = 'a'.repeat(32);
const OTHER_TOKEN = 'b'.repeat(32);
const DOCKER = '/trusted/docker';
const ENDPOINT = 'unix:///tmp/docker.sock';

test('kills and rescans an exact stale owner Docker process group', async () => {
  let processActive = true;
  const killed: number[] = [];
  const executeProcess = async (request: RunBoundedProcessRequest) => {
    if (request.command[0] === '/bin/ps') {
      const command = `${DOCKER} --host ${ENDPOINT} build --tag nook-executable-skill:${TOKEN} .`;
      const stdout = processActive
        ? `501 4242 4242 Wed Aug 26 14:00:00 2026 ${command}\n`
        : '';
      return { exitCode: 0, stderr: '', stdout };
    }
    return { exitCode: 0, stderr: '', stdout: '' };
  };
  const dependencies: RecoveryDependencies = {
    executeProcess,
    killProcessGroup: (processGroupId) => {
      killed.push(processGroupId);
      processActive = false;
    },
  };
  const request = recoveryRequest(dependencies);

  await recoverStaleExecutableSkillDockerResources(request);
  expect(killed).toEqual([4242]);
});

test('removes labeled container and image resources to a fixed point', async () => {
  let containerPresent = true;
  let imagePresent = true;
  const removed: string[] = [];
  const executeProcess = async (request: RunBoundedProcessRequest) => {
    const arguments_ = request.command.slice(3);
    if (request.command[0] === '/bin/ps') {
      return { exitCode: 0, stderr: '', stdout: '' };
    }
    if (arguments_[0] === 'container' && arguments_[1] === 'ls') {
      const stdout = containerPresent
        ? `nook-executable-skill-runtime-${TOKEN}|${TOKEN}\n`
        : '';
      return { exitCode: 0, stderr: '', stdout };
    }
    if (arguments_[0] === 'image' && arguments_[1] === 'ls') {
      const stdout = imagePresent ? `nook-executable-skill:${TOKEN}\n` : '';
      return { exitCode: 0, stderr: '', stdout };
    }
    if (arguments_.includes('--format')) {
      return { exitCode: 0, stderr: '', stdout: `${TOKEN}\n` };
    }
    if (arguments_[0] === 'rm') {
      containerPresent = false;
      removed.push('container');
      return { exitCode: 0, stderr: '', stdout: 'abcdef123456\n' };
    }
    if (arguments_[0] === 'image' && arguments_[1] === 'rm') {
      imagePresent = false;
      removed.push('image');
      return { exitCode: 0, stderr: '', stdout: 'fedcba654321\n' };
    }
    if (arguments_[0] === 'container' && arguments_[1] === 'inspect') {
      return absent('container');
    }
    if (arguments_[0] === 'image' && arguments_[1] === 'inspect') {
      return absent('image');
    }
    throw new Error(`Unexpected command: ${arguments_.join(' ')}`);
  };
  const dependencies: RecoveryDependencies = {
    executeProcess,
    killProcessGroup: () => {},
  };
  const request = recoveryRequest(dependencies);

  await recoverStaleExecutableSkillDockerResources(request);
  expect(removed).toEqual(['container', 'image']);
});

test('refuses resource ownership drift before removal', async () => {
  const executeProcess = async (request: RunBoundedProcessRequest) => {
    const arguments_ = request.command.slice(3);
    if (request.command[0] === '/bin/ps') {
      return { exitCode: 0, stderr: '', stdout: '' };
    }
    if (arguments_[0] === 'container' && arguments_[1] === 'ls') {
      return {
        exitCode: 0,
        stderr: '',
        stdout: `nook-executable-skill-runtime-${TOKEN}|${TOKEN}\n`,
      };
    }
    if (arguments_.includes('--format')) {
      return { exitCode: 0, stderr: '', stdout: `${OTHER_TOKEN}\n` };
    }
    return { exitCode: 0, stderr: '', stdout: '' };
  };
  const dependencies: RecoveryDependencies = {
    executeProcess,
    killProcessGroup: () => {},
  };
  const request = recoveryRequest(dependencies);

  await expect(
    recoverStaleExecutableSkillDockerResources(request),
  ).rejects.toThrow('ownership drifted');
});

type RecoveryDependencies = Pick<
  ExecutableSkillDockerRecoveryRequest,
  'executeProcess' | 'killProcessGroup'
>;

function recoveryRequest(
  dependencies: RecoveryDependencies,
): ExecutableSkillDockerRecoveryRequest {
  return {
    ...dependencies,
    cwd: '/repo',
    deadlineExpiresAt: Date.now() + 30_000,
    dockerExecutable: DOCKER,
    endpoint: ENDPOINT,
    userId: 501,
  };
}

function absent(kind: 'container' | 'image') {
  return {
    exitCode: 1,
    stderr: kind === 'image' ? 'No such image' : 'No such container',
    stdout: '',
  };
}
