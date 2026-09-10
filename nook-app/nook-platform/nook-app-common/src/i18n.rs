use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

const EN_JSON: &str = include_str!("../locales/en.json");
const RU_JSON: &str = include_str!("../locales/ru.json");

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AppLocale {
    English,
    Russian,
    Unsupported,
}

/// Locale that can be selected and persisted by the application.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, tsify::Tsify)]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub enum SupportedAppLocale {
    #[serde(rename = "en")]
    English,
    #[serde(rename = "ru")]
    Russian,
}
impl SupportedAppLocale {
    pub const fn code(self) -> &'static str {
        match self {
            Self::English => "en",
            Self::Russian => "ru",
        }
    }
    pub fn resolve<'a>(tags: impl IntoIterator<Item = &'a str>) -> Self {
        tags.into_iter()
            .find_map(|tag| Self::try_from(AppLocale::resolve_app_locale_from_tag(tag)).ok())
            .unwrap_or(Self::English)
    }
}
impl TryFrom<AppLocale> for SupportedAppLocale {
    type Error = &'static str;
    fn try_from(locale: AppLocale) -> Result<Self, Self::Error> {
        match locale {
            AppLocale::English => Ok(Self::English),
            AppLocale::Russian => Ok(Self::Russian),
            AppLocale::Unsupported => {
                Err("unsupported locale does not have an application locale code")
            }
        }
    }
}

/// Parsed translation data; raw JSON is decoded once at the catalog boundary.
#[derive(Serialize, Deserialize)]
#[serde(transparent)]
pub struct TranslationCatalog {
    document: TranslationNode,
}

/// Typed recursive catalog wire nodes preserve scalar and array merge semantics.
#[derive(Serialize, Deserialize)]
#[serde(untagged)]
enum TranslationNode {
    Text(String),
    Number(serde_json::Number),
    Boolean(bool),
    Array(Vec<TranslationNode>),
    Null,
    Group(BTreeMap<String, TranslationNode>),
}
impl TranslationNode {
    fn overlay(self, overlay: Self) -> Self {
        match (self, overlay) {
            (Self::Group(mut base), Self::Group(overlay)) => {
                for (key, value) in overlay {
                    let updated = match base.remove(&key) {
                        Some(existing) => existing.overlay(value),
                        None => value,
                    };
                    base.insert(key, updated);
                }
                Self::Group(base)
            }
            (_, overlay) => overlay,
        }
    }
}

/// Named values required by TranslationCatalog::lookup_translation.
pub struct LookupTranslationRequest<'a> {
    pub catalog_json: &'a str,
    pub key: &'a str,
}

/// Named values required by TranslationCatalog::translate_from_catalog.
pub struct TranslateFromCatalogRequest<'a> {
    pub catalog_json: &'a str,
    pub locale: &'a str,
    pub key: &'a str,
}

/// Named values required by TranslationCatalog::translate_with_replacements.
pub struct TranslateWithReplacementsRequest<'a> {
    pub catalog_json: &'a str,
    pub locale: &'a str,
    pub key: &'a str,
    pub replacements: &'a [(String, String)],
}

/// Named values required by TranslationCatalog::resolve_error_message.
pub struct ResolveErrorMessageRequest<'a> {
    pub catalog_json: &'a str,
    pub locale: &'a str,
    pub message: &'a str,
}

/// Named values required by TranslationCatalog::merge_translation_catalogs.
pub struct MergeTranslationCatalogsRequest<'a> {
    pub base_json: &'a str,
    pub overlay_json: &'a str,
}

/// Named values required by TranslationCatalog::resolve_translation_catalog.
pub enum TranslationCatalogSource<'a> {
    Bundled,
    Supplied(&'a str),
}
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TranslationLookup {
    Found(String),
    Missing,
    InvalidCatalog,
}
enum TranslationPrefixMatch<'a> {
    Unmatched,
    Remainder(&'a str),
}

pub struct ResolveTranslationCatalogRequest<'a> {
    pub locale: &'a str,
    pub wasm_catalog_json: TranslationCatalogSource<'a>,
}

/// Named values required by TranslationCatalog::translate.
pub struct TranslateRequest<'a> {
    pub locale: &'a str,
    pub key: &'a str,
}

/// Named values required by TranslationCatalog::lookup_key.
struct LookupKeyRequest<'a> {
    json_str: &'a str,
    key: &'a str,
}

struct TranslationPrefix<'a> {
    value: &'a str,
    prefix: &'a str,
}

impl TranslationCatalog {
    pub fn parse(catalog_json: &str) -> serde_json::Result<Self> {
        serde_json::from_str(catalog_json).map(|document| Self { document })
    }
    pub fn lookup(&self, key: &str) -> TranslationLookup {
        let mut current = &self.document;
        for part in key.split('.') {
            let TranslationNode::Group(group) = current else {
                return TranslationLookup::Missing;
            };
            let Some(next) = group.get(part) else {
                return TranslationLookup::Missing;
            };
            current = next;
        }
        match current {
            TranslationNode::Text(text) => TranslationLookup::Found(text.clone()),
            TranslationNode::Group(_)
            | TranslationNode::Number(_)
            | TranslationNode::Boolean(_)
            | TranslationNode::Array(_)
            | TranslationNode::Null => TranslationLookup::Missing,
        }
    }
}

impl AppLocale {
    #[must_use]
    pub const fn code(self) -> &'static str {
        match self {
            Self::English => "en",
            Self::Russian => "ru",
            Self::Unsupported => "unsupported",
        }
    }

    #[must_use]
    pub const fn is_supported(self) -> bool {
        !matches!(self, Self::Unsupported)
    }
}

/// Returns a supported app locale for exact stored locale values.
impl AppLocale {
    #[must_use]
    pub fn parse_app_locale(value: &str) -> AppLocale {
        match value {
            "en" => AppLocale::English,
            "ru" => AppLocale::Russian,
            _ => AppLocale::Unsupported,
        }
    }
}

/// Maps a BCP 47 language tag to a supported app locale, if any.
impl AppLocale {
    #[must_use]
    pub fn resolve_app_locale_from_tag(tag: &str) -> AppLocale {
        let normalized = tag.trim().to_lowercase().replace('_', "-");
        if normalized.is_empty() {
            return AppLocale::Unsupported;
        }

        match normalized.split('-').next() {
            Some(language) => AppLocale::parse_app_locale(language),
            None => AppLocale::Unsupported,
        }
    }
}

/// Picks the first supported locale from an ordered language tag list.
impl AppLocale {
    #[must_use]
    pub fn resolve_app_locale_from_tags<'a>(
        tags: impl IntoIterator<Item = &'a str>,
    ) -> &'static str {
        SupportedAppLocale::resolve(tags).code()
    }
}

/// Returns the entire JSON catalog for the requested locale.
impl AppLocale {
    #[must_use]
    pub fn get_translation_catalog(locale: &str) -> &'static str {
        match locale {
            "ru" | "ru-RU" => RU_JSON,
            _ => EN_JSON,
        }
    }
}

/// Looks up a string key in a JSON translation catalog.
impl TranslationCatalog {
    #[must_use]
    pub fn lookup_translation(request: LookupTranslationRequest<'_>) -> TranslationLookup {
        let LookupTranslationRequest { catalog_json, key } = request;
        TranslationCatalog::lookup_key(LookupKeyRequest {
            json_str: catalog_json,
            key: key,
        })
    }
}

/// Translates a key from a resolved catalog, with fallback to English if not found.
impl TranslationCatalog {
    #[must_use]
    pub fn translate_from_catalog(request: TranslateFromCatalogRequest<'_>) -> String {
        let TranslateFromCatalogRequest {
            catalog_json,
            locale,
            key,
        } = request;
        if let TranslationLookup::Found(val) =
            TranslationCatalog::lookup_translation(LookupTranslationRequest {
                catalog_json: catalog_json,
                key: key,
            })
        {
            return val;
        }
        if locale == "en" {
            key.to_string()
        } else {
            match TranslationCatalog::lookup_translation(LookupTranslationRequest {
                catalog_json: EN_JSON,
                key: key,
            }) {
                TranslationLookup::Found(value) => value,
                TranslationLookup::Missing | TranslationLookup::InvalidCatalog => key.to_owned(),
            }
        }
    }
}

/// Translates a key and replaces named placeholders in the resulting message.
impl TranslationCatalog {
    #[must_use]
    pub fn translate_with_replacements(request: TranslateWithReplacementsRequest<'_>) -> String {
        let TranslateWithReplacementsRequest {
            catalog_json,
            locale,
            key,
            replacements,
        } = request;
        let mut message = TranslationCatalog::translate_from_catalog(TranslateFromCatalogRequest {
            catalog_json: catalog_json,
            locale: locale,
            key: key,
        });
        for (name, value) in replacements {
            message = message.replacen(&format!("{{{name}}}"), value, 1);
        }
        message
    }
}

/// Removes stable storage-adapter prefixes and translates error keys.
impl TranslationCatalog {
    #[must_use]
    pub fn resolve_error_message(request: ResolveErrorMessageRequest<'_>) -> String {
        let ResolveErrorMessageRequest {
            catalog_json,
            locale,
            message,
        } = request;
        let stripped = ["GitHub error:", "Drive error:", "Database error:"]
            .into_iter()
            .fold(message, |current, prefix| {
                match TranslationCatalog::strip_prefix_ignore_ascii_case(TranslationPrefix {
                    value: current,
                    prefix: prefix,
                }) {
                    TranslationPrefixMatch::Unmatched => current,
                    TranslationPrefixMatch::Remainder(tail) => tail.trim_start(),
                }
            })
            .trim();
        if stripped.starts_with("errors.") {
            return TranslationCatalog::translate_from_catalog(TranslateFromCatalogRequest {
                catalog_json: catalog_json,
                locale: locale,
                key: stripped,
            });
        }
        if message.starts_with("errors.") {
            return TranslationCatalog::translate_from_catalog(TranslateFromCatalogRequest {
                catalog_json: catalog_json,
                locale: locale,
                key: message,
            });
        }
        message.to_owned()
    }
}

/// Deep-merges two JSON catalogs. Overlay wins on scalar and array conflicts.
///
/// This keeps newer bundled keys available when an older wasm/catalog copy is
/// passed in, while preserving keys that only exist in the base catalog.
///
/// # Errors
///
/// Returns an error when either input is not valid JSON or when the merged
/// catalog cannot be serialized.
impl TranslationCatalog {
    pub fn merge_translation_catalogs(
        request: MergeTranslationCatalogsRequest<'_>,
    ) -> serde_json::Result<String> {
        let MergeTranslationCatalogsRequest {
            base_json,
            overlay_json,
        } = request;
        let base = Self::parse(base_json)?;
        let overlay = Self::parse(overlay_json)?;
        let base = Self {
            document: base.document.overlay(overlay.document),
        };
        serde_json::to_string(&base)
    }
}

/// Resolves the active catalog for a locale. The embedded catalog is used as the
/// overlay so bundled keys win when a caller supplies a stale wasm catalog.
impl TranslationCatalog {
    #[must_use]
    pub fn resolve_translation_catalog(request: ResolveTranslationCatalogRequest<'_>) -> String {
        let ResolveTranslationCatalogRequest {
            locale,
            wasm_catalog_json,
        } = request;
        let bundled = AppLocale::get_translation_catalog(locale);
        match wasm_catalog_json {
            TranslationCatalogSource::Supplied(wasm_catalog) => {
                TranslationCatalog::merge_translation_catalogs(MergeTranslationCatalogsRequest {
                    base_json: wasm_catalog,
                    overlay_json: bundled,
                })
                .unwrap_or_else(|_| bundled.to_owned())
            }
            TranslationCatalogSource::Bundled => bundled.to_owned(),
        }
    }
}

/// Translates a key for the given locale, with fallback to English if not found.
impl TranslationCatalog {
    #[must_use]
    pub fn translate(request: TranslateRequest<'_>) -> String {
        let TranslateRequest { locale, key } = request;
        TranslationCatalog::translate_from_catalog(TranslateFromCatalogRequest {
            catalog_json: AppLocale::get_translation_catalog(locale),
            locale: locale,
            key: key,
        })
    }
}

impl TranslationCatalog {
    fn lookup_key(request: LookupKeyRequest<'_>) -> TranslationLookup {
        let LookupKeyRequest { json_str, key } = request;
        match Self::parse(json_str) {
            Ok(catalog) => catalog.lookup(key),
            Err(_) => TranslationLookup::InvalidCatalog,
        }
    }
}

impl TranslationCatalog {
    fn strip_prefix_ignore_ascii_case<'a>(
        request: TranslationPrefix<'a>,
    ) -> TranslationPrefixMatch<'a> {
        let TranslationPrefix { value, prefix } = request;
        match value.get(..prefix.len()) {
            Some(candidate) if candidate.eq_ignore_ascii_case(prefix) => {
                match value.get(prefix.len()..) {
                    Some(tail) => TranslationPrefixMatch::Remainder(tail),
                    None => TranslationPrefixMatch::Unmatched,
                }
            }
            _ => TranslationPrefixMatch::Unmatched,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::i18n_keys;

    #[test]
    fn test_lookup_existing_keys() {
        assert_eq!(
            TranslationCatalog::translate(TranslateRequest {
                locale: "en",
                key: i18n_keys::COMMON_BACK
            }),
            "Back"
        );
        assert_eq!(
            TranslationCatalog::translate(TranslateRequest {
                locale: "ru",
                key: i18n_keys::COMMON_BACK
            }),
            "Назад"
        );
        assert_eq!(
            TranslationCatalog::translate(TranslateRequest {
                locale: "en",
                key: i18n_keys::ONBOARD_DEVICE_SENTINEL_READINESS_COUNT
            }),
            "{ready} of {required} participants ready"
        );
        assert_eq!(
            TranslationCatalog::translate(TranslateRequest {
                locale: "ru",
                key: i18n_keys::ONBOARD_DEVICE_SENTINEL_READINESS_LABEL
            }),
            "Готовность участников"
        );
    }

    #[test]
    fn test_fallback_to_english() {
        // Test key that exists in English but not in Russian (if we hypothetically added one)
        assert_eq!(
            TranslationCatalog::translate(TranslateRequest {
                locale: "ru",
                key: "nonexistent.key.path"
            }),
            "nonexistent.key.path"
        );
    }

    #[test]
    fn test_secret_count_labels() {
        assert_eq!(
            TranslationCatalog::translate(TranslateRequest {
                locale: "en",
                key: i18n_keys::VAULT_SECRET_COUNT
            }),
            "Secrets: {count}"
        );
        assert_eq!(
            TranslationCatalog::translate(TranslateRequest {
                locale: "ru",
                key: i18n_keys::VAULT_SECRET_COUNT
            }),
            "секретов: {count}"
        );
    }

    #[test]
    fn test_catalog_retrieval() {
        let en_catalog = AppLocale::get_translation_catalog("en");
        let ru_catalog = AppLocale::get_translation_catalog("ru");
        assert!(en_catalog.contains("Unlock your vault"));
        assert!(ru_catalog.contains("Разблокировать сейф"));
    }

    #[test]
    fn test_lookup_translation_reads_nested_catalog_key() {
        assert_eq!(
            TranslationCatalog::lookup_translation(LookupTranslationRequest {
                catalog_json: AppLocale::get_translation_catalog("en"),
                key: i18n_keys::PROVIDER_PICKER_GOOGLE_DRIVE
            }),
            TranslationLookup::Found("Google Drive".to_owned())
        );
    }

    #[test]
    fn test_translate_from_catalog_falls_back_to_english() {
        let stale_ru = r#"{"provider_picker":{"github":"GitHub"}}"#;
        assert_eq!(
            TranslationCatalog::translate_from_catalog(TranslateFromCatalogRequest {
                catalog_json: stale_ru,
                locale: "ru",
                key: i18n_keys::PROVIDER_PICKER_GOOGLE_DRIVE
            }),
            "Google Drive"
        );
        assert_eq!(
            TranslationCatalog::translate_from_catalog(TranslateFromCatalogRequest {
                catalog_json: stale_ru,
                locale: "en",
                key: i18n_keys::PROVIDER_PICKER_GOOGLE_DRIVE
            }),
            i18n_keys::PROVIDER_PICKER_GOOGLE_DRIVE
        );
    }

    #[test]
    fn translation_replacements_and_error_messages_are_portable() {
        assert_eq!(
            TranslationCatalog::translate_with_replacements(TranslateWithReplacementsRequest {
                catalog_json: AppLocale::get_translation_catalog("en"),
                locale: "en",
                key: i18n_keys::VAULT_SECRET_COUNT,
                replacements: &[("count".to_owned(), "3".to_owned())]
            }),
            "Secrets: 3"
        );
        assert_eq!(
            TranslationCatalog::translate_with_replacements(TranslateWithReplacementsRequest {
                catalog_json: r#"{"message":"{value} {value}"}"#,
                locale: "en",
                key: "message",
                replacements: &[("value".to_owned(), "first".to_owned())]
            }),
            "first {value}"
        );
        assert_eq!(
            TranslationCatalog::resolve_error_message(ResolveErrorMessageRequest {
                catalog_json: AppLocale::get_translation_catalog("en"),
                locale: "en",
                message: "GitHub error: Drive error: errors.engine_unavailable"
            }),
            "Vault engine is not available. Refresh the page and try again."
        );
        assert_eq!(
            TranslationCatalog::resolve_error_message(ResolveErrorMessageRequest {
                catalog_json: "{}",
                locale: "en",
                message: "Drive error: unavailable"
            }),
            "Drive error: unavailable"
        );
    }

    #[test]
    fn test_merge_translation_catalogs_overlay_wins_recursively() -> serde_json::Result<()> {
        let base = r#"{"provider_picker":{"this_device":"Это устройство","github":"GitHub"}}"#;
        let overlay =
            r#"{"provider_picker":{"github":"GitHub updated","google_drive":"Google Drive"}}"#;
        let merged =
            TranslationCatalog::merge_translation_catalogs(MergeTranslationCatalogsRequest {
                base_json: base,
                overlay_json: overlay,
            })?;
        assert_eq!(
            TranslationCatalog::lookup_translation(LookupTranslationRequest {
                catalog_json: &merged,
                key: i18n_keys::PROVIDER_PICKER_THIS_DEVICE
            }),
            TranslationLookup::Found("Это устройство".to_owned())
        );
        assert_eq!(
            TranslationCatalog::lookup_translation(LookupTranslationRequest {
                catalog_json: &merged,
                key: i18n_keys::PROVIDER_PICKER_GITHUB
            }),
            TranslationLookup::Found("GitHub updated".to_owned())
        );
        assert_eq!(
            TranslationCatalog::lookup_translation(LookupTranslationRequest {
                catalog_json: &merged,
                key: i18n_keys::PROVIDER_PICKER_GOOGLE_DRIVE
            }),
            TranslationLookup::Found("Google Drive".to_owned())
        );
        Ok(())
    }

    #[test]
    fn test_resolve_translation_catalog_overlays_bundled_keys() {
        let stale_ru = r#"{"provider_picker":{"this_device":"Это устройство","github":"GitHub"}}"#;
        let resolved =
            TranslationCatalog::resolve_translation_catalog(ResolveTranslationCatalogRequest {
                locale: "ru",
                wasm_catalog_json: TranslationCatalogSource::Supplied(stale_ru),
            });
        assert_eq!(
            TranslationCatalog::lookup_translation(LookupTranslationRequest {
                catalog_json: &resolved,
                key: i18n_keys::PROVIDER_PICKER_GOOGLE_DRIVE
            }),
            TranslationLookup::Found("Google Drive".to_owned())
        );
        assert_eq!(
            TranslationCatalog::lookup_translation(LookupTranslationRequest {
                catalog_json: &resolved,
                key: i18n_keys::PROVIDER_PICKER_THIS_DEVICE
            }),
            TranslationLookup::Found("Это устройство".to_owned())
        );
    }

    #[test]
    fn test_extension_catalog_keys_and_english_fallback() {
        assert_eq!(
            TranslationCatalog::translate(TranslateRequest {
                locale: "en",
                key: i18n_keys::EXTENSION_POPUP_PASSWORD_FIELDS
            }),
            "Password fields"
        );
        assert_eq!(
            TranslationCatalog::translate(TranslateRequest {
                locale: "ru",
                key: i18n_keys::EXTENSION_POPUP_PASSWORD_FIELDS
            }),
            "Поля пароля"
        );
        assert_eq!(
            TranslationCatalog::translate(TranslateRequest {
                locale: "ru",
                key: i18n_keys::EXTENSION_SETUP_PROFILE_TITLE
            }),
            "Расширение Nook - этот профиль браузера"
        );

        let stale_ru = r#"{"extension":{"popup":{"scan":"Сканировать"}}}"#;
        assert_eq!(
            TranslationCatalog::translate_from_catalog(TranslateFromCatalogRequest {
                catalog_json: stale_ru,
                locale: "ru",
                key: i18n_keys::EXTENSION_POPUP_SUGGESTED_PASSWORD
            }),
            "Suggested password"
        );
    }

    #[test]
    fn test_import_source_labels_do_not_repeat_the_import_action() {
        let sources = [
            (
                i18n_keys::APPLE_PASSWORDS_IMPORT_SOURCE,
                "Safari / Apple Passwords",
            ),
            (
                i18n_keys::CHROME_PASSWORDS_IMPORT_SOURCE,
                "Chrome or another browser",
            ),
            (i18n_keys::DASHLANE_IMPORT_SOURCE, "Dashlane"),
            (
                i18n_keys::GOOGLE_AUTHENTICATOR_IMPORT_SOURCE,
                "Google Authenticator",
            ),
            (i18n_keys::BITWARDEN_IMPORT_SOURCE, "Bitwarden"),
            (i18n_keys::KEEPASSXC_IMPORT_SOURCE, "KeePassXC"),
            (i18n_keys::LASTPASS_IMPORT_SOURCE, "LastPass"),
            (i18n_keys::ONEPASSWORD_IMPORT_SOURCE, "1Password"),
            (i18n_keys::PROTON_PASS_IMPORT_SOURCE, "Proton Pass"),
            (i18n_keys::KEEPER_IMPORT_SOURCE, "Keeper"),
        ];

        for (key, expected) in sources {
            assert_eq!(
                TranslationCatalog::translate(TranslateRequest {
                    locale: "en",
                    key: key
                }),
                expected
            );
            assert!(
                !TranslationCatalog::translate(TranslateRequest {
                    locale: "en",
                    key: key
                })
                .starts_with("Import from ")
            );
            assert!(
                !TranslationCatalog::translate(TranslateRequest {
                    locale: "ru",
                    key: key
                })
                .starts_with("Импорт из ")
            );
        }
    }

    #[test]
    fn test_parse_app_locale_accepts_exact_supported_values() {
        assert_eq!(AppLocale::parse_app_locale("en"), AppLocale::English);
        assert_eq!(AppLocale::parse_app_locale("ru"), AppLocale::Russian);
        assert_eq!(AppLocale::parse_app_locale("en-US"), AppLocale::Unsupported);
        assert_eq!(AppLocale::parse_app_locale(" de "), AppLocale::Unsupported);
    }

    #[test]
    fn test_resolve_app_locale_from_tag_maps_bcp_47_tags() {
        assert_eq!(
            AppLocale::resolve_app_locale_from_tag("ru-RU"),
            AppLocale::Russian
        );
        assert_eq!(
            AppLocale::resolve_app_locale_from_tag("ru_BY"),
            AppLocale::Russian
        );
        assert_eq!(
            AppLocale::resolve_app_locale_from_tag("en-GB"),
            AppLocale::English
        );
        assert_eq!(
            AppLocale::resolve_app_locale_from_tag(" de-DE "),
            AppLocale::Unsupported
        );
    }

    #[test]
    fn test_resolve_app_locale_from_tags_respects_preference_order() {
        assert_eq!(
            AppLocale::resolve_app_locale_from_tags(["de-DE", "ru-RU"]),
            "ru"
        );
        assert_eq!(
            AppLocale::resolve_app_locale_from_tags(["de-DE", "fr-FR"]),
            "en"
        );
        assert_eq!(
            AppLocale::resolve_app_locale_from_tags(["en-US", "ru-RU"]),
            "en"
        );
    }
    #[test]
    fn heterogeneous_catalog_merge_preserves_unrelated_translation_nodes() -> serde_json::Result<()>
    {
        let merged = TranslationCatalog::merge_translation_catalogs(
            MergeTranslationCatalogsRequest {
                base_json: r#"{"custom":{"text":"kept","array":[1,true,null]},"number":1,"flag":false,"empty":null,"replace":{"old":"value"}}"#,
                overlay_json: r#"{"custom":{"added":"new"},"number":2,"flag":true,"replace":["replacement"],"text":"visible"}"#,
            },
        )?;
        let catalog = TranslationCatalog::parse(&merged)?;
        assert_eq!(
            catalog.lookup("custom.text"),
            TranslationLookup::Found("kept".to_owned())
        );
        assert_eq!(
            catalog.lookup("custom.added"),
            TranslationLookup::Found("new".to_owned())
        );
        for key in ["number", "flag", "empty", "replace", "custom.array"] {
            assert_eq!(catalog.lookup(key), TranslationLookup::Missing);
        }
        // The exact wire round trip proves non-text nodes were preserved,
        // rather than merely ignored by lookup.
        assert_eq!(
            serde_json::to_string(&catalog)?,
            r#"{"custom":{"added":"new","array":[1,true,null],"text":"kept"},"empty":null,"flag":true,"number":2,"replace":["replacement"],"text":"visible"}"#
        );
        Ok(())
    }
}
