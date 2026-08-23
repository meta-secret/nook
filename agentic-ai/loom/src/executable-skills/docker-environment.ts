const DOCKER_CONNECTION_ENVIRONMENT_KEYS = [
  'DOCKER_CERT_PATH',
  'DOCKER_CONFIG',
  'DOCKER_CONTEXT',
  'DOCKER_HOST',
  'DOCKER_TLS',
  'DOCKER_TLS_VERIFY',
  'HOME',
  'SSH_AUTH_SOCK',
] as const;

const BASE_DOCKER_CONTROL_ENVIRONMENT: Readonly<Record<string, string>> = {
  NO_COLOR: '1',
  PATH: '/usr/local/bin:/usr/bin:/bin:/opt/homebrew/bin',
};

export function resolveDockerControlEnvironment(): Readonly<
  Record<string, string>
> {
  const environment: Record<string, string> = {
    ...BASE_DOCKER_CONTROL_ENVIRONMENT,
  };
  for (const key of DOCKER_CONNECTION_ENVIRONMENT_KEYS) {
    const value = Bun.env[key];
    if (typeof value === 'string' && value.length > 0) {
      environment[key] = value;
    }
  }
  return Object.freeze(environment);
}
