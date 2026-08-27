import { I18N_KEYS, type I18nKey } from "../../../generated/i18n-keys";
/** User-facing product help — keep in sync with .cortex/teams/dev-core/design-docs/unified-vault.md */

export type HelpSection = {
  id: string;
  titleKey: I18nKey;
  summaryKey: I18nKey;
  bulletKeys: I18nKey[];
  diagram?: (t: (key: string) => string) => string;
};

/** Mermaid source for the local-first vault model (rendered in Help). */
export function helpArchitectureDiagram(t: (key: string) => string): string {
  return `flowchart TB
  subgraph device["${t(I18N_KEYS.HelpDiagramDevice)}"]
    V[${t(I18N_KEYS.HelpDiagramLocalProjection)}]
    E[${t(I18N_KEYS.HelpDiagramEventStore)}]
    K[${t(I18N_KEYS.HelpDiagramDeviceKeys)}]
  end
  subgraph sync["${t(I18N_KEYS.HelpDiagramSync)}"]
    G[${t(I18N_KEYS.HelpDiagramNookLog)}]
    D[${t(I18N_KEYS.HelpDiagramProviderEvents)}]
  end
  E <-->|${t(I18N_KEYS.HelpDiagramSetUnion)}| G
  E <-->|${t(I18N_KEYS.HelpDiagramSetUnion)}| D
  E --> V
  K --> V`;
}

export const HELP_SECTIONS: HelpSection[] = [
  {
    id: "local-first",
    titleKey: I18N_KEYS.HelpSectionsLocalFirstTitle,
    summaryKey: I18N_KEYS.HelpSectionsLocalFirstSummary,
    bulletKeys: [
      I18N_KEYS.HelpSectionsLocalFirstBullet1,
      I18N_KEYS.HelpSectionsLocalFirstBullet2,
      I18N_KEYS.HelpSectionsLocalFirstBullet3,
      I18N_KEYS.HelpSectionsLocalFirstBullet4,
    ],
    diagram: helpArchitectureDiagram,
  },
  {
    id: "unlock",
    titleKey: I18N_KEYS.HelpSectionsUnlockTitle,
    summaryKey: I18N_KEYS.HelpSectionsUnlockSummary,
    bulletKeys: [
      I18N_KEYS.HelpSectionsUnlockBullet1,
      I18N_KEYS.HelpSectionsUnlockBullet2,
      I18N_KEYS.HelpSectionsUnlockBullet3,
      I18N_KEYS.HelpSectionsUnlockBullet4,
    ],
  },
  {
    id: "sync",
    titleKey: I18N_KEYS.HelpSectionsSyncTitle,
    summaryKey: I18N_KEYS.HelpSectionsSyncSummary,
    bulletKeys: [
      I18N_KEYS.HelpSectionsSyncBullet1,
      I18N_KEYS.HelpSectionsSyncBullet2,
      I18N_KEYS.HelpSectionsSyncBullet3,
      I18N_KEYS.HelpSectionsSyncBullet4,
    ],
  },
  {
    id: "conflicts",
    titleKey: I18N_KEYS.HelpSectionsConflictsTitle,
    summaryKey: I18N_KEYS.HelpSectionsConflictsSummary,
    bulletKeys: [
      I18N_KEYS.HelpSectionsConflictsBullet1,
      I18N_KEYS.HelpSectionsConflictsBullet2,
      I18N_KEYS.HelpSectionsConflictsBullet3,
      I18N_KEYS.HelpSectionsConflictsBullet4,
    ],
  },
  {
    id: "onboard",
    titleKey: I18N_KEYS.HelpSectionsOnboardTitle,
    summaryKey: I18N_KEYS.HelpSectionsOnboardSummary,
    bulletKeys: [
      I18N_KEYS.HelpSectionsOnboardBullet1,
      I18N_KEYS.HelpSectionsOnboardBullet2,
      I18N_KEYS.HelpSectionsOnboardBullet3,
      I18N_KEYS.HelpSectionsOnboardBullet4,
    ],
  },
  {
    id: "join",
    titleKey: I18N_KEYS.HelpSectionsJoinTitle,
    summaryKey: I18N_KEYS.HelpSectionsJoinSummary,
    bulletKeys: [
      I18N_KEYS.HelpSectionsJoinBullet1,
      I18N_KEYS.HelpSectionsJoinBullet2,
      I18N_KEYS.HelpSectionsJoinBullet3,
    ],
  },
  {
    id: "technical",
    titleKey: I18N_KEYS.HelpSectionsTechnicalTitle,
    summaryKey: I18N_KEYS.HelpSectionsTechnicalSummary,
    bulletKeys: [
      I18N_KEYS.HelpSectionsTechnicalBullet1,
      I18N_KEYS.HelpSectionsTechnicalBullet2,
      I18N_KEYS.HelpSectionsTechnicalBullet3,
      I18N_KEYS.HelpSectionsTechnicalBullet4,
    ],
  },
];
