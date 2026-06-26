const EN_JSON: &str = include_str!("../locales/en.json");
const RU_JSON: &str = include_str!("../locales/ru.json");

/// Returns the entire JSON catalog for the requested locale.
#[must_use]
pub fn get_translation_catalog(locale: &str) -> &'static str {
    match locale {
        "ru" | "ru-RU" => RU_JSON,
        _ => EN_JSON,
    }
}

/// Translates a key for the given locale, with fallback to English if not found.
#[must_use]
pub fn translate(locale: &str, key: &str) -> String {
    if let Some(val) = lookup_key(get_translation_catalog(locale), key) {
        return val;
    }
    if locale == "en" {
        key.to_string()
    } else {
        lookup_key(EN_JSON, key).unwrap_or_else(|| key.to_string())
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
}
