import { readFile, readlink } from 'node:fs/promises';

type StatusFieldRequest = {
  readonly field: string;
  readonly status: string;
};

type MountFieldRequest = {
  readonly mountPoint: string;
  readonly mounts: string;
};

type SourceAnalysisContainmentReceipt = {
  readonly capEff: string;
  readonly cgroup: string;
  readonly cgroupNamespace: string;
  readonly ipcNamespace: string;
  readonly netNamespace: string;
  readonly noNewPrivs: string;
  readonly pidNamespace: string;
  readonly rootMount: string;
  readonly seccomp: string;
  readonly tmpMount: string;
  readonly userNamespace: string;
  readonly utsNamespace: string;
};

function statusField(request: StatusFieldRequest): string {
  const prefix = `${request.field}:`;
  const line = request.status
    .split('\n')
    .find((candidate) => candidate.startsWith(prefix));
  if (!line) throw new Error(`Missing process status field ${request.field}.`);
  return line.slice(prefix.length).trim();
}

function mountField(request: MountFieldRequest): string {
  const line = request.mounts.split('\n').find((candidate) => {
    const fields = candidate.split(' ');
    return fields[1] === request.mountPoint;
  });
  if (!line) throw new Error(`Missing mount ${request.mountPoint}.`);
  return line;
}

const status = await readFile('/proc/self/status', 'utf8');
const mounts = await readFile('/proc/mounts', 'utf8');
const capEffRequest: StatusFieldRequest = { field: 'CapEff', status };
const noNewPrivsRequest: StatusFieldRequest = {
  field: 'NoNewPrivs',
  status,
};
const seccompRequest: StatusFieldRequest = { field: 'Seccomp', status };
const rootMountRequest: MountFieldRequest = { mountPoint: '/', mounts };
const tmpMountRequest: MountFieldRequest = { mountPoint: '/tmp', mounts };
const receipt: SourceAnalysisContainmentReceipt = {
  capEff: statusField(capEffRequest),
  cgroup: (await readFile('/proc/self/cgroup', 'utf8')).trim(),
  cgroupNamespace: await readlink('/proc/self/ns/cgroup'),
  ipcNamespace: await readlink('/proc/self/ns/ipc'),
  netNamespace: await readlink('/proc/self/ns/net'),
  noNewPrivs: statusField(noNewPrivsRequest),
  pidNamespace: await readlink('/proc/self/ns/pid'),
  rootMount: mountField(rootMountRequest),
  seccomp: statusField(seccompRequest),
  tmpMount: mountField(tmpMountRequest),
  userNamespace: await readlink('/proc/self/ns/user'),
  utsNamespace: await readlink('/proc/self/ns/uts'),
};

await Bun.write(Bun.stdout, JSON.stringify(receipt));
