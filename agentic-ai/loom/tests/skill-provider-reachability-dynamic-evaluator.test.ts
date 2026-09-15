import { expect, test } from 'bun:test';

import { SkillProviderBoundaryScenario } from './skill-provider-boundary.test.ts';

test('rejects ambient dynamic-code evaluators and constructor recovery', () => {
  const sources = [
    'const run = eval; run(source);',
    'new Function(source)();',
    'new AsyncFunction(source)();',
    'new GeneratorFunction(source)();',
    '(() => {}).constructor(source)();',
    "const key = 'constructor'; (() => {})[key](source)();",
    'const { constructor: F } = (() => {}); F(source)();',
    'globalThis[computeKey()](source);',
    'Reflect[computeKey()](() => {}, source)(source)();',
    "import { fn } from './fn.ts'; const key = computeKey(); const first = fn[key]; const second = first; second(source)();",
    "import * as mod from './fn.ts'; const key = computeKey(); let first; let second; first = mod[key]; second = first; second(source)();",
    "import { fn } from './fn.ts'; const key = computeKey(); (0, fn[key])(source)();",
    "import * as mod from './fn.ts'; const key = computeKey(); (choose ? mod[key] : fallback)(source)();",
    "import { fn } from './fn.ts'; const key = computeKey(); ((fn[key] as never)!)(source)();",
    'const fn = () => {}; const key = computeKey(); ((fn as never)[key])(source);',
    'const fn = () => {}; const key = computeKey(); ((fn as Record<string, string>)[key])(source);',
    'declare function computeKey(): string; declare const source: string; const fn = () => {}; const masked = fn as never as Record<string, string>; const key = computeKey(); (masked[key] as never as (source: string) => void)(source);',
    'const fn = () => {}; const [masked] = [fn as never as Record<string, string>]; const key = computeKey(); (masked[key] as never as (source: string) => void)(source);',
    'const fn = () => {}; const { masked } = { masked: fn as never as Record<string, string> }; const key = computeKey(); (masked[key] as never as (source: string) => void)(source);',
    'const fn = () => {}; const holder = { masked: fn as never as Record<string, string> }; const { masked } = holder; const key = computeKey(); (masked[key] as never as (source: string) => void)(source);',
    'const fn = () => {}; const [{ masked }] = [{ masked: fn as never as Record<string, string> }]; const key = computeKey(); (masked[key] as never as (source: string) => void)(source);',
    'const fn = () => {}; const [masked = fn as never as Record<string, string>] = []; const key = computeKey(); (masked[key] as never as (source: string) => void)(source);',
    'const fn = () => {}; const { masked = fn as never as Record<string, string> } = {}; const key = computeKey(); (masked[key] as never as (source: string) => void)(source);',
    "import { fn } from './fn.ts'; const key = computeKey(); const holder = { evaluator: fn[key] }; holder.evaluator(source)();",
    "import * as mod from './fn.ts'; const key = computeKey(); const holder = [mod[key]]; holder.at(0)(source)();",
    "import { fn } from './fn.ts'; const key = computeKey(); const [evaluator] = [fn[key]]; evaluator(source)();",
    "import * as mod from './fn.ts'; const key = computeKey(); function evaluator() { return mod[key]; } evaluator()(source)();",
    "import { fn } from './fn.ts'; const registry: Record<string, (source: string) => Function> = { evaluator: fn }; const key = computeKey(); registry[key](source)();",
    "const { getOwnPropertyDescriptor: get } = Object; get(() => {}, 'constructor')!.value(source)();",
    "const { get } = Reflect; get(() => {}, 'constructor')(source)();",
    "globalThis.Reflect.get(() => {}, 'constructor')(source)();",
    "const O = globalThis['Object']; O.getOwnPropertyDescriptor(() => {}, 'constructor')!.value(source)();",
    "const R = global[`Reflect`]; R.get(() => {}, 'constructor')(source)();",
    "globalThis.global['globalThis'].Reflect.get(() => {}, 'constructor')(source)();",
    "const key = 'Object'; const O = globalThis[key]; O.getOwnPropertyDescriptor(() => {}, 'constructor')!.value(source)();",
  ];
  for (const source of sources) {
    const inspection = {
      filePath: 'dynamic-evaluator.mts',
      source,
    };
    expect(
      SkillProviderBoundaryScenario.violatesSkillProviderBoundary(inspection),
    ).toBe(true);
  }
  for (const source of [
    'export {}; const eval = (value: string) => value;',
    'export {}; class Function {};',
    'export {}; class Function {}; new Function();',
    "const values = ['safe']; const key = computeKey(); values[key];",
    "const values = ['safe']; const key = computeKey(); (values as never)[key];",
    "const values = ['safe']; const key = computeKey(); (values as Record<string, string>)[key];",
    "const record = { label: 'safe' }; const key = computeKey(); (record as Record<string, string>)[key];",
    "const values = ['safe']; const masked = values as never as Record<string, string>; const key = computeKey(); masked[key];",
    "const record = { label: 'safe' }; const masked = record as Record<string, string>; const key = computeKey(); masked[key];",
    "const values = ['safe']; const [masked] = [values as never as Record<string, string>]; const key = computeKey(); masked[key];",
    "const record = { label: 'safe' }; const { masked } = { masked: record as Record<string, string> }; const key = computeKey(); masked[key];",
    "const record = { label: 'safe' }; const holder = { masked: record as Record<string, string> }; const { masked } = holder; const key = computeKey(); masked[key];",
    "const record = { label: 'safe' }; const [{ masked }] = [{ masked: record as Record<string, string> }]; const key = computeKey(); masked[key];",
    "const values = ['safe']; const [masked = values as never as Record<string, string>] = []; const key = computeKey(); masked[key];",
    "const record = { label: 'safe' }; const { masked = record as Record<string, string> } = {}; const key = computeKey(); masked[key];",
  ]) {
    const localInspection = { filePath: 'local-evaluator.ts', source };
    expect(
      SkillProviderBoundaryScenario.violatesSkillProviderBoundary(
        localInspection,
      ),
      source,
    ).toBe(false);
  }
});
