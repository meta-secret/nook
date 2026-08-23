import {
  LoomExtractionClassification,
  LoomExtractionTarget,
  StructuralAssessmentKind,
  StructuralFindingCategory,
  StructuralFindingDisposition,
  StructuralFindingSeverity,
  StructuralInstructionClassificationKind,
} from './domain.ts';
import type {
  LoomExtractionCandidate,
  StructuralFinding,
  StructuralFindingAssessment,
  StructuralFindingEvidence,
  StructuralInstructionClassification,
} from './domain.ts';
import type { UntrustedYamlMap, UntrustedYamlNode } from '../lib/guards.ts';
import {
  assertExactStructuralKeys as assertExactKeys,
  assertUniqueStructuralIds as assertUniqueIds,
  boundedStructuralString as boundedString,
  boundedStructuralStrings as boundedStrings,
  requiredStructuralArray as requiredArray,
  requiredStructuralRecord as requiredRecord,
  safeStructuralId as safeId,
  safeStructuralPath as safePath,
  safeStructuralPaths as safePaths,
  structuralEnumValue as enumValue,
  structuralProperty as property,
} from './structural-result-values.ts';
import type { UniqueStructuralIds as UniqueIdsRequest } from './structural-result-values.ts';

const MAX_ITEMS = 100;
const MAX_TEXT = 4096;

export function structuralFindingAssessmentSchemaForField(
  field: string,
): UntrustedYamlMap | false {
  const category = expectedFindingCategory(field);
  return category ? structuralFindingAssessmentSchema(category) : false;
}

export function structuralInstructionClassificationSchema(): UntrustedYamlMap {
  return {
    type: 'object',
    additionalProperties: false,
    required: [
      'instructionId',
      'classification',
      'authorityPath',
      'summary',
      'evidence',
    ],
    properties: {
      instructionId: boundedStringSchema(128),
      classification: enumSchema(
        Object.values(StructuralInstructionClassificationKind),
      ),
      authorityPath: boundedStringSchema(512),
      summary: boundedStringSchema(MAX_TEXT),
      evidence: boundedArraySchema([findingEvidenceSchema(), 1, MAX_ITEMS]),
    },
  };
}

export function structuralExtractionCandidateSchema(): UntrustedYamlMap {
  return {
    type: 'object',
    additionalProperties: false,
    required: [
      'candidateId',
      'classification',
      'target',
      'summary',
      'declaredInputs',
      'declaredOutputs',
      'failureBehavior',
      'residualSemanticPolicy',
      'evidence',
    ],
    properties: {
      candidateId: boundedStringSchema(128),
      classification: enumSchema(Object.values(LoomExtractionClassification)),
      target: enumSchema(Object.values(LoomExtractionTarget)),
      summary: boundedStringSchema(MAX_TEXT),
      declaredInputs: stringSequenceSchema(),
      declaredOutputs: stringSequenceSchema(),
      failureBehavior: stringSequenceSchema(),
      residualSemanticPolicy: stringSequenceSchema(),
      evidence: boundedArraySchema([findingEvidenceSchema(), 1, MAX_ITEMS]),
    },
  };
}

export type DecodeStructuralFindingAssessmentRequest<
  TCategory extends StructuralFindingCategory,
> = {
  readonly node: UntrustedYamlNode;
  readonly expectedCategory: TCategory;
};

export function decodeStructuralFindingAssessment<
  TCategory extends StructuralFindingCategory,
>(
  input: DecodeStructuralFindingAssessmentRequest<TCategory>,
): StructuralFindingAssessment<TCategory> {
  const record = requiredRecord([input.node, 'structural finding assessment']);
  const kind = enumValue([
    property([record, 'kind']),
    Object.values(StructuralAssessmentKind),
  ]);
  if (kind === StructuralAssessmentKind.None) {
    assertExactKeys([record, ['kind', 'reason']]);
    return {
      kind,
      reason: boundedString([property([record, 'reason']), MAX_TEXT]),
    };
  }
  assertExactKeys([record, ['kind', 'findings']]);
  const findings = requiredArray([property([record, 'findings']), 1]).map(
    (node) => {
      const decodeRequest: DecodeFindingRequest<TCategory> = {
        node,
        expectedCategory: input.expectedCategory,
      };
      return decodeFinding(decodeRequest);
    },
  );
  if (findings.length > MAX_ITEMS) invalid('structural findings exceed bound');
  const first = findings[0];
  if (!first) invalid('structural finding assessment is empty');
  return { kind, findings: [first, ...findings.slice(1)] };
}

export function decodeStructuralInstructionClassifications(
  node: UntrustedYamlNode,
): readonly StructuralInstructionClassification[] {
  const values = requiredArray([node, 0]).map((entry) => {
    const record = requiredRecord([entry, 'instruction classification']);
    assertExactKeys([
      record,
      [
        'instructionId',
        'classification',
        'authorityPath',
        'summary',
        'evidence',
      ],
    ]);
    return {
      instructionId: safeId(property([record, 'instructionId'])),
      classification: enumValue([
        property([record, 'classification']),
        Object.values(StructuralInstructionClassificationKind),
      ]),
      authorityPath: safePath(property([record, 'authorityPath'])),
      summary: boundedString([property([record, 'summary']), MAX_TEXT]),
      evidence: decodeFindingEvidence(property([record, 'evidence'])),
    };
  });
  const uniqueRequest: UniqueIdsRequest = {
    ids: values.map((value) => value.instructionId),
    label: 'instruction classification',
  };
  assertUniqueIds(uniqueRequest);
  return values;
}

export function decodeStructuralExtractionCandidates(
  node: UntrustedYamlNode,
): readonly LoomExtractionCandidate[] {
  const values = requiredArray([node, 0]).map((entry) => {
    const record = requiredRecord([entry, 'Loom extraction candidate']);
    const keys = [
      'candidateId',
      'classification',
      'target',
      'summary',
      'declaredInputs',
      'declaredOutputs',
      'failureBehavior',
      'residualSemanticPolicy',
      'evidence',
    ];
    assertExactKeys([record, keys]);
    return {
      candidateId: safeId(property([record, 'candidateId'])),
      classification: enumValue([
        property([record, 'classification']),
        Object.values(LoomExtractionClassification),
      ]),
      target: enumValue([
        property([record, 'target']),
        Object.values(LoomExtractionTarget),
      ]),
      summary: boundedString([property([record, 'summary']), MAX_TEXT]),
      declaredInputs: boundedStrings([property([record, 'declaredInputs']), 1]),
      declaredOutputs: boundedStrings([
        property([record, 'declaredOutputs']),
        1,
      ]),
      failureBehavior: boundedStrings([
        property([record, 'failureBehavior']),
        1,
      ]),
      residualSemanticPolicy: boundedStrings([
        property([record, 'residualSemanticPolicy']),
        1,
      ]),
      evidence: decodeFindingEvidence(property([record, 'evidence'])),
    };
  });
  const uniqueRequest: UniqueIdsRequest = {
    ids: values.map((value) => value.candidateId),
    label: 'Loom extraction candidate',
  };
  assertUniqueIds(uniqueRequest);
  return values;
}

export function structuralFindingsFromAssessments(
  assessments: readonly StructuralFindingAssessment<StructuralFindingCategory>[],
): readonly StructuralFinding[] {
  return assessments.flatMap((assessment) =>
    assessment.kind === StructuralAssessmentKind.Findings
      ? assessment.findings
      : [],
  );
}

export function assertUniqueStructuralFindingIds(
  findings: readonly StructuralFinding[],
): void {
  const request: UniqueIdsRequest = {
    ids: findings.map((finding) => finding.findingId),
    label: 'structural finding',
  };
  assertUniqueIds(request);
}

function expectedFindingCategory(
  field: string,
): StructuralFindingCategory | false {
  switch (field) {
    case 'architectureFindings':
      return StructuralFindingCategory.Architecture;
    case 'designFindings':
      return StructuralFindingCategory.Design;
    case 'codeQualityFindings':
      return StructuralFindingCategory.CodeQuality;
    case 'typeSafetyFindings':
      return StructuralFindingCategory.TypeSafety;
    case 'testFindings':
      return StructuralFindingCategory.Tests;
    case 'dependencyDirectionFindings':
      return StructuralFindingCategory.DependencyDirection;
    case 'conflicts':
      return StructuralFindingCategory.AuthorityConflict;
    case 'obsoleteClaims':
      return StructuralFindingCategory.ObsoleteClaim;
    case 'historicalClaims':
      return StructuralFindingCategory.HistoricalClaim;
    case 'duplications':
      return StructuralFindingCategory.Duplication;
    case 'complexityFindings':
      return StructuralFindingCategory.Complexity;
    case 'knowledgeGraphImpacts':
      return StructuralFindingCategory.KnowledgeGraph;
    default:
      return false;
  }
}

function structuralFindingAssessmentSchema(
  category: StructuralFindingCategory,
): UntrustedYamlMap {
  return {
    oneOf: [
      {
        type: 'object',
        additionalProperties: false,
        required: ['kind', 'findings'],
        properties: {
          kind: enumSchema([StructuralAssessmentKind.Findings]),
          findings: boundedArraySchema([
            structuralFindingSchema(category),
            1,
            MAX_ITEMS,
          ]),
        },
      },
      {
        type: 'object',
        additionalProperties: false,
        required: ['kind', 'reason'],
        properties: {
          kind: enumSchema([StructuralAssessmentKind.None]),
          reason: boundedStringSchema(MAX_TEXT),
        },
      },
    ],
  };
}

function structuralFindingSchema(
  category: StructuralFindingCategory,
): UntrustedYamlMap {
  return {
    type: 'object',
    additionalProperties: false,
    required: [
      'findingId',
      'category',
      'severity',
      'disposition',
      'summary',
      'evidence',
      'affectedPaths',
      'currentOwner',
      'proposedOwner',
      'preservedInvariants',
      'validation',
      'unresolvedDecision',
    ],
    properties: {
      findingId: boundedStringSchema(128),
      category: enumSchema([category]),
      severity: enumSchema(Object.values(StructuralFindingSeverity)),
      disposition: enumSchema(Object.values(StructuralFindingDisposition)),
      summary: boundedStringSchema(MAX_TEXT),
      evidence: boundedArraySchema([findingEvidenceSchema(), 1, MAX_ITEMS]),
      affectedPaths: stringSequenceSchema(),
      currentOwner: boundedStringSchema(MAX_TEXT),
      proposedOwner: boundedStringSchema(MAX_TEXT),
      preservedInvariants: stringSequenceSchema(),
      validation: stringSequenceSchema(),
      unresolvedDecision: boundedStringSchema(MAX_TEXT),
    },
  };
}

type DecodeFindingRequest<TCategory extends StructuralFindingCategory> = {
  readonly node: UntrustedYamlNode;
  readonly expectedCategory: TCategory;
};

function decodeFinding<TCategory extends StructuralFindingCategory>(
  input: DecodeFindingRequest<TCategory>,
): StructuralFinding<TCategory> {
  const record = requiredRecord([input.node, 'structural finding']);
  const keys = [
    'findingId',
    'category',
    'severity',
    'disposition',
    'summary',
    'evidence',
    'affectedPaths',
    'currentOwner',
    'proposedOwner',
    'preservedInvariants',
    'validation',
    'unresolvedDecision',
  ];
  assertExactKeys([record, keys]);
  return {
    findingId: safeId(property([record, 'findingId'])),
    category: enumValue<TCategory>([
      property([record, 'category']),
      [input.expectedCategory],
    ]),
    severity: enumValue([
      property([record, 'severity']),
      Object.values(StructuralFindingSeverity),
    ]),
    disposition: enumValue([
      property([record, 'disposition']),
      Object.values(StructuralFindingDisposition),
    ]),
    summary: boundedString([property([record, 'summary']), MAX_TEXT]),
    evidence: decodeFindingEvidence(property([record, 'evidence'])),
    affectedPaths: safePaths([property([record, 'affectedPaths']), 1]),
    currentOwner: boundedString([property([record, 'currentOwner']), MAX_TEXT]),
    proposedOwner: boundedString([
      property([record, 'proposedOwner']),
      MAX_TEXT,
    ]),
    preservedInvariants: boundedStrings([
      property([record, 'preservedInvariants']),
      1,
    ]),
    validation: boundedStrings([property([record, 'validation']), 1]),
    unresolvedDecision: boundedString([
      property([record, 'unresolvedDecision']),
      MAX_TEXT,
    ]),
  };
}

function decodeFindingEvidence(
  node: UntrustedYamlNode,
): readonly StructuralFindingEvidence[] {
  return requiredArray([node, 1]).map((entry) => {
    const record = requiredRecord([entry, 'structural finding evidence']);
    assertExactKeys([record, ['path', 'locator', 'observation']]);
    return {
      path: safePath(property([record, 'path'])),
      locator: boundedString([property([record, 'locator']), MAX_TEXT]),
      observation: boundedString([property([record, 'observation']), MAX_TEXT]),
    };
  });
}

function findingEvidenceSchema(): UntrustedYamlMap {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['path', 'locator', 'observation'],
    properties: {
      path: boundedStringSchema(512),
      locator: boundedStringSchema(MAX_TEXT),
      observation: boundedStringSchema(MAX_TEXT),
    },
  };
}

type StructuralArraySchema = readonly [UntrustedYamlMap, number, number];

function boundedArraySchema(input: StructuralArraySchema): UntrustedYamlMap {
  const [items, minItems, maxItems] = input;
  return { type: 'array', minItems, maxItems, items };
}

function boundedStringSchema(maxLength: number): UntrustedYamlMap {
  return { type: 'string', minLength: 1, maxLength, pattern: '\\S' };
}

function enumSchema(values: readonly string[]): UntrustedYamlMap {
  return { type: 'string', enum: values };
}

function stringSequenceSchema(): UntrustedYamlMap {
  return boundedArraySchema([boundedStringSchema(MAX_TEXT), 1, MAX_ITEMS]);
}

function invalid(detail: string): never {
  throw new Error(`Invalid workflow structured result: ${detail}.`);
}
