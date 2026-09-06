#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]
//! Provider metadata recognition and note enrichment retain exact source rules.
struct ImportMetadataMarker {
    heading: &'static str,
    key_prefixes: &'static [&'static str],
}

const BITWARDEN_METADATA: ImportMetadataMarker = ImportMetadataMarker {
    heading: "## Bitwarden",
    key_prefixes: &["totp:", "uri[", "field.", "field["],
};
const ONEPASSWORD_METADATA: ImportMetadataMarker = ImportMetadataMarker {
    heading: "## 1Password",
    key_prefixes: &[
        "format: 1PUX",
        "vault:",
        "state:",
        "tags:",
        "url.",
        "url[",
        "field[",
    ],
};
const LASTPASS_METADATA: ImportMetadataMarker = ImportMetadataMarker {
    heading: "## LastPass",
    key_prefixes: &["group:", "favorite:", "totp:"],
};
const PROTON_PASS_METADATA: ImportMetadataMarker = ImportMetadataMarker {
    heading: "## Proton Pass",
    key_prefixes: &[
        "vault:",
        "state:",
        "pinned:",
        "email:",
        "totp:",
        "url[",
        "field.",
        "field[",
        "passkeys_skipped:",
        "attachments_skipped:",
    ],
};
const BROWSER_METADATA: ImportMetadataMarker = ImportMetadataMarker {
    heading: "## Browser password manager",
    key_prefixes: &["name:"],
};
const APPLE_PASSWORDS_METADATA: ImportMetadataMarker = ImportMetadataMarker {
    heading: "## Apple Passwords",
    key_prefixes: &["title:"],
};

const IMPORT_METADATA_MARKERS: [&ImportMetadataMarker; 4] = [
    &BITWARDEN_METADATA,
    &ONEPASSWORD_METADATA,
    &LASTPASS_METADATA,
    &PROTON_PASS_METADATA,
];
const LOGIN_IMPORT_METADATA_MARKERS: [&ImportMetadataMarker; 6] = [
    &BITWARDEN_METADATA,
    &ONEPASSWORD_METADATA,
    &LASTPASS_METADATA,
    &PROTON_PASS_METADATA,
    &BROWSER_METADATA,
    &APPLE_PASSWORDS_METADATA,
];

#[derive(Clone, Copy)]
pub(super) enum ImportMetadataPolicy {
    General,
    Login,
}
impl ImportMetadataPolicy {
    fn markers(&self) -> &'static [&'static ImportMetadataMarker] {
        match self {
            Self::General => &IMPORT_METADATA_MARKERS,
            Self::Login => &LOGIN_IMPORT_METADATA_MARKERS,
        }
    }
}
pub(super) struct FingerprintText<'a> {
    value: &'a str,
}
impl<'a> FingerprintText<'a> {
    pub(super) fn new(value: &'a str) -> Self {
        Self { value }
    }
    pub(super) fn normalized(&self) -> String {
        self.value.replace("\r\n", "\n").trim().to_owned()
    }
}
impl ImportMetadataMarker {
    fn recognizes(&self, bullet: &str) -> bool {
        let is_dotted_onepassword_field = self.heading == "## 1Password"
            && bullet
                .split_once(':')
                .is_some_and(|(key, _)| key.contains('.'));
        is_dotted_onepassword_field
            || self
                .key_prefixes
                .iter()
                .any(|prefix| bullet.starts_with(prefix))
    }
    fn section_index(&self, normalized: &str) -> Option<usize> {
        normalized
            .match_indices(self.heading)
            .find_map(|(index, _)| {
                if index != 0 && !normalized[..index].ends_with("\n\n") {
                    return None;
                }
                let metadata = normalized[index + self.heading.len()..].strip_prefix('\n')?;
                let first_bullet = metadata.strip_prefix("- ")?.lines().next()?;
                self.recognizes(first_bullet).then_some(index)
            })
    }
}
pub(super) struct ProviderNotes<'a> {
    pub(super) text: &'a str,
    pub(super) policy: ImportMetadataPolicy,
}
impl ProviderNotes<'_> {
    pub(super) fn neutral(&self) -> String {
        let normalized = FingerprintText::new(self.text).normalized();
        let marker_index = self
            .policy
            .markers()
            .iter()
            .filter_map(|marker| marker.section_index(&normalized))
            .min();
        marker_index.map_or(normalized.clone(), |index| {
            normalized[..index].trim_end().to_owned()
        })
    }
    pub(super) fn merge(&self, incoming: &str) -> String {
        let existing = FingerprintText::new(self.text).normalized();
        let incoming = FingerprintText::new(incoming).normalized();
        if incoming.is_empty() || existing == incoming || existing.contains(&incoming) {
            existing
        } else if existing.is_empty() || incoming.contains(&existing) {
            incoming
        } else {
            let existing_base = ProviderNotes {
                text: &existing,
                policy: self.policy,
            }
            .neutral();
            let incoming_base = ProviderNotes {
                text: &incoming,
                policy: self.policy,
            }
            .neutral();
            if existing_base == incoming_base {
                let incoming_metadata = incoming[incoming_base.len()..].trim();
                if incoming_metadata.is_empty() || existing.contains(incoming_metadata) {
                    existing
                } else {
                    format!("{existing}\n\n{incoming_metadata}")
                }
            } else {
                format!("{existing}\n\n{incoming}")
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{FingerprintText, ImportMetadataPolicy, ProviderNotes};

    #[test]
    fn normalization_changes_crlf_and_edge_whitespace_only() {
        assert_eq!(
            FingerprintText::new(" \r\nA\r\nB\rC \t").normalized(),
            "A\nB\rC"
        );
        assert_eq!(
            FingerprintText::new("Mixed CASE\t inside").normalized(),
            "Mixed CASE\t inside"
        );
    }

    #[test]
    fn recognition_requires_a_heading_boundary_and_the_first_generated_bullet() {
        for text in [
            "user ## LastPass\n- group: Work",
            "user\n## LastPass\n- group: Work",
            "user\n\n## LastPass suffix\n- group: Work",
            "user\n\n## LastPass\nparagraph\n- group: Work",
            "user\n\n## LastPass\n- diary: first\n- group: Work",
            "user\n\n## lastpass\n- group: Work",
        ] {
            assert_eq!(
                (ProviderNotes {
                    text,
                    policy: ImportMetadataPolicy::General
                })
                .neutral(),
                text
            );
        }
        for text in [
            "user\n\n## LastPass\n- group: Work",
            "user\n\n## LastPass\n- group: Work\nuser tail",
        ] {
            assert_eq!(
                (ProviderNotes {
                    text,
                    policy: ImportMetadataPolicy::General
                })
                .neutral(),
                "user"
            );
        }
    }

    #[test]
    fn earliest_recognized_section_wins_independently_of_marker_list_order() {
        let text = "note\n\n## Proton Pass\n- vault: first\n\n## Bitwarden\n- field.PIN: second";
        assert_eq!(
            (ProviderNotes {
                text,
                policy: ImportMetadataPolicy::General
            })
            .neutral(),
            "note"
        );
        let text = "## LastPass\n- group: Work";
        assert_eq!(
            (ProviderNotes {
                text,
                policy: ImportMetadataPolicy::General
            })
            .neutral(),
            ""
        );
    }

    #[test]
    fn dotted_fields_are_recognized_only_for_onepassword_and_require_a_colon() {
        for (text, expected) in [
            ("note\n\n## 1Password\n- Security.TOTP: value", "note"),
            (
                "note\n\n## 1Password\n- Security.TOTP",
                "note\n\n## 1Password\n- Security.TOTP",
            ),
            (
                "note\n\n## LastPass\n- Security.TOTP: value",
                "note\n\n## LastPass\n- Security.TOTP: value",
            ),
        ] {
            assert_eq!(
                (ProviderNotes {
                    text,
                    policy: ImportMetadataPolicy::General
                })
                .neutral(),
                expected
            );
        }
    }

    #[test]
    fn browser_and_apple_markers_are_login_specific() {
        for text in [
            "note\n\n## Browser password manager\n- name: Example",
            "note\n\n## Apple Passwords\n- title: Example",
        ] {
            assert_eq!(
                (ProviderNotes {
                    text,
                    policy: ImportMetadataPolicy::General
                })
                .neutral(),
                text
            );
            assert_eq!(
                (ProviderNotes {
                    text,
                    policy: ImportMetadataPolicy::Login
                })
                .neutral(),
                "note"
            );
        }
    }

    #[test]
    fn merge_preserves_containment_rules_and_incoming_order() {
        for (existing, incoming, expected) in [
            (" A ", "", "A"),
            ("A", " A ", "A"),
            ("ABC", "B", "ABC"),
            ("", " B ", "B"),
            ("B", "ABC", "ABC"),
            ("A", "B", "A\n\nB"),
            ("A\r\nline", "B", "A\nline\n\nB"),
        ] {
            assert_eq!(
                (ProviderNotes {
                    text: existing,
                    policy: ImportMetadataPolicy::General
                })
                .merge(incoming),
                expected
            );
        }
    }

    #[test]
    fn matching_bases_append_only_new_metadata_and_remain_idempotent() {
        let existing = "note\n\n## LastPass\n- group: Work";
        let incoming = "note\n\n## Proton Pass\n- vault: Personal";
        let merged = (ProviderNotes {
            text: existing,
            policy: ImportMetadataPolicy::General,
        })
        .merge(incoming);
        assert_eq!(
            merged,
            "note\n\n## LastPass\n- group: Work\n\n## Proton Pass\n- vault: Personal"
        );
        assert_eq!(
            (ProviderNotes {
                text: &merged,
                policy: ImportMetadataPolicy::General
            })
            .merge(incoming),
            merged
        );
        assert_eq!(
            (ProviderNotes {
                text: existing,
                policy: ImportMetadataPolicy::General
            })
            .merge("note"),
            existing
        );
    }
}
