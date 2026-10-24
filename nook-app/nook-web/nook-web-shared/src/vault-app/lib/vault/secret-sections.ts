import {
  NookSecretTypeFilter,
  SecretCategory,
  SecretType,
  secret_type_name,
} from "$app-wasm";
import { I18N_KEYS } from "../../../generated/i18n-keys";

/** One type filter of a vault section; its type is also offered by that section's add picker. */
export type VaultSectionTypeEntry = {
  readonly type: SecretType;
  readonly filter: NookSecretTypeFilter;
  readonly testId: string;
  readonly labelKey: string;
};

/** Copy keys that name what a vault section lists. */
export type VaultSectionCopy = {
  readonly tabKey: string;
  readonly addKey: string;
  readonly searchKey: string;
  readonly filterGroupKey: string;
  readonly countKey: string;
  readonly countPageKey: string;
  readonly listKey: string;
  readonly emptyTitleKey: string;
  readonly emptyBodyKey: string;
  readonly noMatchTitleKey: string;
};

export type VaultSectionDefinition = {
  readonly section: SecretCategory;
  readonly allFilter: NookSecretTypeFilter;
  readonly testId: string;
  readonly copy: VaultSectionCopy;
  readonly types: readonly VaultSectionTypeEntry[];
};

type VaultSectionTypeRequest = Omit<VaultSectionTypeEntry, "testId">;

const SECRETS_TYPES: readonly VaultSectionTypeRequest[] = [
  {
    type: SecretType.Login,
    filter: NookSecretTypeFilter.Login,
    labelKey: I18N_KEYS.VaultTypesLogin,
  },
  {
    type: SecretType.Authenticator,
    filter: NookSecretTypeFilter.Authenticator,
    labelKey: I18N_KEYS.VaultTypesAuthenticator,
  },
  {
    type: SecretType.ApiKey,
    filter: NookSecretTypeFilter.ApiKey,
    labelKey: I18N_KEYS.VaultTypesApiKey,
  },
  {
    type: SecretType.SeedPhrase,
    filter: NookSecretTypeFilter.SeedPhrase,
    labelKey: I18N_KEYS.VaultTypesSeedPhrase,
  },
  {
    type: SecretType.SecureNote,
    filter: NookSecretTypeFilter.SecureNote,
    labelKey: I18N_KEYS.VaultTypesSecureNote,
  },
  {
    type: SecretType.FileAttachment,
    filter: NookSecretTypeFilter.FileAttachment,
    labelKey: I18N_KEYS.VaultTypesFileAttachment,
  },
  {
    type: SecretType.Passkey,
    filter: NookSecretTypeFilter.Passkey,
    labelKey: I18N_KEYS.VaultTypesPasskey,
  },
];

const PERSONAL_DATA_TYPES: readonly VaultSectionTypeRequest[] = [
  {
    type: SecretType.Person,
    filter: NookSecretTypeFilter.Person,
    labelKey: I18N_KEYS.VaultTypesPerson,
  },
  {
    type: SecretType.Address,
    filter: NookSecretTypeFilter.Address,
    labelKey: I18N_KEYS.VaultTypesAddress,
  },
  {
    type: SecretType.IdentityDocument,
    filter: NookSecretTypeFilter.IdentityDocument,
    labelKey: I18N_KEYS.VaultTypesIdentityDocument,
  },
  {
    type: SecretType.InternationalAccount,
    filter: NookSecretTypeFilter.InternationalAccount,
    labelKey: I18N_KEYS.VaultTypesInternationalAccount,
  },
  {
    type: SecretType.DomesticAccount,
    filter: NookSecretTypeFilter.DomesticAccount,
    labelKey: I18N_KEYS.VaultTypesDomesticAccount,
  },
  {
    type: SecretType.CreditCard,
    filter: NookSecretTypeFilter.CreditCard,
    labelKey: I18N_KEYS.VaultTypesCreditCard,
  },
];

/**
 * The vault page's two sections and their type filters. Rust owns which
 * section a secret type belongs to (`secret_type_category`); these entries only
 * order the filters and picker cards within each section.
 */
export class VaultSections {
  static readonly order: readonly SecretCategory[] = [
    SecretCategory.Secrets,
    SecretCategory.PersonalData,
  ];

  /** The filter that lists every type of the section. */
  static allFilter(section: SecretCategory): NookSecretTypeFilter {
    switch (section) {
      case SecretCategory.Secrets:
        return NookSecretTypeFilter.Secrets;
      case SecretCategory.PersonalData:
        return NookSecretTypeFilter.PersonalData;
    }
  }

  static definition(section: SecretCategory): VaultSectionDefinition {
    switch (section) {
      case SecretCategory.Secrets:
        return VaultSections.secrets();
      case SecretCategory.PersonalData:
        return VaultSections.personalData();
    }
  }

  private static entry(
    request: VaultSectionTypeRequest,
  ): VaultSectionTypeEntry {
    return { ...request, testId: secret_type_name(request.type) };
  }

  private static secrets(): VaultSectionDefinition {
    return {
      section: SecretCategory.Secrets,
      allFilter: VaultSections.allFilter(SecretCategory.Secrets),
      testId: "secrets",
      copy: {
        tabKey: I18N_KEYS.VaultSectionsSecrets,
        addKey: I18N_KEYS.VaultAddSecret,
        searchKey: I18N_KEYS.VaultSearchPlaceholder,
        filterGroupKey: I18N_KEYS.VaultFilterByType,
        countKey: I18N_KEYS.VaultSecretCount,
        countPageKey: I18N_KEYS.VaultSecretCountPage,
        listKey: I18N_KEYS.VaultDetailListLabel,
        emptyTitleKey: I18N_KEYS.VaultDetailEmptyTitle,
        emptyBodyKey: I18N_KEYS.VaultDetailEmptyBody,
        noMatchTitleKey: I18N_KEYS.VaultNoSecrets,
      },
      types: SECRETS_TYPES.map((request: VaultSectionTypeRequest) =>
        VaultSections.entry(request),
      ),
    };
  }

  private static personalData(): VaultSectionDefinition {
    return {
      section: SecretCategory.PersonalData,
      allFilter: VaultSections.allFilter(SecretCategory.PersonalData),
      testId: "personal-data",
      copy: {
        tabKey: I18N_KEYS.VaultSectionsPersonalData,
        addKey: I18N_KEYS.VaultAddPersonalData,
        searchKey: I18N_KEYS.VaultPersonalSearchPlaceholder,
        filterGroupKey: I18N_KEYS.VaultFilterPersonalByType,
        countKey: I18N_KEYS.VaultPersonalCount,
        countPageKey: I18N_KEYS.VaultPersonalCountPage,
        listKey: I18N_KEYS.VaultDetailPersonalListLabel,
        emptyTitleKey: I18N_KEYS.VaultDetailPersonalEmptyTitle,
        emptyBodyKey: I18N_KEYS.VaultDetailPersonalEmptyBody,
        noMatchTitleKey: I18N_KEYS.VaultNoPersonalData,
      },
      types: PERSONAL_DATA_TYPES.map((request: VaultSectionTypeRequest) =>
        VaultSections.entry(request),
      ),
    };
  }
}
