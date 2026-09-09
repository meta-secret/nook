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
import { StructuralValueBoundary } from './structural-result-values.ts';
import type { UniqueStructuralIds as UniqueIdsRequest } from './structural-result-values.ts';

/** Owns the structural evidence schema registry and its capability transitions. */
export class StructuralEvidenceSchema {
  private constructor() {}
  private static readonly MAX_ITEMS = 100;

  private static readonly MAX_TEXT = 4096;

  static structuralFindingAssessmentSchemaForField(
    field: string,
  ): UntrustedYamlMap | false {
    const category = StructuralEvidenceSchema.expectedFindingCategory(field);
    return category
      ? StructuralEvidenceSchema.structuralFindingAssessmentSchema(category)
      : false;
  }

  static structuralInstructionClassificationSchema(): UntrustedYamlMap {
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
        instructionId: StructuralEvidenceSchema.boundedStringSchema(128),
        classification: StructuralEvidenceSchema.enumSchema(
          Object.values(StructuralInstructionClassificationKind),
        ),
        authorityPath: StructuralEvidenceSchema.boundedStringSchema(512),
        summary: StructuralEvidenceSchema.boundedStringSchema(
          StructuralEvidenceSchema.MAX_TEXT,
        ),
        evidence: StructuralEvidenceSchema.boundedArraySchema([
          StructuralEvidenceSchema.findingEvidenceSchema(),
          1,
          StructuralEvidenceSchema.MAX_ITEMS,
        ]),
      },
    };
  }

  static structuralExtractionCandidateSchema(): UntrustedYamlMap {
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
        candidateId: StructuralEvidenceSchema.boundedStringSchema(128),
        classification: StructuralEvidenceSchema.enumSchema(
          Object.values(LoomExtractionClassification),
        ),
        target: StructuralEvidenceSchema.enumSchema(
          Object.values(LoomExtractionTarget),
        ),
        summary: StructuralEvidenceSchema.boundedStringSchema(
          StructuralEvidenceSchema.MAX_TEXT,
        ),
        declaredInputs: StructuralEvidenceSchema.stringSequenceSchema(),
        declaredOutputs: StructuralEvidenceSchema.stringSequenceSchema(),
        failureBehavior: StructuralEvidenceSchema.stringSequenceSchema(),
        residualSemanticPolicy: StructuralEvidenceSchema.stringSequenceSchema(),
        evidence: StructuralEvidenceSchema.boundedArraySchema([
          StructuralEvidenceSchema.findingEvidenceSchema(),
          1,
          StructuralEvidenceSchema.MAX_ITEMS,
        ]),
      },
    };
  }

  static decodeStructuralFindingAssessment<
    TCategory extends StructuralFindingCategory,
  >(
    input: DecodeStructuralFindingAssessmentRequest<TCategory>,
  ): StructuralFindingAssessment<TCategory> {
    const record = StructuralValueBoundary.requiredStructuralRecord([
      input.node,
      'structural finding assessment',
    ]);
    const kind = StructuralValueBoundary.structuralEnumValue([
      StructuralValueBoundary.structuralProperty([record, 'kind']),
      Object.values(StructuralAssessmentKind),
    ]);
    if (kind === StructuralAssessmentKind.None) {
      StructuralValueBoundary.assertExactStructuralKeys([
        record,
        ['kind', 'reason'],
      ]);
      return {
        kind,
        reason: StructuralValueBoundary.boundedStructuralString([
          StructuralValueBoundary.structuralProperty([record, 'reason']),
          StructuralEvidenceSchema.MAX_TEXT,
        ]),
      };
    }
    StructuralValueBoundary.assertExactStructuralKeys([
      record,
      ['kind', 'findings'],
    ]);
    const findings = StructuralValueBoundary.requiredStructuralArray([
      StructuralValueBoundary.structuralProperty([record, 'findings']),
      1,
    ]).map((node) => {
      const decodeRequest: DecodeFindingRequest<TCategory> = {
        node,
        expectedCategory: input.expectedCategory,
      };
      return StructuralEvidenceSchema.decodeFinding(decodeRequest);
    });
    if (findings.length > StructuralEvidenceSchema.MAX_ITEMS)
      StructuralEvidenceSchema.invalid('structural findings exceed bound');
    const first = findings[0];
    if (!first)
      StructuralEvidenceSchema.invalid(
        'structural finding assessment is empty',
      );
    return { kind, findings: [first, ...findings.slice(1)] };
  }

  static decodeStructuralInstructionClassifications(
    node: UntrustedYamlNode,
  ): readonly StructuralInstructionClassification[] {
    const values = StructuralValueBoundary.requiredStructuralArray([
      node,
      0,
    ]).map((entry) => {
      const record = StructuralValueBoundary.requiredStructuralRecord([
        entry,
        'instruction classification',
      ]);
      StructuralValueBoundary.assertExactStructuralKeys([
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
        instructionId: StructuralValueBoundary.safeStructuralId(
          StructuralValueBoundary.structuralProperty([record, 'instructionId']),
        ),
        classification: StructuralValueBoundary.structuralEnumValue([
          StructuralValueBoundary.structuralProperty([
            record,
            'classification',
          ]),
          Object.values(StructuralInstructionClassificationKind),
        ]),
        authorityPath: StructuralValueBoundary.safeStructuralPath(
          StructuralValueBoundary.structuralProperty([record, 'authorityPath']),
        ),
        summary: StructuralValueBoundary.boundedStructuralString([
          StructuralValueBoundary.structuralProperty([record, 'summary']),
          StructuralEvidenceSchema.MAX_TEXT,
        ]),
        evidence: StructuralEvidenceSchema.decodeFindingEvidence(
          StructuralValueBoundary.structuralProperty([record, 'evidence']),
        ),
      };
    });
    const uniqueRequest: UniqueIdsRequest = {
      ids: values.map((value) => value.instructionId),
      label: 'instruction classification',
    };
    StructuralValueBoundary.assertUniqueStructuralIds(uniqueRequest);
    return values;
  }

  static decodeStructuralExtractionCandidates(
    node: UntrustedYamlNode,
  ): readonly LoomExtractionCandidate[] {
    const values = StructuralValueBoundary.requiredStructuralArray([
      node,
      0,
    ]).map((entry) => {
      const record = StructuralValueBoundary.requiredStructuralRecord([
        entry,
        'Loom extraction candidate',
      ]);
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
      StructuralValueBoundary.assertExactStructuralKeys([record, keys]);
      return {
        candidateId: StructuralValueBoundary.safeStructuralId(
          StructuralValueBoundary.structuralProperty([record, 'candidateId']),
        ),
        classification: StructuralValueBoundary.structuralEnumValue([
          StructuralValueBoundary.structuralProperty([
            record,
            'classification',
          ]),
          Object.values(LoomExtractionClassification),
        ]),
        target: StructuralValueBoundary.structuralEnumValue([
          StructuralValueBoundary.structuralProperty([record, 'target']),
          Object.values(LoomExtractionTarget),
        ]),
        summary: StructuralValueBoundary.boundedStructuralString([
          StructuralValueBoundary.structuralProperty([record, 'summary']),
          StructuralEvidenceSchema.MAX_TEXT,
        ]),
        declaredInputs: StructuralValueBoundary.boundedStructuralStrings([
          StructuralValueBoundary.structuralProperty([
            record,
            'declaredInputs',
          ]),
          1,
        ]),
        declaredOutputs: StructuralValueBoundary.boundedStructuralStrings([
          StructuralValueBoundary.structuralProperty([
            record,
            'declaredOutputs',
          ]),
          1,
        ]),
        failureBehavior: StructuralValueBoundary.boundedStructuralStrings([
          StructuralValueBoundary.structuralProperty([
            record,
            'failureBehavior',
          ]),
          1,
        ]),
        residualSemanticPolicy:
          StructuralValueBoundary.boundedStructuralStrings([
            StructuralValueBoundary.structuralProperty([
              record,
              'residualSemanticPolicy',
            ]),
            1,
          ]),
        evidence: StructuralEvidenceSchema.decodeFindingEvidence(
          StructuralValueBoundary.structuralProperty([record, 'evidence']),
        ),
      };
    });
    const uniqueRequest: UniqueIdsRequest = {
      ids: values.map((value) => value.candidateId),
      label: 'Loom extraction candidate',
    };
    StructuralValueBoundary.assertUniqueStructuralIds(uniqueRequest);
    return values;
  }

  static structuralFindingsFromAssessments(
    assessments: readonly StructuralFindingAssessment<StructuralFindingCategory>[],
  ): readonly StructuralFinding[] {
    return assessments.flatMap((assessment) =>
      assessment.kind === StructuralAssessmentKind.Findings
        ? assessment.findings
        : [],
    );
  }

  static assertUniqueStructuralFindingIds(
    findings: readonly StructuralFinding[],
  ): void {
    const request: UniqueIdsRequest = {
      ids: findings.map((finding) => finding.findingId),
      label: 'structural finding',
    };
    StructuralValueBoundary.assertUniqueStructuralIds(request);
  }

  private static expectedFindingCategory(
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

  private static structuralFindingAssessmentSchema(
    category: StructuralFindingCategory,
  ): UntrustedYamlMap {
    return {
      oneOf: [
        {
          type: 'object',
          additionalProperties: false,
          required: ['kind', 'findings'],
          properties: {
            kind: StructuralEvidenceSchema.enumSchema([
              StructuralAssessmentKind.Findings,
            ]),
            findings: StructuralEvidenceSchema.boundedArraySchema([
              StructuralEvidenceSchema.structuralFindingSchema(category),
              1,
              StructuralEvidenceSchema.MAX_ITEMS,
            ]),
          },
        },
        {
          type: 'object',
          additionalProperties: false,
          required: ['kind', 'reason'],
          properties: {
            kind: StructuralEvidenceSchema.enumSchema([
              StructuralAssessmentKind.None,
            ]),
            reason: StructuralEvidenceSchema.boundedStringSchema(
              StructuralEvidenceSchema.MAX_TEXT,
            ),
          },
        },
      ],
    };
  }

  private static structuralFindingSchema(
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
        findingId: StructuralEvidenceSchema.boundedStringSchema(128),
        category: StructuralEvidenceSchema.enumSchema([category]),
        severity: StructuralEvidenceSchema.enumSchema(
          Object.values(StructuralFindingSeverity),
        ),
        disposition: StructuralEvidenceSchema.enumSchema(
          Object.values(StructuralFindingDisposition),
        ),
        summary: StructuralEvidenceSchema.boundedStringSchema(
          StructuralEvidenceSchema.MAX_TEXT,
        ),
        evidence: StructuralEvidenceSchema.boundedArraySchema([
          StructuralEvidenceSchema.findingEvidenceSchema(),
          1,
          StructuralEvidenceSchema.MAX_ITEMS,
        ]),
        affectedPaths: StructuralEvidenceSchema.stringSequenceSchema(),
        currentOwner: StructuralEvidenceSchema.boundedStringSchema(
          StructuralEvidenceSchema.MAX_TEXT,
        ),
        proposedOwner: StructuralEvidenceSchema.boundedStringSchema(
          StructuralEvidenceSchema.MAX_TEXT,
        ),
        preservedInvariants: StructuralEvidenceSchema.stringSequenceSchema(),
        validation: StructuralEvidenceSchema.stringSequenceSchema(),
        unresolvedDecision: StructuralEvidenceSchema.boundedStringSchema(
          StructuralEvidenceSchema.MAX_TEXT,
        ),
      },
    };
  }

  private static decodeFinding<TCategory extends StructuralFindingCategory>(
    input: DecodeFindingRequest<TCategory>,
  ): StructuralFinding<TCategory> {
    const record = StructuralValueBoundary.requiredStructuralRecord([
      input.node,
      'structural finding',
    ]);
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
    StructuralValueBoundary.assertExactStructuralKeys([record, keys]);
    return {
      findingId: StructuralValueBoundary.safeStructuralId(
        StructuralValueBoundary.structuralProperty([record, 'findingId']),
      ),
      category: StructuralValueBoundary.structuralEnumValue<TCategory>([
        StructuralValueBoundary.structuralProperty([record, 'category']),
        [input.expectedCategory],
      ]),
      severity: StructuralValueBoundary.structuralEnumValue([
        StructuralValueBoundary.structuralProperty([record, 'severity']),
        Object.values(StructuralFindingSeverity),
      ]),
      disposition: StructuralValueBoundary.structuralEnumValue([
        StructuralValueBoundary.structuralProperty([record, 'disposition']),
        Object.values(StructuralFindingDisposition),
      ]),
      summary: StructuralValueBoundary.boundedStructuralString([
        StructuralValueBoundary.structuralProperty([record, 'summary']),
        StructuralEvidenceSchema.MAX_TEXT,
      ]),
      evidence: StructuralEvidenceSchema.decodeFindingEvidence(
        StructuralValueBoundary.structuralProperty([record, 'evidence']),
      ),
      affectedPaths: StructuralValueBoundary.safeStructuralPaths([
        StructuralValueBoundary.structuralProperty([record, 'affectedPaths']),
        1,
      ]),
      currentOwner: StructuralValueBoundary.boundedStructuralString([
        StructuralValueBoundary.structuralProperty([record, 'currentOwner']),
        StructuralEvidenceSchema.MAX_TEXT,
      ]),
      proposedOwner: StructuralValueBoundary.boundedStructuralString([
        StructuralValueBoundary.structuralProperty([record, 'proposedOwner']),
        StructuralEvidenceSchema.MAX_TEXT,
      ]),
      preservedInvariants: StructuralValueBoundary.boundedStructuralStrings([
        StructuralValueBoundary.structuralProperty([
          record,
          'preservedInvariants',
        ]),
        1,
      ]),
      validation: StructuralValueBoundary.boundedStructuralStrings([
        StructuralValueBoundary.structuralProperty([record, 'validation']),
        1,
      ]),
      unresolvedDecision: StructuralValueBoundary.boundedStructuralString([
        StructuralValueBoundary.structuralProperty([
          record,
          'unresolvedDecision',
        ]),
        StructuralEvidenceSchema.MAX_TEXT,
      ]),
    };
  }

  private static decodeFindingEvidence(
    node: UntrustedYamlNode,
  ): readonly StructuralFindingEvidence[] {
    return StructuralValueBoundary.requiredStructuralArray([node, 1]).map(
      (entry) => {
        const record = StructuralValueBoundary.requiredStructuralRecord([
          entry,
          'structural finding evidence',
        ]);
        StructuralValueBoundary.assertExactStructuralKeys([
          record,
          ['path', 'locator', 'observation'],
        ]);
        return {
          path: StructuralValueBoundary.safeStructuralPath(
            StructuralValueBoundary.structuralProperty([record, 'path']),
          ),
          locator: StructuralValueBoundary.boundedStructuralString([
            StructuralValueBoundary.structuralProperty([record, 'locator']),
            StructuralEvidenceSchema.MAX_TEXT,
          ]),
          observation: StructuralValueBoundary.boundedStructuralString([
            StructuralValueBoundary.structuralProperty([record, 'observation']),
            StructuralEvidenceSchema.MAX_TEXT,
          ]),
        };
      },
    );
  }

  private static findingEvidenceSchema(): UntrustedYamlMap {
    return {
      type: 'object',
      additionalProperties: false,
      required: ['path', 'locator', 'observation'],
      properties: {
        path: StructuralEvidenceSchema.boundedStringSchema(512),
        locator: StructuralEvidenceSchema.boundedStringSchema(
          StructuralEvidenceSchema.MAX_TEXT,
        ),
        observation: StructuralEvidenceSchema.boundedStringSchema(
          StructuralEvidenceSchema.MAX_TEXT,
        ),
      },
    };
  }

  private static boundedArraySchema(
    input: StructuralArraySchema,
  ): UntrustedYamlMap {
    const [items, minItems, maxItems] = input;
    return { type: 'array', minItems, maxItems, items };
  }

  private static boundedStringSchema(maxLength: number): UntrustedYamlMap {
    return { type: 'string', minLength: 1, maxLength, pattern: '\\S' };
  }

  private static enumSchema(values: readonly string[]): UntrustedYamlMap {
    return { type: 'string', enum: values };
  }

  private static stringSequenceSchema(): UntrustedYamlMap {
    return StructuralEvidenceSchema.boundedArraySchema([
      StructuralEvidenceSchema.boundedStringSchema(
        StructuralEvidenceSchema.MAX_TEXT,
      ),
      1,
      StructuralEvidenceSchema.MAX_ITEMS,
    ]);
  }

  private static invalid(detail: string): never {
    throw new Error(`Invalid workflow structured result: ${detail}.`);
  }
}

export type DecodeStructuralFindingAssessmentRequest<
  TCategory extends StructuralFindingCategory,
> = {
  readonly node: UntrustedYamlNode;
  readonly expectedCategory: TCategory;
};

type DecodeFindingRequest<TCategory extends StructuralFindingCategory> = {
  readonly node: UntrustedYamlNode;
  readonly expectedCategory: TCategory;
};

type StructuralArraySchema = readonly [UntrustedYamlMap, number, number];
