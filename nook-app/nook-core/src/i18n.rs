const EN_JSON: &str = include_str!("../locales/en.json");
const RU_JSON: &str = include_str!("../locales/ru.json");

/// Returns a supported app locale for exact stored locale values.
#[must_use]
pub fn parse_app_locale(value: &str) -> Option<&'static str> {
    match value {
        "en" => Some("en"),
        "ru" => Some("ru"),
        _ => None,
    }
}

/// Maps a BCP 47 language tag to a supported app locale, if any.
#[must_use]
pub fn resolve_app_locale_from_tag(tag: &str) -> Option<&'static str> {
    let normalized = tag.trim().to_lowercase().replace('_', "-");
    if normalized.is_empty() {
        return None;
    }

    let language = normalized.split('-').next()?;
    parse_app_locale(language)
}

/// Picks the first supported locale from an ordered language tag list.
#[must_use]
pub fn resolve_app_locale_from_tags<'a>(tags: impl IntoIterator<Item = &'a str>) -> &'static str {
    tags.into_iter()
        .find_map(resolve_app_locale_from_tag)
        .unwrap_or("en")
}

/// Returns the entire JSON catalog for the requested locale.
#[must_use]
pub fn get_translation_catalog(locale: &str) -> &'static str {
    match locale {
        "ru" | "ru-RU" => RU_JSON,
        _ => EN_JSON,
    }
}

/// Looks up a string key in a JSON translation catalog.
#[must_use]
pub fn lookup_translation(catalog_json: &str, key: &str) -> Option<String> {
    lookup_key(catalog_json, key)
}

/// Translates a key from a resolved catalog, with fallback to English if not found.
#[must_use]
pub fn translate_from_catalog(catalog_json: &str, locale: &str, key: &str) -> String {
    if let Some(val) = lookup_translation(catalog_json, key) {
        return val;
    }
    if locale == "en" {
        key.to_string()
    } else {
        lookup_translation(EN_JSON, key).unwrap_or_else(|| key.to_string())
    }
}

/// Deep-merges two JSON catalogs. Overlay wins on scalar and array conflicts.
///
/// This keeps newer bundled keys available when an older wasm/catalog copy is
/// passed in, while preserving keys that only exist in the base catalog.
pub fn merge_translation_catalogs(
    base_json: &str,
    overlay_json: &str,
) -> Result<String, serde_json::Error> {
    let mut base: serde_json::Value = serde_json::from_str(base_json)?;
    let overlay: serde_json::Value = serde_json::from_str(overlay_json)?;
    merge_json_values(&mut base, overlay);
    serde_json::to_string(&base)
}

/// Resolves the active catalog for a locale. The embedded catalog is used as the
/// overlay so bundled keys win when a caller supplies a stale wasm catalog.
#[must_use]
pub fn resolve_translation_catalog(locale: &str, wasm_catalog_json: Option<&str>) -> String {
    let bundled = get_translation_catalog(locale);
    match wasm_catalog_json {
        Some(wasm_catalog) => {
            merge_translation_catalogs(wasm_catalog, bundled).unwrap_or_else(|_| bundled.to_owned())
        }
        None => bundled.to_owned(),
    }
}

/// Translates a key for the given locale, with fallback to English if not found.
#[must_use]
pub fn translate(locale: &str, key: &str) -> String {
    translate_from_catalog(get_translation_catalog(locale), locale, key)
}

fn merge_json_values(base: &mut serde_json::Value, overlay: serde_json::Value) {
    if let (Some(base_map), serde_json::Value::Object(overlay_map)) =
        (base.as_object_mut(), overlay)
    {
        for (key, overlay_value) in overlay_map {
            match base_map.get_mut(&key) {
                Some(base_value) if base_value.is_object() && overlay_value.is_object() => {
                    merge_json_values(base_value, overlay_value);
                }
                _ => {
                    base_map.insert(key, overlay_value);
                }
            }
        }
    }
}

fn lookup_key(json_str: &str, key: &str) -> Option<String> {
    let val: serde_json::Value = serde_json::from_str(json_str).ok()?;
    let mut current = &val;
    for part in key.split('.') {
        current = current.get(part)?;
    }
    current.as_str().map(String::from)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_lookup_existing_keys() {
        assert_eq!(translate("en", "common.back"), "Back");
        assert_eq!(translate("ru", "common.back"), "Назад");
    }

    #[test]
    fn test_fallback_to_english() {
        // Test key that exists in English but not in Russian (if we hypothetically added one)
        assert_eq!(
            translate("ru", "nonexistent.key.path"),
            "nonexistent.key.path"
        );
    }

    #[test]
    fn test_secret_count_labels() {
        assert_eq!(translate("en", "vault.secret_count"), "Secrets: {count}");
        assert_eq!(translate("ru", "vault.secret_count"), "секретов: {count}");
    }

    #[test]
    fn test_catalog_retrieval() {
        let en_catalog = get_translation_catalog("en");
        let ru_catalog = get_translation_catalog("ru");
        assert!(en_catalog.contains("Unlock your vault"));
        assert!(ru_catalog.contains("Разблокировать сейф"));
    }

    #[test]
    fn test_lookup_translation_reads_nested_catalog_key() {
        assert_eq!(
            lookup_translation(
                get_translation_catalog("en"),
                "provider_picker.google_drive"
            )
            .as_deref(),
            Some("Google Drive")
        );
    }

    #[test]
    fn test_translate_from_catalog_falls_back_to_english() {
        let stale_ru = r#"{"provider_picker":{"github":"GitHub"}}"#;
        assert_eq!(
            translate_from_catalog(stale_ru, "ru", "provider_picker.google_drive"),
            "Google Drive"
        );
        assert_eq!(
            translate_from_catalog(stale_ru, "en", "provider_picker.google_drive"),
            "provider_picker.google_drive"
        );
    }

    #[test]
    fn test_merge_translation_catalogs_overlay_wins_recursively() {
        let base = r#"{"provider_picker":{"this_device":"Это устройство","github":"GitHub"}}"#;
        let overlay =
            r#"{"provider_picker":{"github":"GitHub updated","google_drive":"Google Drive"}}"#;
        let merged = merge_translation_catalogs(base, overlay).expect("catalogs merge");
        assert_eq!(
            lookup_translation(&merged, "provider_picker.this_device").as_deref(),
            Some("Это устройство")
        );
        assert_eq!(
            lookup_translation(&merged, "provider_picker.github").as_deref(),
            Some("GitHub updated")
        );
        assert_eq!(
            lookup_translation(&merged, "provider_picker.google_drive").as_deref(),
            Some("Google Drive")
        );
    }

    #[test]
    fn test_resolve_translation_catalog_overlays_bundled_keys() {
        let stale_ru = r#"{"provider_picker":{"this_device":"Это устройство","github":"GitHub"}}"#;
        let resolved = resolve_translation_catalog("ru", Some(stale_ru));
        assert_eq!(
            lookup_translation(&resolved, "provider_picker.google_drive").as_deref(),
            Some("Google Drive")
        );
        assert_eq!(
            lookup_translation(&resolved, "provider_picker.this_device").as_deref(),
            Some("Это устройство")
        );
    }

    #[test]
    fn test_parse_app_locale_accepts_exact_supported_values() {
        assert_eq!(parse_app_locale("en"), Some("en"));
        assert_eq!(parse_app_locale("ru"), Some("ru"));
        assert_eq!(parse_app_locale("en-US"), None);
        assert_eq!(parse_app_locale(" de "), None);
    }

    #[test]
    fn test_resolve_app_locale_from_tag_maps_bcp_47_tags() {
        assert_eq!(resolve_app_locale_from_tag("ru-RU"), Some("ru"));
        assert_eq!(resolve_app_locale_from_tag("ru_BY"), Some("ru"));
        assert_eq!(resolve_app_locale_from_tag("en-GB"), Some("en"));
        assert_eq!(resolve_app_locale_from_tag(" de-DE "), None);
    }

    #[test]
    fn test_resolve_app_locale_from_tags_respects_preference_order() {
        assert_eq!(resolve_app_locale_from_tags(["de-DE", "ru-RU"]), "ru");
        assert_eq!(resolve_app_locale_from_tags(["de-DE", "fr-FR"]), "en");
        assert_eq!(resolve_app_locale_from_tags(["en-US", "ru-RU"]), "en");
    }
}
