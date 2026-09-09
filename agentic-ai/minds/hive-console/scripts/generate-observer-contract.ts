import Ajv from 'ajv';
import standaloneCode from 'ajv/dist/standalone/index.js';
import { execFileSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const consoleRoot = fileURLToPath(new URL('../', import.meta.url));
const generated = join(consoleRoot, 'src/generated');
const staged = await mkdtemp(join(tmpdir(), 'hive-observer-contract-'));
try {
  const nativeInput = process.env.HIVE_OBSERVER_CONTRACT_INPUT;
  if (nativeInput) {
    // Docker supplies fresh native output from the same source build.
    await cp(nativeInput, staged, { recursive: true });
  } else {
    execFileSync(
      'cargo',
      [
        'run',
        '--locked',
        '--manifest-path',
        join(consoleRoot, '../Cargo.toml'),
        '-p',
        'hive',
        '--features',
        'observer-contract-export',
        '--bin',
        'hive-export-observer-contract',
        '--',
        '--output',
        staged,
      ],
      { stdio: 'inherit' },
    );
  }
  // These are root bindings, not field schemas. Rust derives emit both representations.
  for (const root of ['ObserverSnapshot', 'ObservedTask']) {
    const schema: unknown = JSON.parse(
      await readFile(join(staged, root + '.schema.json'), 'utf8'),
    );
    if (!isSchemaObject(schema))
      throw new Error('Observer exporter did not emit a schema object');
    const ajv = new Ajv({
      code: { source: true, esm: true },
      coerceTypes: false,
      useDefaults: false,
      removeAdditional: false,
      // Schemars integer-format labels do not change the JSON number representation.
      validateFormats: false,
    });
    const validate = ajv.compile(schema);
    await writeFile(
      join(staged, root + '.validator.js'),
      standaloneCode(ajv, validate),
    );
    await writeFile(
      join(staged, root + '.validator.d.ts'),
      '// Generated from the same Rust root as the schema validator.\n' +
        'import type { ' +
        root +
        ' } from "./' +
        root +
        '";\n' +
        'declare const validate: (value: unknown) => value is ' +
        root +
        ';\n' +
        'export default validate;\n',
    );
  }
  await mkdir(join(consoleRoot, 'src'), { recursive: true });
  await rm(generated, { recursive: true, force: true });
  await cp(staged, generated, { recursive: true });
} finally {
  await rm(staged, { recursive: true, force: true });
}

// JSON Schema is arbitrary metadata owned and checked by Ajv, not a domain payload mirror.
function isSchemaObject(value: unknown): value is Record<string, unknown> {
  return value instanceof Object && !Array.isArray(value);
}
