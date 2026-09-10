import Ajv from 'ajv';
import standaloneCode from 'ajv/dist/standalone/index.js';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { err, ok, type Result } from 'neverthrow';
import {
  ContractDirectory,
  ContractFile,
  ContractWorkspaceRequest,
  NativeObserverExport,
  ContractFailureKind,
  type ContractFailure,
} from './observer-contract-io';

enum ObserverRoot {
  Snapshot = 'ObserverSnapshot',
  Task = 'ObservedTask',
}
class ObserverSchema {
  constructor(private readonly source: string) {}
  validator(): Result<string, ContractFailure> {
    let schema: unknown;
    try {
      schema = JSON.parse(this.source);
    } catch {
      return err({
        kind: ContractFailureKind.Schema,
        message: 'Observer exporter emitted invalid schema JSON',
      });
    }
    // Schema metadata is admitted by Ajv; it is not a domain payload mirror.
    if (!(schema instanceof Object) || Array.isArray(schema))
      return err({
        kind: ContractFailureKind.Schema,
        message: 'Observer exporter did not emit a schema object',
      });
    try {
      const ajv = new Ajv({
        code: { source: true, esm: true },
        coerceTypes: false,
        useDefaults: false,
        removeAdditional: false,
        validateFormats: false,
      });
      return ok(standaloneCode(ajv, ajv.compile(schema)));
    } catch {
      return err({
        kind: ContractFailureKind.Schema,
        message: 'Unable to compile exported observer schema',
      });
    }
  }
}
class ObserverValidatorExport {
  constructor(private readonly root: ObserverRoot) {}
  async write(
    staged: ContractDirectory,
  ): Promise<Result<void, ContractFailure>> {
    const source = await new ContractFile(
      join(staged.path, this.root + '.schema.json'),
    ).read();
    if (source.isErr()) return err(source.error);
    const validator = new ObserverSchema(source.value).validator();
    if (validator.isErr()) return err(validator.error);
    const written = await new ContractFile(
      join(staged.path, this.root + '.validator.js'),
    ).write(validator.value);
    if (written.isErr()) return err(written.error);
    return new ContractFile(
      join(staged.path, this.root + '.validator.d.ts'),
    ).write(
      '// Generated from the same Rust root as the schema validator.\n' +
        `import type { ${this.root} } from "./${this.root}";\n` +
        `declare const validate: (value: unknown) => value is ${this.root};\n` +
        'export default validate;\n',
    );
  }
}
class ObserverContractGeneration {
  constructor(private readonly consoleRoot: string) {}
  async execute(): Promise<Result<void, ContractFailure>> {
    const workspace = await new ContractWorkspaceRequest().create();
    if (workspace.isErr()) return err(workspace.error);
    const outcome = await this.generate(workspace.value);
    const cleanup = await workspace.value.remove();
    if (cleanup.isOk()) return outcome;
    if (outcome.isOk()) return err(cleanup.error);
    return err({
      kind: ContractFailureKind.Combined,
      message: outcome.error.message + '\n' + cleanup.error.message,
      failures: [outcome.error, cleanup.error],
    });
  }
  private async generate(
    staged: ContractDirectory,
  ): Promise<Result<void, ContractFailure>> {
    const nativeInput = process.env.HIVE_OBSERVER_CONTRACT_INPUT;
    const exported = nativeInput
      ? await staged.copyFrom(nativeInput)
      : new NativeObserverExport(this.consoleRoot).execute(staged.path);
    if (exported.isErr()) return err(exported.error);
    for (const root of Object.values(ObserverRoot)) {
      const written = await new ObserverValidatorExport(root).write(staged);
      if (written.isErr()) return err(written.error);
    }
    const source = await new ContractDirectory(
      join(this.consoleRoot, 'src'),
    ).create();
    if (source.isErr()) return err(source.error);
    const generated = new ContractDirectory(
      join(this.consoleRoot, 'src/generated'),
    );
    const removed = await generated.remove();
    if (removed.isErr()) return err(removed.error);
    return generated.copyFrom(staged.path);
  }
}
const outcome = await new ObserverContractGeneration(
  fileURLToPath(new URL('../', import.meta.url)),
).execute();
if (outcome.isErr()) {
  console.error(outcome.error.message);
  process.exitCode = 1;
}
