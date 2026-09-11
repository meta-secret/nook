import { z } from 'zod';
import {
  LoomExtractionClassification,
  LoomExtractionTarget,
  StructuralAssessmentKind,
  StructuralFindingCategory,
  StructuralFindingDisposition,
  StructuralFindingSeverity,
  StructuralInstructionClassificationKind,
} from './domain.ts';
import {
  STRUCTURAL_ID,
  STRUCTURAL_PATH,
  structuralError,
  structuralObjectError,
  structuralPaths,
  structuralStrings,
  structuralText,
} from './structural-result-values.ts';

const EVIDENCE = z
  .array(
    z.strictObject(
      {
        path: STRUCTURAL_PATH,
        locator: structuralText(),
        observation: structuralText(),
      },
      structuralObjectError,
    ),
    structuralError('structural result array is invalid'),
  )
  .min(1, 'structural result array is invalid')
  .max(100, 'structural result array is invalid');

export class StructuralEvidenceCodec {
  private constructor() {}
  static findingAssessment<T extends StructuralFindingCategory>(category: T) {
    const finding = z.strictObject(
      {
        findingId: STRUCTURAL_ID,
        category: z.literal(
          category,
          structuralError('structural closed vocabulary is invalid'),
        ),
        severity: z.enum(
          StructuralFindingSeverity,
          structuralError('structural closed vocabulary is invalid'),
        ),
        disposition: z.enum(
          StructuralFindingDisposition,
          structuralError('structural closed vocabulary is invalid'),
        ),
        summary: structuralText(),
        evidence: EVIDENCE,
        affectedPaths: structuralPaths(),
        currentOwner: structuralText(),
        proposedOwner: structuralText(),
        preservedInvariants: structuralStrings(),
        validation: structuralStrings(),
        unresolvedDecision: structuralText(),
      },
      structuralObjectError,
    );
    return z.discriminatedUnion(
      'kind',
      [
        z.strictObject(
          {
            kind: z.literal(StructuralAssessmentKind.Findings),
            findings: z
              .array(
                finding,
                structuralError('structural result array is invalid'),
              )
              .min(1, 'structural result array is invalid')
              .max(100, 'structural result array is invalid')
              .transform(
                (values) =>
                  values as [
                    z.infer<typeof finding>,
                    ...z.infer<typeof finding>[],
                  ],
              ),
          },
          structuralObjectError,
        ),
        z.strictObject(
          {
            kind: z.literal(StructuralAssessmentKind.None),
            reason: structuralText(),
          },
          structuralObjectError,
        ),
      ],
      structuralError('structural closed vocabulary is invalid'),
    );
  }
}

const INSTRUCTION = z.strictObject(
  {
    instructionId: STRUCTURAL_ID,
    classification: z.enum(
      StructuralInstructionClassificationKind,
      structuralError('structural closed vocabulary is invalid'),
    ),
    authorityPath: STRUCTURAL_PATH,
    summary: structuralText(),
    evidence: EVIDENCE,
  },
  structuralObjectError,
);
export const INSTRUCTION_CLASSIFICATIONS = z
  .array(INSTRUCTION, structuralError('structural result array is invalid'))
  .max(100, 'structural result array is invalid')
  .refine(
    (values) =>
      new Set(values.map((value) => value.instructionId)).size ===
      values.length,
    'instruction classification identifiers must be unique',
  );
const EXTRACTION = z.strictObject(
  {
    candidateId: STRUCTURAL_ID,
    classification: z.enum(
      LoomExtractionClassification,
      structuralError('structural closed vocabulary is invalid'),
    ),
    target: z.enum(
      LoomExtractionTarget,
      structuralError('structural closed vocabulary is invalid'),
    ),
    summary: structuralText(),
    declaredInputs: structuralStrings(),
    declaredOutputs: structuralStrings(),
    failureBehavior: structuralStrings(),
    residualSemanticPolicy: structuralStrings(),
    evidence: EVIDENCE,
  },
  structuralObjectError,
);
export const EXTRACTION_CANDIDATES = z
  .array(EXTRACTION, structuralError('structural result array is invalid'))
  .max(100, 'structural result array is invalid')
  .refine(
    (values) =>
      new Set(values.map((value) => value.candidateId)).size === values.length,
    'Loom extraction candidate identifiers must be unique',
  );
