//! Owned compatibility admission for schema-1 and tagged provider snapshots.
use super::{AuthProvidersSnapshotData, NormalizedAuthSnapshot, StorageProviderData};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum ProviderWireMigration {
    Unchanged,
    Migrated,
}
impl ProviderWireMigration {
    fn combine(self, next: Self) -> Self {
        match (self, next) {
            (Self::Unchanged, Self::Unchanged) => Self::Unchanged,
            _ => Self::Migrated,
        }
    }
}
struct ProviderWireValue {
    value: Value,
    migration: ProviderWireMigration,
}
struct ProviderFields {
    fields: Map<String, Value>,
    migration: ProviderWireMigration,
}
struct SemanticProviderField<'a> {
    missing_state: &'a str,
    present_state: &'a str,
}
struct ProviderFieldRead<'a> {
    fields: &'a mut Map<String, Value>,
    name: &'a str,
}
impl SemanticProviderField<'_> {
    fn normalize(self, field: ProviderFieldRead<'_>) -> ProviderWireValue {
        match field.fields.remove(field.name) {
            Some(Value::Object(object)) if object.contains_key("state") => ProviderWireValue {
                value: Value::Object(object),
                migration: ProviderWireMigration::Unchanged,
            },
            Some(Value::String(value)) if !value.trim().is_empty() => ProviderWireValue {
                value: serde_json::json!({"state": self.present_state, "value": value}),
                migration: ProviderWireMigration::Migrated,
            },
            _ => ProviderWireValue {
                value: serde_json::json!({"state": self.missing_state}),
                migration: ProviderWireMigration::Migrated,
            },
        }
    }
}
struct ProviderFieldMigration<'a> {
    name: &'a str,
    semantic: SemanticProviderField<'a>,
}
impl From<Map<String, Value>> for ProviderFields {
    fn from(fields: Map<String, Value>) -> Self {
        Self {
            fields,
            migration: ProviderWireMigration::Unchanged,
        }
    }
}
impl ProviderFields {
    fn field(mut self, field: ProviderFieldMigration<'_>) -> Self {
        let normalized = field.semantic.normalize(ProviderFieldRead {
            fields: &mut self.fields,
            name: field.name,
        });
        self.fields.insert(field.name.to_owned(), normalized.value);
        self.migration = self.migration.combine(normalized.migration);
        self
    }
    fn oauth(mut self) -> Self {
        for (name, missing_state, present_state) in [
            ("accessToken", "signedOut", "accessToken"),
            ("refreshToken", "notIssued", "token"),
            ("expiresAt", "unknown", "expiresAt"),
            ("fileId", "unresolved", "fileId"),
            ("fileName", "unresolved", "fileName"),
            ("accountEmail", "unknown", "email"),
            ("folderId", "root", "folderId"),
            ("iCloudShareTarget", "personal", "sharedTarget"),
        ] {
            self = self.field(ProviderFieldMigration {
                name,
                semantic: SemanticProviderField {
                    missing_state,
                    present_state,
                },
            });
        }
        self
    }
    fn local(self) -> Self {
        self.field(ProviderFieldMigration {
            name: "directoryName",
            semantic: SemanticProviderField {
                missing_state: "unnamed",
                present_state: "directoryName",
            },
        })
        .field(ProviderFieldMigration {
            name: "handleId",
            semantic: SemanticProviderField {
                missing_state: "unbound",
                present_state: "handleId",
            },
        })
    }
    fn configuration(mut self, kind: ProviderConfiguration) -> Self {
        let field = kind.field();
        let normalized = match self.fields.remove(field) {
            Some(Value::Object(mut object)) if object.contains_key("state") => {
                let mut migration = ProviderWireMigration::Unchanged;
                if let Some(config) = object.remove("config") {
                    let normalized = match config {
                        Value::Object(config) => kind.normalize(ProviderFields::from(config)),
                        value => ProviderWireValue {
                            value,
                            migration: ProviderWireMigration::Unchanged,
                        },
                    };
                    migration = normalized.migration;
                    object.insert("config".to_owned(), normalized.value);
                }
                ProviderWireValue {
                    value: Value::Object(object),
                    migration,
                }
            }
            Some(Value::Object(config)) => {
                let config = kind.normalize(ProviderFields::from(config));
                ProviderWireValue {
                    value: serde_json::json!({"state":"configured", "config":config.value}),
                    migration: ProviderWireMigration::Migrated,
                }
            }
            _ => ProviderWireValue {
                value: serde_json::json!({"state":"notApplicable"}),
                migration: ProviderWireMigration::Migrated,
            },
        };
        self.fields.insert(field.to_owned(), normalized.value);
        self.migration = self.migration.combine(normalized.migration);
        self
    }
    fn provider(self) -> Self {
        self.field(ProviderFieldMigration {
            name: "githubPat",
            semantic: SemanticProviderField {
                missing_state: "missing",
                present_state: "token",
            },
        })
        .field(ProviderFieldMigration {
            name: "githubRepo",
            semantic: SemanticProviderField {
                missing_state: "defaultRepository",
                present_state: "repository",
            },
        })
        .field(ProviderFieldMigration {
            name: "storeId",
            semantic: SemanticProviderField {
                missing_state: "unscoped",
                present_state: "storeId",
            },
        })
        .configuration(ProviderConfiguration::OAuth)
        .configuration(ProviderConfiguration::Local)
    }
}
#[derive(Clone, Copy)]
enum ProviderConfiguration {
    OAuth,
    Local,
}
impl ProviderConfiguration {
    fn field(self) -> &'static str {
        match self {
            Self::OAuth => "oauthFile",
            Self::Local => "localFolder",
        }
    }
    fn normalize(self, fields: ProviderFields) -> ProviderWireValue {
        let normalized = match self {
            Self::OAuth => fields.oauth(),
            Self::Local => fields.local(),
        };
        ProviderWireValue {
            value: Value::Object(normalized.fields),
            migration: normalized.migration,
        }
    }
}
impl From<Value> for NormalizedAuthSnapshot {
    fn from(raw: Value) -> Self {
        let Value::Object(mut fields) = raw else {
            return Self {
                snapshot: AuthProvidersSnapshotData::default(),
                migration: ProviderWireMigration::Migrated,
            };
        };
        let (items, mut migration) = match fields.remove("providers") {
            Some(Value::Array(items)) => (items, ProviderWireMigration::Unchanged),
            _ => (Vec::new(), ProviderWireMigration::Migrated),
        };
        let providers = items
            .into_iter()
            .filter_map(|item| {
                let item = match item {
                    Value::Object(object) => {
                        let normalized = ProviderFields::from(object).provider();
                        migration = migration.combine(normalized.migration);
                        Value::Object(normalized.fields)
                    }
                    value => value,
                };
                serde_json::from_value::<StorageProviderData>(item).ok()
            })
            .collect();
        let active = SemanticProviderField {
            missing_state: "unselected",
            present_state: "storeId",
        }
        .normalize(ProviderFieldRead {
            fields: &mut fields,
            name: "activeVaultStoreId",
        });
        Self {
            snapshot: AuthProvidersSnapshotData {
                providers,
                active_vault_store_id: serde_json::from_value(active.value).unwrap_or_default(),
            },
            migration: migration.combine(active.migration),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ActiveVaultScope;
    use serde_json::json;
    #[test]
    fn normalization_migrates_missing_values_and_preserves_active_vault() {
        let missing = NormalizedAuthSnapshot::from(Value::Null);
        assert_eq!(missing.snapshot, AuthProvidersSnapshotData::default());
        assert_eq!(missing.migration, ProviderWireMigration::Migrated);

        let raw = json!({ "providers": [], "activeVaultStoreId": "vault-1" });
        let normalized = NormalizedAuthSnapshot::from(raw);
        assert_eq!(
            normalized.snapshot.active_vault_store_id,
            crate::ActiveVaultScope::StoreId(("vault-1").to_owned())
        );
        assert_eq!(normalized.migration, ProviderWireMigration::Migrated);
    }

    #[test]
    fn normalization_preserves_tagged_bytes_and_reports_wire_changes_only() -> anyhow::Result<()> {
        let provider = StorageProviderData::github("first", "GitHub", " pat ", " repo ", "now");
        let snapshot = AuthProvidersSnapshotData {
            providers: vec![provider],
            active_vault_store_id: ActiveVaultScope::StoreId(" vault ".to_owned()),
        };
        let raw = serde_json::to_value(&snapshot)?;

        let normalized = NormalizedAuthSnapshot::from(raw);
        assert_eq!(normalized.snapshot, snapshot);
        assert_eq!(normalized.migration, ProviderWireMigration::Unchanged);

        // Filtering an invalid array item does not itself change normalized wire JSON.
        let malformed =
            json!({"providers": [false], "activeVaultStoreId": {"state": "unselected"}});
        let normalized = NormalizedAuthSnapshot::from(malformed);
        assert_eq!(normalized.snapshot, AuthProvidersSnapshotData::default());
        assert_eq!(normalized.migration, ProviderWireMigration::Unchanged);
        for raw in [
            json!({"providers": false}),
            json!(17),
            json!({"providers": [{}]}),
        ] {
            let normalized = NormalizedAuthSnapshot::from(raw);
            assert_eq!(normalized.snapshot, AuthProvidersSnapshotData::default());
            assert_eq!(normalized.migration, ProviderWireMigration::Migrated);
        }
        Ok(())
    }
}
