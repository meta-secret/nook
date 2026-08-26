import { expect, test } from 'bun:test';
import path from 'node:path';
import {
  executeWithExecutableSkillDockerLease,
  type ExecuteWithExecutableSkillDockerLeaseRequest,
} from '../../src/executable-skills/runtime-docker-lease.ts';

const ENDPOINT = 'unix:///tmp/nook-runtime-test.sock';

test('serializes one daemon and releases after normal completion', async () => {
  const daemonId = daemonIdentity('normal');
  const events: string[] = [];
  const ownerRequest: ExecuteWithExecutableSkillDockerLeaseRequest = {
    daemonId,
    endpoint: ENDPOINT,
    execute: async () => {
      events.push('execute');
      const contenderRequest: ExecuteWithExecutableSkillDockerLeaseRequest = {
        daemonId,
        endpoint: ENDPOINT,
        execute: async () => {
          events.push('contender-execute');
        },
        recover: async () => {
          events.push('contender-recover');
        },
      };
      const contender = executeWithExecutableSkillDockerLease(contenderRequest);
      await expect(contender).rejects.toThrow('already owned');
    },
    recover: async () => {
      events.push('recover');
    },
  };
  await executeWithExecutableSkillDockerLease(ownerRequest);
  const successorRequest: ExecuteWithExecutableSkillDockerLeaseRequest = {
    daemonId,
    endpoint: ENDPOINT,
    execute: async () => {
      events.push('successor');
    },
    recover: async () => {},
  };
  await executeWithExecutableSkillDockerLease(successorRequest);
  expect(events).toEqual(['recover', 'execute', 'successor']);
});

test('kernel lease is released when its owner process is killed', async () => {
  const daemonId = daemonIdentity('crash');
  const command = [
    process.execPath,
    path.join(import.meta.dir, 'runtime-docker-lease-child.ts'),
    daemonId,
  ];
  const options = { stderr: 'pipe', stdout: 'pipe' } as const;
  const child = Bun.spawn(command, options);
  const reader = child.stdout.getReader();
  const ready = await reader.read();
  expect(new TextDecoder().decode(ready.value).trim()).toBe('ready');
  const contenderRequest: ExecuteWithExecutableSkillDockerLeaseRequest = {
    daemonId,
    endpoint: ENDPOINT,
    execute: async () => {},
    recover: async () => {},
  };
  const contender = executeWithExecutableSkillDockerLease(contenderRequest);
  await expect(contender).rejects.toThrow('already owned');
  child.kill(9);
  await child.exited;
  const successorRequest: ExecuteWithExecutableSkillDockerLeaseRequest = {
    daemonId,
    endpoint: ENDPOINT,
    execute: async () => {},
    recover: async () => {},
  };
  await executeWithExecutableSkillDockerLease(successorRequest);
});

test('rejects malformed daemon and endpoint identities', async () => {
  for (const identity of [
    { daemonId: 'short', endpoint: ENDPOINT },
    { daemonId: daemonIdentity('endpoint'), endpoint: 'tcp://remote:2375' },
  ]) {
    const request = {
      ...identity,
      execute: async () => {},
      recover: async () => {},
    };
    await expect(
      executeWithExecutableSkillDockerLease(request),
    ).rejects.toThrow('identity is invalid');
  }
});

function daemonIdentity(label: string): string {
  return `runtime-${label.padEnd(24, 'x')}`;
}
