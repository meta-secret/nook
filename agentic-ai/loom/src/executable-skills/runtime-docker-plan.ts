import path from 'node:path';

export const EXECUTABLE_SKILL_CONTAINER_LABEL =
  'dev.nokey.loom.executable-skill.id';
export const EXECUTABLE_SKILL_OWNER_LABEL =
  'dev.nokey.loom.executable-skill.owner';

export type ExecutableSkillContainerPlanRequest = {
  readonly containerName: string;
  readonly imageDigest: string;
  readonly ownerToken: string;
  readonly runnerContainerPath: string;
  readonly skillId: string;
};

export type ExecutableSkillContainerPlan = {
  readonly createArguments: readonly string[];
  readonly expectedInspection: string;
  readonly inspectionFormat: string;
};

const EXPECTED_DOCKER_RUNTIME = 'runc';
const PROXY_VARIABLES = [
  'ALL_PROXY',
  'FTP_PROXY',
  'HTTPS_PROXY',
  'HTTP_PROXY',
  'NO_PROXY',
  'all_proxy',
  'ftp_proxy',
  'https_proxy',
  'http_proxy',
  'no_proxy',
] as const;

export function planExecutableSkillContainer(
  request: ExecutableSkillContainerPlanRequest,
): ExecutableSkillContainerPlan {
  const runnerDirectory = path.posix.dirname(request.runnerContainerPath);
  const proxyArguments = PROXY_VARIABLES.flatMap((variable) => [
    '--env',
    `${variable}=`,
  ]);
  const createArguments = [
    'create',
    '--interactive',
    '--name',
    request.containerName,
    '--label',
    `${EXECUTABLE_SKILL_CONTAINER_LABEL}=${request.skillId}`,
    '--label',
    `${EXECUTABLE_SKILL_OWNER_LABEL}=${request.ownerToken}`,
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
    '--env',
    'HOME=/tmp',
    ...proxyArguments,
    '--tmpfs',
    '/tmp:rw,noexec,nosuid,size=16m',
    '--workdir',
    runnerDirectory,
    request.imageDigest,
    'bun',
    'run',
    request.runnerContainerPath,
  ];
  const inspectionFormat = [
    `{{index .Config.Labels "${EXECUTABLE_SKILL_OWNER_LABEL}"}}`,
    '{{.Image}}',
    '{{.Config.User}}',
    '{{.HostConfig.NetworkMode}}',
    '{{.HostConfig.ReadonlyRootfs}}',
    '{{.HostConfig.Privileged}}',
    '{{.HostConfig.AutoRemove}}',
    '{{.HostConfig.OomKillDisable}}',
    '{{.HostConfig.Memory}}',
    '{{.HostConfig.MemorySwap}}',
    '{{.HostConfig.NanoCpus}}',
    '{{.HostConfig.PidsLimit}}',
    '{{json .HostConfig.CapDrop}}',
    '{{json .HostConfig.SecurityOpt}}',
    '{{json .HostConfig.Tmpfs}}',
    '{{len .HostConfig.Binds}}',
    '{{len .Mounts}}',
    '{{len .HostConfig.Devices}}',
    '{{.HostConfig.Runtime}}',
    '{{.HostConfig.IpcMode}}',
    '{{.HostConfig.PidMode}}',
    '{{.HostConfig.UTSMode}}',
    '{{.HostConfig.UsernsMode}}',
    '{{.HostConfig.CgroupnsMode}}',
    '{{.HostConfig.CgroupParent}}',
    '{{.HostConfig.LogConfig.Type}}',
    '{{.HostConfig.RestartPolicy.Name}}',
  ].join('|');
  const expectedInspection = [
    request.ownerToken,
    request.imageDigest,
    '65532:65532',
    'none',
    'true',
    'false',
    'false',
    'false',
    String(256 * 1024 * 1024),
    String(256 * 1024 * 1024),
    String(1_000_000_000),
    '64',
    '["ALL"]',
    '["no-new-privileges","seccomp=builtin"]',
    '{"/tmp":"rw,noexec,nosuid,size=16m"}',
    '0',
    '0',
    '0',
    EXPECTED_DOCKER_RUNTIME,
    'private',
    '',
    '',
    '',
    'private',
    '',
    'none',
    'no',
  ].join('|');
  const plan: ExecutableSkillContainerPlan = {
    createArguments: Object.freeze(createArguments),
    expectedInspection,
    inspectionFormat,
  };
  return Object.freeze(plan);
}
