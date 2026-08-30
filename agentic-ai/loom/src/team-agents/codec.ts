import { isRecord } from '../lib/guards.ts';
import type { UntrustedYamlMap, UntrustedYamlNode } from '../lib/guards.ts';
import { TeamKey } from './catalog.ts';
import {
  CORTEX_TEAM_TASK_ADMISSION_VERSION,
  type CortexTeamTaskAdmissionRequest,
} from './admission.ts';

const MAX_REQUEST_BYTES = 65_536;
const REQUEST_FIELDS = [
  'version',
  'taskId',
  'attempt',
  'sourceCommit',
  'team',
  'functionalOwner',
  'expectedResult',
  'readClaims',
  'writeClaims',
  'forbiddenClaims',
  'selectedSkillPaths',
  'acceptanceEvidence',
] as const;

export function decodeCortexTeamTaskAdmissionRequest(
  serialized: string,
): CortexTeamTaskAdmissionRequest {
  if (Buffer.byteLength(serialized, 'utf8') > MAX_REQUEST_BYTES)
    throw new Error('Cortex Team Task request is too large.');
  let value: UntrustedYamlNode;
  try {
    value = JSON.parse(serialized) as UntrustedYamlNode;
  } catch {
    throw new Error('Cortex Team Task request must be valid JSON.');
  }
  if (!isRecord(value))
    throw new Error('Cortex Team Task request must be an object.');
  const reader = new CortexTeamTaskRequestReader(value);
  reader.assertExactFields();
  const version = reader.positiveInteger('version');
  if (version !== CORTEX_TEAM_TASK_ADMISSION_VERSION)
    throw new Error('Cortex Team Task request version is unsupported.');
  return {
    version: CORTEX_TEAM_TASK_ADMISSION_VERSION,
    taskId: reader.string('taskId'),
    attempt: reader.positiveInteger('attempt'),
    sourceCommit: reader.string('sourceCommit'),
    team: reader.team('team'),
    functionalOwner: reader.team('functionalOwner'),
    expectedResult: reader.string('expectedResult'),
    readClaims: reader.stringList('readClaims'),
    writeClaims: reader.stringList('writeClaims'),
    forbiddenClaims: reader.stringList('forbiddenClaims'),
    selectedSkillPaths: reader.stringList('selectedSkillPaths'),
    acceptanceEvidence: reader.stringList('acceptanceEvidence'),
  };
}

class CortexTeamTaskRequestReader {
  readonly record: UntrustedYamlMap;

  constructor(record: UntrustedYamlMap) {
    this.record = record;
  }

  assertExactFields(): void {
    const actual = Object.keys(this.record).sort();
    const expected = [...REQUEST_FIELDS].sort();
    if (JSON.stringify(actual) !== JSON.stringify(expected))
      throw new Error(
        `Cortex Team Task request expects exactly: ${expected.join(', ')}.`,
      );
  }

  string(field: (typeof REQUEST_FIELDS)[number]): string {
    const value = this.record[field];
    if (
      typeof value !== 'string' ||
      value.trim() === '' ||
      value.length > 4096 ||
      hasControlCharacter(value)
    )
      throw new Error(`Cortex Team Task ${field} must be a bounded string.`);
    return value;
  }

  positiveInteger(field: (typeof REQUEST_FIELDS)[number]): number {
    const value = this.record[field];
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1)
      throw new Error(`Cortex Team Task ${field} must be a positive integer.`);
    return value;
  }

  team(field: (typeof REQUEST_FIELDS)[number]): TeamKey {
    const value = this.string(field);
    if (!Object.values(TeamKey).includes(value as TeamKey))
      throw new Error(`Cortex Team Task ${field} is unsupported.`);
    return value as TeamKey;
  }

  stringList(field: (typeof REQUEST_FIELDS)[number]): readonly string[] {
    const value = this.record[field];
    if (!Array.isArray(value) || value.length > 128)
      throw new Error(`Cortex Team Task ${field} must be a bounded array.`);
    const result: string[] = [];
    for (const entry of value) {
      if (
        typeof entry !== 'string' ||
        entry.trim() === '' ||
        entry.length > 4096 ||
        hasControlCharacter(entry)
      )
        throw new Error(
          `Cortex Team Task ${field} entries must be bounded strings.`,
        );
      result.push(entry);
    }
    return Object.freeze(result);
  }
}

function hasControlCharacter(value: string): boolean {
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (code <= 31 || code === 127) return true;
  }
  return false;
}
