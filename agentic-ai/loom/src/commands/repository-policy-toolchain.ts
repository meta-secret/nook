import { createHash } from 'node:crypto';
import {
  accessSync,
  chmodSync,
  constants as fsConstants,
  mkdirSync,
  writeFileSync,
} from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { err, ok, type Result } from 'neverthrow';

export enum ToolchainMode {
  Setup = 'setup',
  Compiler = 'compiler',
}

export enum CompilerKind {
  C = 'cc',
  Cxx = 'c++',
  Ar = 'ar',
}

export type ToolchainEnvironment = {
  readonly runnerTemp: string;
  readonly githubPath: string;
  readonly githubEnv: string;
};

export type ToolchainSetupRequest = {
  readonly mode: ToolchainMode.Setup;
  readonly environment: ToolchainEnvironment;
  readonly sourcePath: string;
};

export type CompilerRequest = {
  readonly mode: ToolchainMode.Compiler;
  readonly compiler: CompilerKind;
  readonly args: readonly string[];
};

export type RepositoryPolicyToolchainRequest =
  ToolchainSetupRequest | CompilerRequest;

export type CompilerArguments = {
  readonly args: readonly string[];
};

export enum ToolchainFailureKind {
  Environment = 'environment',
  Download = 'download',
  Checksum = 'checksum',
  Filesystem = 'filesystem',
  Command = 'command',
}

export type ToolchainFailure = {
  readonly kind: ToolchainFailureKind;
  readonly message: string;
};

export type ToolchainExecution = {
  readonly mode: ToolchainMode;
  readonly exitCode: number;
};

enum ToolchainStep {
  Completed = 'completed',
}

enum ToolchainCommandOutput {
  Inherit = 'inherit',
  Capture = 'capture',
}

type ToolchainArtifact = {
  readonly url: string;
  readonly path: string;
  readonly sha256: string;
};

type ArchiveExtraction = {
  readonly archivePath: string;
  readonly args: readonly string[];
};

type ToolchainCommandRequest = {
  readonly executable: string;
  readonly args: readonly string[];
  readonly label: string;
  readonly output: ToolchainCommandOutput;
};

type ToolchainCommandOutputValue = string | Buffer;
type ToolchainError = Error | string;

type CompilerWrapper = {
  readonly kind: CompilerKind;
  readonly fileName: string;
};

/** Owns the repository-policy runner's pinned, rootless native toolchain. */
export class RepositoryPolicyToolchain {
  constructor(private readonly request: RepositoryPolicyToolchainRequest) {}

  async execute(): Promise<Result<ToolchainExecution, ToolchainFailure>> {
    if (this.request.mode === ToolchainMode.Setup) {
      return this.install();
    }
    return Promise.resolve(this.runCompiler());
  }

  translateCompilerArguments(request: CompilerArguments): readonly string[] {
    const translated: string[] = [];
    for (let index = 0; index < request.args.length; index += 1) {
      const argument = request.args[index];
      if (typeof argument !== 'string') continue;
      if (argument === '--target=x86_64-unknown-linux-gnu') {
        translated.push('--target=x86_64-linux-gnu');
        continue;
      }
      if (argument === '-target=x86_64-unknown-linux-gnu') {
        translated.push('-target=x86_64-linux-gnu');
        continue;
      }
      if (argument === '--target' || argument === '-target') {
        translated.push(argument);
        const target = request.args[index + 1];
        if (target === 'x86_64-unknown-linux-gnu') {
          translated.push('x86_64-linux-gnu');
          index += 1;
        } else if (typeof target === 'string') {
          translated.push(target);
          index += 1;
        }
        continue;
      }
      translated.push(argument);
    }
    return translated;
  }

  private async install(): Promise<
    Result<ToolchainExecution, ToolchainFailure>
  > {
    if (this.request.mode !== ToolchainMode.Setup) {
      return err({
        kind: ToolchainFailureKind.Environment,
        message: 'Toolchain setup received a compiler invocation.',
      });
    }

    const { environment } = this.request;
    const nativeDirectory = join(
      environment.runnerTemp,
      'nook-native-toolchain',
    );
    const valeDirectory = join(nativeDirectory, 'vale-3.19.0');
    const zigVersion = '0.15.2';
    const zigArchive = join(
      environment.runnerTemp,
      `zig-x86_64-linux-${zigVersion}.tar.xz`,
    );
    const zigTar = join(
      environment.runnerTemp,
      `zig-x86_64-linux-${zigVersion}.tar`,
    );
    const zigDirectory = join(
      environment.runnerTemp,
      `zig-x86_64-linux-${zigVersion}`,
    );
    const valeArchive = join(
      environment.runnerTemp,
      'vale_3.19.0_Linux_64-bit.tar.gz',
    );
    const decoder = join(nativeDirectory, 'unxz');

    try {
      mkdirSync(nativeDirectory, { recursive: true });
      mkdirSync(valeDirectory, { recursive: true });
    } catch (error) {
      return err(
        this.filesystemFailure(error instanceof Error ? error : String(error)),
      );
    }

    const valeDownload = await this.download({
      url: 'https://github.com/vale-cli/vale/releases/download/v3.19.0/vale_3.19.0_Linux_64-bit.tar.gz',
      path: valeArchive,
      sha256:
        'c8f9d6c8055442bc7e9c121b2498e6f0e3fb670f4665e6ee577f1897f7665cf6',
    });
    if (valeDownload.isErr()) return err(valeDownload.error);

    const valeExtraction = this.extract({
      archivePath: valeArchive,
      args: ['-xzf', valeArchive, '-C', valeDirectory, 'vale'],
    });
    if (valeExtraction.isErr()) return err(valeExtraction.error);

    const valeExecutable = join(valeDirectory, 'vale');
    try {
      chmodSync(valeExecutable, 0o755);
    } catch (error) {
      return err(
        this.filesystemFailure(error instanceof Error ? error : String(error)),
      );
    }
    const valeVersion = this.command({
      executable: valeExecutable,
      args: ['--version'],
      label: 'Vale version check',
      output: ToolchainCommandOutput.Capture,
    });
    if (valeVersion.isErr()) return err(valeVersion.error);
    if (!(valeVersion.value instanceof Buffer)) {
      return err({
        kind: ToolchainFailureKind.Command,
        message: 'Vale version check did not produce text output.',
      });
    }
    if (valeVersion.value.toString('utf8').trim() !== 'vale version 3.19.0') {
      return err({
        kind: ToolchainFailureKind.Command,
        message: 'Vale version did not match the pinned 3.19.0 release.',
      });
    }

    const zigDownload = await this.download({
      url: `https://ziglang.org/download/${zigVersion}/zig-x86_64-linux-${zigVersion}.tar.xz`,
      path: zigArchive,
      sha256:
        '02aa270f183da276e5b5920b1dac44a63f1a49e55050ebde3aecc9eb82f93239',
    });
    if (zigDownload.isErr()) return err(zigDownload.error);

    const decoderDownload = await this.download({
      url: 'https://busybox.net/downloads/binaries/1.35.0-x86_64-linux-musl/busybox_UNXZ',
      path: decoder,
      sha256:
        'c70d2b5e2828f4c90c36a3b9185b5d4405b0751e9fc7c43231c78711e047a306',
    });
    if (decoderDownload.isErr()) return err(decoderDownload.error);
    try {
      chmodSync(decoder, 0o755);
    } catch (error) {
      return err(
        this.filesystemFailure(error instanceof Error ? error : String(error)),
      );
    }

    const decoded = this.command({
      executable: decoder,
      args: ['-c', zigArchive],
      label: 'static unxz extraction',
      output: ToolchainCommandOutput.Capture,
    });
    if (decoded.isErr()) return err(decoded.error);
    if (!(decoded.value instanceof Buffer)) {
      return err({
        kind: ToolchainFailureKind.Command,
        message: 'Static unxz extraction did not produce binary output.',
      });
    }
    try {
      writeFileSync(zigTar, decoded.value);
      mkdirSync(zigDirectory, { recursive: true });
    } catch (error) {
      return err(
        this.filesystemFailure(error instanceof Error ? error : String(error)),
      );
    }

    const zigExtraction = this.extract({
      archivePath: zigTar,
      args: ['-xf', zigTar, '-C', environment.runnerTemp],
    });
    if (zigExtraction.isErr()) return err(zigExtraction.error);
    const zigExecutable = join(zigDirectory, 'zig');
    try {
      accessSync(zigExecutable, fsConstants.X_OK);
    } catch {
      return err({
        kind: ToolchainFailureKind.Filesystem,
        message: 'Pinned Zig archive did not provide an executable.',
      });
    }

    const wrappers = [
      { kind: CompilerKind.C, fileName: 'cc' },
      { kind: CompilerKind.Cxx, fileName: 'c++' },
      { kind: CompilerKind.Ar, fileName: 'ar' },
    ] as const satisfies readonly CompilerWrapper[];
    for (const wrapper of wrappers) {
      const wrapperPath = join(nativeDirectory, wrapper.fileName);
      try {
        writeFileSync(
          wrapperPath,
          this.wrapperSource({
            kind: wrapper.kind,
            sourcePath: this.request.sourcePath,
          }),
          { encoding: 'utf8' },
        );
        chmodSync(wrapperPath, 0o755);
      } catch (error) {
        return err(
          this.filesystemFailure(
            error instanceof Error ? error : String(error),
          ),
        );
      }
    }

    try {
      writeFileSync(
        environment.githubPath,
        `${valeDirectory}\n${zigDirectory}\n${nativeDirectory}\n`,
        { encoding: 'utf8', flag: 'a' },
      );
      writeFileSync(
        environment.githubEnv,
        `CC=${join(nativeDirectory, 'cc')}\nCXX=${join(nativeDirectory, 'c++')}\nAR=${join(nativeDirectory, 'ar')}\n`,
        { encoding: 'utf8', flag: 'a' },
      );
    } catch (error) {
      return err(
        this.filesystemFailure(error instanceof Error ? error : String(error)),
      );
    }

    return ok({ mode: ToolchainMode.Setup, exitCode: 0 });
  }

  private async download(
    artifact: ToolchainArtifact,
  ): Promise<Result<ToolchainStep, ToolchainFailure>> {
    let response: Response;
    try {
      response = await fetch(artifact.url);
    } catch (error) {
      return err({
        kind: ToolchainFailureKind.Download,
        message: `Failed to download pinned toolchain artifact: ${this.errorMessage(error instanceof Error ? error : String(error))}`,
      });
    }
    if (!response.ok) {
      return err({
        kind: ToolchainFailureKind.Download,
        message: `Pinned toolchain artifact returned HTTP ${response.status}.`,
      });
    }
    let bytes: Uint8Array;
    try {
      bytes = new Uint8Array(await response.arrayBuffer());
    } catch (error) {
      return err({
        kind: ToolchainFailureKind.Download,
        message: `Failed to read pinned toolchain artifact: ${this.errorMessage(error instanceof Error ? error : String(error))}`,
      });
    }
    const digest = createHash('sha256').update(bytes).digest('hex');
    if (digest !== artifact.sha256) {
      return err({
        kind: ToolchainFailureKind.Checksum,
        message: `Checksum mismatch for pinned toolchain artifact ${artifact.path}.`,
      });
    }
    try {
      writeFileSync(artifact.path, bytes);
    } catch (error) {
      return err(
        this.filesystemFailure(error instanceof Error ? error : String(error)),
      );
    }
    return ok(ToolchainStep.Completed);
  }

  private extract(
    request: ArchiveExtraction,
  ): Result<ToolchainStep, ToolchainFailure> {
    const result = spawnSync('tar', request.args, { stdio: 'inherit' });
    if (result.error instanceof Error) {
      return err({
        kind: ToolchainFailureKind.Command,
        message: `Failed to extract ${request.archivePath}: ${result.error.message}`,
      });
    }
    if (result.status !== 0) {
      return err({
        kind: ToolchainFailureKind.Command,
        message: `tar failed while extracting ${request.archivePath}.`,
      });
    }
    return ok(ToolchainStep.Completed);
  }

  private command(
    request: ToolchainCommandRequest,
  ): Result<ToolchainCommandOutputValue, ToolchainFailure> {
    const result = spawnSync(request.executable, request.args, {
      encoding:
        request.output === ToolchainCommandOutput.Capture ? 'buffer' : 'utf8',
      stdio:
        request.output === ToolchainCommandOutput.Capture
          ? ['ignore', 'pipe', 'inherit']
          : 'inherit',
    });
    if (result.error instanceof Error) {
      return err({
        kind: ToolchainFailureKind.Command,
        message: `${request.label} failed: ${result.error.message}`,
      });
    }
    if (result.status !== 0) {
      return err({
        kind: ToolchainFailureKind.Command,
        message: `${request.label} exited with a non-zero status.`,
      });
    }
    if (request.output === ToolchainCommandOutput.Capture) {
      if (result.stdout instanceof Buffer) return ok(result.stdout);
      return err({
        kind: ToolchainFailureKind.Command,
        message: `${request.label} did not produce binary output.`,
      });
    }
    return ok('');
  }

  private runCompiler(): Result<ToolchainExecution, ToolchainFailure> {
    if (this.request.mode !== ToolchainMode.Compiler) {
      return err({
        kind: ToolchainFailureKind.Environment,
        message: 'Compiler execution received a setup request.',
      });
    }
    const compilerArguments = {
      args: this.request.args,
    } satisfies CompilerArguments;
    const result = spawnSync(
      'zig',
      [
        this.request.compiler,
        ...this.translateCompilerArguments(compilerArguments),
      ],
      { stdio: 'inherit' },
    );
    if (result.error instanceof Error) {
      return err({
        kind: ToolchainFailureKind.Command,
        message: `Zig ${this.request.compiler} failed: ${result.error.message}`,
      });
    }
    if (typeof result.status !== 'number') {
      return err({
        kind: ToolchainFailureKind.Command,
        message: `Zig ${this.request.compiler} did not return an exit status.`,
      });
    }
    return ok({ mode: ToolchainMode.Compiler, exitCode: result.status });
  }

  private wrapperSource(request: {
    readonly kind: CompilerKind;
    readonly sourcePath: string;
  }): string {
    const source = JSON.stringify(request.sourcePath);
    return [
      '#!/usr/bin/env bun',
      `import { CompilerKind, RepositoryPolicyToolchain, ToolchainMode } from ${source};`,
      'const result = await new RepositoryPolicyToolchain({',
      '  mode: ToolchainMode.Compiler,',
      `  compiler: CompilerKind.${request.kind === CompilerKind.C ? 'C' : request.kind === CompilerKind.Cxx ? 'Cxx' : 'Ar'},`,
      '  args: process.argv.slice(2),',
      '}).execute();',
      'if (result.isErr()) { console.error(result.error.message); process.exitCode = 1; } else { process.exitCode = result.value.exitCode; }',
      '',
    ].join('\n');
  }

  private filesystemFailure(error: ToolchainError): ToolchainFailure {
    return {
      kind: ToolchainFailureKind.Filesystem,
      message: `Rootless toolchain filesystem operation failed: ${typeof error === 'string' ? error : error.message}`,
    };
  }

  private errorMessage(error: ToolchainError): string {
    return typeof error === 'string' ? error : error.message;
  }
}

if (import.meta.main) {
  const operation = process.argv[2];
  if (operation !== 'setup') {
    console.error('Repository policy toolchain requires the setup operation.');
    process.exitCode = 1;
  } else {
    const runnerTemp = process.env.RUNNER_TEMP;
    const githubPath = process.env.GITHUB_PATH;
    const githubEnv = process.env.GITHUB_ENV;
    if (
      typeof runnerTemp !== 'string' ||
      typeof githubPath !== 'string' ||
      typeof githubEnv !== 'string'
    ) {
      console.error(
        'Repository policy toolchain requires RUNNER_TEMP, GITHUB_PATH, and GITHUB_ENV.',
      );
      process.exitCode = 1;
    } else {
      const result = await new RepositoryPolicyToolchain({
        mode: ToolchainMode.Setup,
        environment: { runnerTemp, githubPath, githubEnv },
        sourcePath: fileURLToPath(import.meta.url),
      }).execute();
      if (result.isErr()) {
        console.error(result.error.message);
        process.exitCode = 1;
      } else {
        process.exitCode = result.value.exitCode;
      }
    }
  }
}
