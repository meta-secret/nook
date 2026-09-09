import { authentication_advance_control_is_safe } from "./nook-companion-wasm/nook_companion_wasm.js";
import type { AuthenticationAdvanceControlObservation } from "./nook-companion-wasm/nook_companion_wasm.js";
import {
  PasswordFormScopeKind,
  type PasskeyControlCandidate,
  type PasswordFieldQuery,
  type PasswordFormScope,
  type UnownedAuthContainerRequest,
  passwordFieldDiscovery,
} from "./password-form-fields";
import {
  AuthenticationSubmissionDestination,
  authenticationAdvanceControlSelector,
  MAX_AUTHENTICATION_WORKFLOW_OBSERVATIONS,
  PasswordFormQueryKind,
  semanticSubmitControlSelector,
  type PasswordFormScopeQuery,
  authenticationSubmissionControls,
} from "./password-form-submission-controls";

type RankableWorkflowSummary = {
  oneTimeCodeFieldCount: number;
  passwordFieldCount: number;
};

type PasskeyOnlyWorkflowObservation<Summary> = {
  root: ParentNode;
  formScope: PasswordFormScope;
  summary: Summary;
};

type RankableWorkflowObservation = {
  root: ParentNode;
  formScope: PasswordFormScope;
  summary: RankableWorkflowSummary;
};

type PasskeyOnlyScope = {
  root: ParentNode;
  formScope: PasswordFormScope;
};

type PasskeyControlSafetyRequest<Observation> = {
  candidate: PasskeyControlCandidate;
  observation: Observation;
};

type PasskeyControlIsSafe<Observation> = (
  request: PasskeyControlSafetyRequest<Observation>,
) => boolean;

type RankedPasskeyObservation<Observation> = {
  observation: Observation;
  safe: boolean;
  priority: number;
  progressing: boolean;
};

type IndexedPasskeyCandidates = {
  owned: Map<HTMLFormElement, PasskeyControlCandidate[]>;
  unowned: PasskeyControlCandidate[];
};

export type SummarizePasskeyOnlyWorkflowFormsRequest<Summary> = {
  root: Document;
  summarizeRoot: (query: PasswordFormScopeQuery) => Summary;
  observationPriority: (
    observation: PasskeyOnlyWorkflowObservation<Summary>,
  ) => number;
  passkeyControlIsSafe: PasskeyControlIsSafe<
    PasskeyOnlyWorkflowObservation<Summary>
  >;
  emptySummary: Summary;
};

export type AppendIndependentPasskeyOnlyWorkflowsRequest<
  Observation extends RankableWorkflowObservation,
> = {
  fieldBearing: Observation[];
  passkeyOnly: Observation[];
  observationPriority: (observation: Observation) => number;
  passkeyControlIsSafe: PasskeyControlIsSafe<Observation>;
};

type ShortlistWorkflowsRequest<
  Observation extends RankableWorkflowObservation,
> = {
  fieldBearing: Observation[];
  independent: Observation[];
  passkeyControlIsSafe: PasskeyControlIsSafe<Observation>;
  observationPriority: (observation: Observation) => number;
};

type CollectPasskeyOnlyScopesRequest = {
  root: Document;
  passkeyCandidates: PasskeyControlCandidate[];
};

type PasskeyCandidatesForScopeRequest = {
  scope: PasskeyOnlyScope;
  indexed: IndexedPasskeyCandidates;
};

type TakePreferredPasskeyOnlyObservationsRequest<Summary> = {
  scopes: PasskeyOnlyScope[];
  summarizeRoot: (query: PasswordFormScopeQuery) => Summary;
  observationPriority: (
    observation: PasskeyOnlyWorkflowObservation<Summary>,
  ) => number;
  passkeyControlIsSafe: PasskeyControlIsSafe<
    PasskeyOnlyWorkflowObservation<Summary>
  >;
  indexed: IndexedPasskeyCandidates;
  emptySummary: Summary;
};

type BoundedPriorityWorkflowEntry<Observation> = {
  observation: Observation;
  priority: number;
  progressing: boolean;
};

type PreferredPasskeyObservationEntry<Summary> = {
  observation: PasskeyOnlyWorkflowObservation<Summary>;
  safe: boolean;
  priority: number;
};

type UnownedPasskeyOnlyScope = {
  root: ParentNode;
  formScope: { kind: typeof PasswordFormScopeKind.Unowned };
};

type OwnedPasskeyOnlyScope = {
  root: ParentNode;
  formScope: {
    kind: typeof PasswordFormScopeKind.Owned;
    owner: HTMLFormElement;
  };
};

type PasskeyControlCandidateList = PasskeyControlCandidate[];

type RankedPasskeyObservationList<Observation> = Array<
  RankedPasskeyObservation<Observation>
>;

type RankableWorkflowObservationList<Observation> = Observation[];

type PreferredPasskeyObservationResult<Summary> = {
  observation: PasskeyOnlyWorkflowObservation<Summary>;
  safe: boolean;
};

type ObservationWithScope = {
  root: ParentNode;
  formScope: PasswordFormScope;
};

type TakeRankedWorkflowObservationsRequest<Observation> = {
  fieldBearing: Observation[];
  ranked: Array<RankedPasskeyObservation<Observation>>;
};

type ObservationHasSafePasskeyRequest<
  Observation extends ObservationWithScope,
> = {
  observation: Observation;
  passkeyCandidates: PasskeyControlCandidate[];
  passkeyControlIsSafe: PasskeyControlIsSafe<Observation>;
};

type CheapWorkflowProgressionRequest<
  Observation extends RankableWorkflowObservation,
> = {
  observation: Observation;
  passkeyControlIsSafe: PasskeyControlIsSafe<Observation>;
};

type TakeBoundedPriorityWorkflowsRequest<
  Observation extends RankableWorkflowObservation,
> = {
  observations: RankableWorkflowObservationList<Observation>;
  passkeyControlIsSafe: PasskeyControlIsSafe<Observation>;
  observationPriority: (observation: Observation) => number;
};

export class PasskeyOnlyWorkflowSummary<Summary> {
  constructor(
    private readonly request: SummarizePasskeyOnlyWorkflowFormsRequest<Summary>,
  ) {}
  get observations(): Array<PasskeyOnlyWorkflowObservation<Summary>> {
    const {
      root,
      summarizeRoot,
      observationPriority,
      passkeyControlIsSafe,
      emptySummary,
    } = this.request;
    if (!passwordFieldDiscovery.pageHasPasskeyControl(root)) return [];
    const passkeyCandidates = passwordFieldDiscovery.findPasskeyControls(root);
    const indexed =
      PasskeyOnlyWorkflowSummary.indexPasskeyCandidatesByScope(
        passkeyCandidates,
      );
    const scopesRequest: CollectPasskeyOnlyScopesRequest = {
      root,
      passkeyCandidates,
    };
    const scopes =
      PasskeyOnlyWorkflowSummary.collectPasskeyOnlyScopes(scopesRequest);
    const preferredRequest: TakePreferredPasskeyOnlyObservationsRequest<Summary> =
      {
        scopes,
        summarizeRoot,
        observationPriority,
        passkeyControlIsSafe,
        indexed,
        emptySummary,
      };
    const preferred =
      PasskeyOnlyWorkflowSummary.takePreferredPasskeyOnlyObservations(
        preferredRequest,
      );
    const ranked = preferred.map((entry) => ({
      observation: entry.observation,
      safe: entry.safe,
      priority: observationPriority(entry.observation),
      progressing: entry.safe,
    }));
    return PasskeyOnlyWorkflowSummary.takeRankedPasskeyObservations(ranked);
  }
  static shortlistWorkflowsForFactsRanking<
    Observation extends RankableWorkflowObservation,
  >({
    fieldBearing,
    independent,
    passkeyControlIsSafe,
    observationPriority,
  }: ShortlistWorkflowsRequest<Observation>): Observation[] {
    const boundedRequest: TakeBoundedPriorityWorkflowsRequest<Observation> = {
      observations: fieldBearing,
      passkeyControlIsSafe,
      observationPriority,
    };
    return [
      ...PasskeyOnlyWorkflowSummary.takeBoundedPriorityWorkflows(
        boundedRequest,
      ),
      ...independent.slice(0, MAX_AUTHENTICATION_WORKFLOW_OBSERVATIONS),
    ];
  }
  static unownedScopeLooksProgressing(
    observation: RankableWorkflowObservation,
  ): boolean {
    const { root, formScope, summary } = observation;
    if (
      formScope.kind !== PasswordFormScopeKind.Unowned ||
      !(root instanceof Document || root instanceof Element)
    )
      return false;
    const controls = Array.from(
      root.querySelectorAll<HTMLButtonElement | HTMLInputElement>(
        authenticationAdvanceControlSelector,
      ),
    ).filter(
      (control) =>
        !authenticationSubmissionControls.controlIsInert(control) &&
        !control.form,
    );
    const semanticSubmitControlCount =
      authenticationSubmissionControls.countedSemanticSubmitControls(controls);
    const fieldQuery: PasswordFieldQuery = { root, formScope };
    const passwordFields =
      passwordFieldDiscovery.findPasswordFields(fieldQuery);
    const newPasswordFieldCount = passwordFields.filter((field) => {
      const tokenRequest: Parameters<
        typeof passwordFieldDiscovery.hasAutocompleteToken
      >[0] = {
        field,
        expected: "new-password",
      };
      return passwordFieldDiscovery.hasAutocompleteToken(tokenRequest);
    }).length;
    return controls.some((control) => {
      const destinationRequest: Parameters<
        typeof authenticationSubmissionControls.controlDestinationIdentity
      >[0] = { control, formScope };
      const identityRequest: Parameters<
        typeof authenticationSubmissionControls.observedFormIdentity
      >[0] = {
        root,
        formScope,
      };
      const facts: AuthenticationAdvanceControlObservation = {
        actionability: "actionable",
        ownership: "locally-scoped",
        semantics: control.matches(semanticSubmitControlSelector)
          ? "semantic-submit"
          : "activation",
        authenticationUsername:
          passwordFieldDiscovery.usernameEvidence(fieldQuery),
        passwordFieldCount: summary.passwordFieldCount,
        newPasswordFieldCount,
        oneTimeCodeFieldCount: summary.oneTimeCodeFieldCount,
        semanticSubmitControlCount,
        sourceOrigin: ((v) => (v ? v : ""))(
          control.ownerDocument.defaultView?.location.origin,
        ),
        formIdentity:
          authenticationSubmissionControls.observedFormIdentity(
            identityRequest,
          ),
        destinationIdentity:
          authenticationSubmissionControls.controlDestinationIdentity(
            destinationRequest,
          ),
        label: authenticationSubmissionControls.controlLabel(control),
        machineIdentity:
          authenticationSubmissionControls.controlMachineIdentity(control),
        submissionMethod:
          authenticationSubmissionControls.controlSubmissionMethod(control),
        submissionDestinationSource:
          AuthenticationSubmissionDestination.source(control),
      };
      return (
        authenticationSubmissionControls.authenticationFactStringsAreTransportable(
          [
            facts.sourceOrigin,
            facts.formIdentity,
            facts.destinationIdentity,
            facts.label,
            ((v) => (v ? v : ""))(facts.machineIdentity),
          ],
        ) && authentication_advance_control_is_safe(facts)
      );
    });
  }
  static takeBoundedPriorityWorkflows<
    Observation extends RankableWorkflowObservation,
  >({
    observations,
    passkeyControlIsSafe,
    observationPriority,
  }: TakeBoundedPriorityWorkflowsRequest<Observation>): Observation[] {
    const selected: Array<BoundedPriorityWorkflowEntry<Observation>> = [];
    for (const observation of observations) {
      const progressionRequest: CheapWorkflowProgressionRequest<Observation> = {
        observation,
        passkeyControlIsSafe,
      };
      const priority = observationPriority(observation);
      const progressing =
        PasskeyOnlyWorkflowSummary.cheapWorkflowLooksProgressing(
          progressionRequest,
        );
      if (selected.length < MAX_AUTHENTICATION_WORKFLOW_OBSERVATIONS * 2) {
        const selectedEntry: BoundedPriorityWorkflowEntry<Observation> = {
          observation,
          priority,
          progressing,
        };
        selected.push(selectedEntry);
        continue;
      }
      const lowest = selected.reduce((...pair) => {
        const current = pair[0];
        const entry = pair[1];
        if (entry.priority < current.priority) return entry;
        if (
          entry.priority === current.priority &&
          !entry.progressing &&
          current.progressing
        ) {
          return entry;
        }
        return current;
      });
      if (
        priority > lowest.priority ||
        (priority === lowest.priority && progressing && !lowest.progressing)
      ) {
        const replacement: BoundedPriorityWorkflowEntry<Observation> = {
          observation,
          priority,
          progressing,
        };
        selected[selected.indexOf(lowest)] = replacement;
      }
    }
    return selected.map((entry) => entry.observation);
  }
  static cheapWorkflowLooksProgressing<
    Observation extends RankableWorkflowObservation,
  >({
    observation,
    passkeyControlIsSafe,
  }: CheapWorkflowProgressionRequest<Observation>): boolean {
    const root =
      observation.formScope.kind === PasswordFormScopeKind.Owned
        ? observation.formScope.owner
        : observation.root;
    const passkeyCandidates = passwordFieldDiscovery.findPasskeyControls(root);
    const safetyRequest: ObservationHasSafePasskeyRequest<Observation> = {
      observation,
      passkeyCandidates,
      passkeyControlIsSafe,
    };
    if (PasskeyOnlyWorkflowSummary.observationHasSafePasskey(safetyRequest))
      return true;
    if (observation.formScope.kind === PasswordFormScopeKind.Unowned) {
      return PasskeyOnlyWorkflowSummary.unownedScopeLooksProgressing(
        observation,
      );
    }
    return (
      !authenticationSubmissionControls.formHasGetMethodSubmitter(
        observation.formScope.owner,
      ) &&
      (!authenticationSubmissionControls.formBlocksCredentialDisclosure(
        observation.formScope.owner,
      ) ||
        authenticationSubmissionControls.formHasPostMethodSubmitter(
          observation.formScope.owner,
        )) &&
      authenticationSubmissionControls.formHasRustClassifiableAdvanceControl(
        observation.formScope.owner,
      )
    );
  }
  static collectPasskeyOnlyScopes({
    root,
    passkeyCandidates,
  }: CollectPasskeyOnlyScopesRequest): PasskeyOnlyScope[] {
    const passkeyForms = [
      ...new Set(
        passkeyCandidates.flatMap(({ control }) => {
          if (
            (control instanceof HTMLButtonElement ||
              control instanceof HTMLInputElement) &&
            control.form
          ) {
            return [control.form];
          }
          const owner = control.closest("form");
          return owner instanceof HTMLFormElement ? [owner] : [];
        }),
      ),
    ];
    const scopes: PasskeyOnlyScope[] = [];
    for (const form of passkeyForms) {
      const ownedScope: OwnedPasskeyOnlyScope = {
        root,
        formScope: {
          kind: PasswordFormScopeKind.Owned,
          owner: form,
        },
      };
      scopes.push(ownedScope);
    }
    const formlessPasskeys = passkeyCandidates.filter(({ control }) => {
      if (
        control instanceof HTMLButtonElement ||
        control instanceof HTMLInputElement
      ) {
        return !control.form;
      }
      return !(control.closest("form") instanceof HTMLFormElement);
    });
    const localPasskeyRoots = [
      ...new Set(
        formlessPasskeys.map(({ control }) => {
          const containerRequest: UnownedAuthContainerRequest = {
            field: control,
            root,
          };
          return passwordFieldDiscovery.localUnownedPasskeyContainer(
            containerRequest,
          );
        }),
      ),
    ];
    for (const localRoot of localPasskeyRoots) {
      const unownedScope: UnownedPasskeyOnlyScope = {
        root: localRoot,
        formScope: {
          kind: PasswordFormScopeKind.Unowned,
        },
      };
      scopes.push(unownedScope);
    }
    return scopes;
  }
  static indexPasskeyCandidatesByScope(
    passkeyCandidates: PasskeyControlCandidateList,
  ): IndexedPasskeyCandidates {
    const owned = new Map<HTMLFormElement, PasskeyControlCandidate[]>();
    const unowned: PasskeyControlCandidate[] = [];
    for (const candidate of passkeyCandidates) {
      if (authenticationSubmissionControls.controlIsInert(candidate.control))
        continue;
      const owner =
        authenticationSubmissionControls.associatedAuthenticationForm(
          candidate.control,
        );
      if (owner.kind === PasswordFormScopeKind.Owned) {
        const existing = owned.get(owner.owner);
        if (existing) {
          existing.push(candidate);
        } else {
          owned.set(owner.owner, [candidate]);
        }
        continue;
      }
      unowned.push(candidate);
    }
    return { owned, unowned };
  }
  static passkeyCandidatesForScope({
    scope,
    indexed,
  }: PasskeyCandidatesForScopeRequest): PasskeyControlCandidate[] {
    if (scope.formScope.kind === PasswordFormScopeKind.Owned) {
      const owned = indexed.owned.get(scope.formScope.owner);
      return owned ? owned : [];
    }
    return indexed.unowned.filter((candidate) =>
      scope.root.contains(candidate.control),
    );
  }
  static scopeHasPasswordField(scope: PasskeyOnlyScope): boolean {
    const fieldQuery: Parameters<
      typeof passwordFieldDiscovery.findPasswordFields
    >[0] = {
      root: scope.root,
      formScope: scope.formScope,
    };
    return passwordFieldDiscovery.findPasswordFields(fieldQuery).length > 0;
  }
  static scopeHasOneTimeCodeField(scope: PasskeyOnlyScope): boolean {
    const fieldQuery: Parameters<
      typeof passwordFieldDiscovery.findOneTimeCodeFields
    >[0] = {
      root: scope.root,
      formScope: scope.formScope,
    };
    return passwordFieldDiscovery.findOneTimeCodeFields(fieldQuery).length > 0;
  }
  static scopeHasUsernameField(scope: PasskeyOnlyScope): boolean {
    const fieldQuery: Parameters<
      typeof passwordFieldDiscovery.findUsernameFields
    >[0] = {
      root: scope.root,
      formScope: scope.formScope,
    };
    return passwordFieldDiscovery.findUsernameFields(fieldQuery).length > 0;
  }
  static takePreferredPasskeyOnlyObservations<Summary>({
    scopes,
    summarizeRoot,
    observationPriority,
    passkeyControlIsSafe,
    indexed,
    emptySummary,
  }: TakePreferredPasskeyOnlyObservationsRequest<Summary>): Array<
    PreferredPasskeyObservationResult<Summary>
  > {
    const preferred: Array<PreferredPasskeyObservationEntry<Summary>> = [];
    for (const scope of scopes) {
      if (PasskeyOnlyWorkflowSummary.scopeHasPasswordField(scope)) {
        continue;
      }
      const scopedCandidatesRequest: PasskeyCandidatesForScopeRequest = {
        scope,
        indexed,
      };
      const scopedCandidates =
        PasskeyOnlyWorkflowSummary.passkeyCandidatesForScope(
          scopedCandidatesRequest,
        );
      const emptyObservation: PasskeyOnlyWorkflowObservation<Summary> = {
        root: scope.root,
        formScope: scope.formScope,
        summary: emptySummary,
      };
      const cheapSafetyRequest: ObservationHasSafePasskeyRequest<
        PasskeyOnlyWorkflowObservation<Summary>
      > = {
        observation: emptyObservation,
        passkeyCandidates: scopedCandidates,
        passkeyControlIsSafe,
      };
      const cheapSafe =
        !PasskeyOnlyWorkflowSummary.scopeHasPasswordField(scope) &&
        PasskeyOnlyWorkflowSummary.observationHasSafePasskey(
          cheapSafetyRequest,
        );
      if (
        preferred.length >= MAX_AUTHENTICATION_WORKFLOW_OBSERVATIONS &&
        !cheapSafe &&
        !PasskeyOnlyWorkflowSummary.scopeHasOneTimeCodeField(scope) &&
        !PasskeyOnlyWorkflowSummary.scopeHasUsernameField(scope)
      ) {
        continue;
      }
      const summaryArgs: PasswordFormScopeQuery = {
        kind: PasswordFormQueryKind.Scoped,
        root: scope.root,
        formScope: scope.formScope,
      };
      const observation: PasskeyOnlyWorkflowObservation<Summary> = {
        root: scope.root,
        formScope: scope.formScope,
        summary: summarizeRoot(summaryArgs),
      };
      const safetyRequest: ObservationHasSafePasskeyRequest<
        PasskeyOnlyWorkflowObservation<Summary>
      > = {
        observation,
        passkeyCandidates: scopedCandidates,
        passkeyControlIsSafe,
      };
      const safe =
        PasskeyOnlyWorkflowSummary.observationHasSafePasskey(safetyRequest);
      const priority = observationPriority(observation);
      const preferredEntry: PreferredPasskeyObservationEntry<Summary> = {
        observation,
        safe,
        priority,
      };
      if (preferred.length < MAX_AUTHENTICATION_WORKFLOW_OBSERVATIONS) {
        preferred.push(preferredEntry);
        continue;
      }
      if (!safe && !PasskeyOnlyWorkflowSummary.scopeHasOneTimeCodeField(scope))
        continue;
      const lowest = preferred.reduce((...pair) => {
        const current = pair[0];
        const entry = pair[1];
        if (entry.priority < current.priority) return entry;
        if (
          entry.priority === current.priority &&
          !entry.safe &&
          current.safe
        ) {
          return entry;
        }
        return current;
      });
      if (
        priority > lowest.priority ||
        (priority === lowest.priority && safe && !lowest.safe)
      ) {
        preferred[preferred.indexOf(lowest)] = preferredEntry;
      }
    }
    return preferred;
  }
  static takeRankedPasskeyObservations<Observation>(
    ranked: RankedPasskeyObservationList<Observation>,
  ): Observation[] {
    return ranked
      .sort((...pair) => {
        const priorityDelta = pair[1].priority - pair[0].priority;
        return priorityDelta === 0
          ? Number(pair[1].safe) - Number(pair[0].safe)
          : priorityDelta;
      })
      .slice(0, MAX_AUTHENTICATION_WORKFLOW_OBSERVATIONS)
      .map((entry) => entry.observation);
  }
  static takeRankedWorkflowObservations<Observation>({
    fieldBearing,
    ranked,
  }: TakeRankedWorkflowObservationsRequest<Observation>): Observation[] {
    const fieldBearingSet = new Set(fieldBearing);
    const byPriority = [...ranked].sort((...pair) => {
      const priorityDelta = pair[1].priority - pair[0].priority;
      return priorityDelta === 0
        ? Number(pair[1].safe) - Number(pair[0].safe)
        : priorityDelta;
    });
    const selected: Observation[] = [];
    const selectedSet = new Set<Observation>();
    const take = (entry: RankedPasskeyObservation<Observation>) => {
      if (selectedSet.has(entry.observation)) return;
      if (selected.length >= MAX_AUTHENTICATION_WORKFLOW_OBSERVATIONS) return;
      selected.push(entry.observation);
      selectedSet.add(entry.observation);
    };
    for (const entry of byPriority) {
      if (fieldBearingSet.has(entry.observation) && entry.progressing) {
        take(entry);
        break;
      }
    }
    if (selected.length === 0) {
      for (const entry of byPriority) {
        if (fieldBearingSet.has(entry.observation)) {
          take(entry);
          break;
        }
      }
    }
    for (const entry of byPriority) {
      if (entry.safe && !fieldBearingSet.has(entry.observation)) {
        take(entry);
        break;
      }
    }
    for (const entry of byPriority) take(entry);
    return selected;
  }
  static observationHasSafePasskey<
    Observation extends {
      root: ParentNode;
      formScope: PasswordFormScope;
    },
  >({
    observation,
    passkeyCandidates,
    passkeyControlIsSafe,
  }: ObservationHasSafePasskeyRequest<Observation>): boolean {
    return passkeyCandidates.some((candidate) => {
      if (authenticationSubmissionControls.controlIsInert(candidate.control))
        return false;
      const owner =
        authenticationSubmissionControls.associatedAuthenticationForm(
          candidate.control,
        );
      const belongs =
        observation.formScope.kind === PasswordFormScopeKind.Owned
          ? owner.kind === PasswordFormScopeKind.Owned &&
            owner.owner === observation.formScope.owner
          : owner.kind === PasswordFormScopeKind.Unowned &&
            observation.root.contains(candidate.control);
      const safetyRequest: PasskeyControlSafetyRequest<Observation> = {
        candidate,
        observation,
      };
      return belongs && passkeyControlIsSafe(safetyRequest);
    });
  }
}
export class IndependentPasskeyWorkflows<
  Observation extends RankableWorkflowObservation,
> {
  constructor(
    private readonly request: AppendIndependentPasskeyOnlyWorkflowsRequest<Observation>,
  ) {}
  get observations(): Observation[] {
    const {
      fieldBearing,
      passkeyOnly,
      observationPriority,
      passkeyControlIsSafe,
    } = this.request;
    const ownedForms = new Set(
      fieldBearing.flatMap((observation) =>
        observation.formScope.kind === PasswordFormScopeKind.Owned
          ? [observation.formScope.owner]
          : [],
      ),
    );
    const independent = passkeyOnly.filter((observation) => {
      if (observation.formScope.kind === PasswordFormScopeKind.Owned) {
        return !ownedForms.has(observation.formScope.owner);
      }
      return !fieldBearing.some((existing) => {
        if (existing.formScope.kind !== PasswordFormScopeKind.Unowned) {
          return false;
        }
        if (existing.root === observation.root) {
          return true;
        }
        return (
          observation.root instanceof Node &&
          existing.root instanceof Node &&
          observation.root.contains(existing.root)
        );
      });
    });
    const passkeyCandidates =
      passwordFieldDiscovery.findPasskeyControls(document);
    const shortlistRequest: ShortlistWorkflowsRequest<Observation> = {
      fieldBearing,
      independent,
      passkeyControlIsSafe,
      observationPriority,
    };
    const rankingCandidates =
      PasskeyOnlyWorkflowSummary.shortlistWorkflowsForFactsRanking(
        shortlistRequest,
      );
    const ranked = rankingCandidates.map((observation) => {
      const safetyRequest: ObservationHasSafePasskeyRequest<Observation> = {
        observation,
        passkeyCandidates,
        passkeyControlIsSafe,
      };
      const progressionRequest: CheapWorkflowProgressionRequest<Observation> = {
        observation,
        passkeyControlIsSafe,
      };
      return {
        observation,
        safe: PasskeyOnlyWorkflowSummary.observationHasSafePasskey(
          safetyRequest,
        ),
        priority: observationPriority(observation),
        progressing:
          PasskeyOnlyWorkflowSummary.cheapWorkflowLooksProgressing(
            progressionRequest,
          ),
      };
    });
    const rankedRequest: TakeRankedWorkflowObservationsRequest<Observation> = {
      fieldBearing,
      ranked,
    };
    return PasskeyOnlyWorkflowSummary.takeRankedWorkflowObservations(
      rankedRequest,
    );
  }
}
