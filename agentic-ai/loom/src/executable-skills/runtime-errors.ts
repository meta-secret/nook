export type ExecutableSkillTimeoutErrorRequest = {
  readonly coldImageProvisioned: boolean;
  readonly containerName: string;
};

export class ExecutableSkillTimeoutError extends Error {
  readonly coldImageProvisioned: boolean;
  readonly containerName: string;

  constructor(request: ExecutableSkillTimeoutErrorRequest) {
    super('Executable skill timed out and its container was removed.');
    this.name = 'ExecutableSkillTimeoutError';
    this.coldImageProvisioned = request.coldImageProvisioned;
    this.containerName = request.containerName;
  }
}

export class ExecutableSkillTeardownError extends Error {
  readonly containerName: string;

  constructor(containerName: string) {
    super('Executable skill container teardown could not be confirmed.');
    this.name = 'ExecutableSkillTeardownError';
    this.containerName = containerName;
  }
}

export class ExecutableSkillCancellationError extends Error {
  readonly containerName: string | false;

  constructor(containerName: string | false) {
    super('Executable skill lifecycle was cancelled after confirmed teardown.');
    this.name = 'ExecutableSkillCancellationError';
    this.containerName = containerName;
  }
}
