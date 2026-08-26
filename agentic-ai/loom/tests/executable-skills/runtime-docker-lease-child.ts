import {
  executeWithExecutableSkillDockerLease,
  type ExecuteWithExecutableSkillDockerLeaseRequest,
} from '../../src/executable-skills/runtime-docker-lease.ts';

const daemonId = process.argv[2] || '';
const request: ExecuteWithExecutableSkillDockerLeaseRequest = {
  daemonId,
  endpoint: 'unix:///tmp/nook-runtime-test.sock',
  execute: async () =>
    await new Promise<void>(() => {
      process.stdout.write('ready\n');
    }),
  recover: async () => {},
};
await executeWithExecutableSkillDockerLease(request);
