//! Native build-time export from the same serde DTOs served by the observer.
use super::{AlertKind, AlertSeverity, ObservedTask, ObservedTaskState, ObserverSnapshot};
use schemars::schema_for;
use serde::Serialize;
use std::fs;
use std::io;
use std::path::Path;
use ts_rs::TS;

pub struct ObserverContractExport<'a> {
    pub output: &'a Path,
}

impl ObserverContractExport<'_> {
    pub fn write(self) -> Result<(), Box<dyn std::error::Error>> {
        fs::create_dir_all(self.output)?;
        ObserverSnapshot::export_all_to(self.output)?;
        fs::write(
            self.output.join("ObserverSnapshot.schema.json"),
            serde_json::to_vec_pretty(&schema_for!(ObserverSnapshot))?,
        )?;
        fs::write(
            self.output.join("ObservedTask.schema.json"),
            serde_json::to_vec_pretty(&schema_for!(ObservedTask))?,
        )?;
        let declarations = [
            <ObserverSnapshot as TS>::name(),
            <ObservedTask as TS>::name(),
            <super::ObserverCopy as TS>::name(),
            <super::ObservedAgent as TS>::name(),
            <super::ObservedActivity as TS>::name(),
            <super::ObservedDependency as TS>::name(),
            <super::ObservedAlert as TS>::name(),
        ]
        .into_iter()
        .map(|name| format!("export type {{ {name} }} from './{name}';\n"))
        .collect::<String>();
        fs::write(self.output.join("index.ts"), declarations)?;
        let alert_kind = ValueExport {
            name: "AlertKind",
            values: &[
                AlertKind::TaskFailed,
                AlertKind::DependencyFailed,
                AlertKind::DependencyBlocked,
                AlertKind::ActivityStale,
                AlertKind::CancellationStuck,
            ],
        }
        .declaration()?;
        fs::write(self.output.join("AlertKind.ts"), alert_kind)?;
        let alert_severity = ValueExport {
            name: "AlertSeverity",
            values: &[AlertSeverity::Critical, AlertSeverity::Warning],
        }
        .declaration()?;
        fs::write(self.output.join("AlertSeverity.ts"), alert_severity)?;
        let mut values = String::from("// Generated from canonical Rust observer values.\n");
        values.push_str("export { AlertKind as ObservedAlertKind } from './AlertKind';\n");
        values.push_str(
            "export { AlertSeverity as ObservedAlertSeverity } from './AlertSeverity';\n",
        );
        values.push_str(
            &ValueExport {
                name: "ObservedTaskState",
                values: &[
                    ObservedTaskState::Ready,
                    ObservedTaskState::Running,
                    ObservedTaskState::Completed,
                    ObservedTaskState::Failed,
                    ObservedTaskState::Blocked,
                    ObservedTaskState::Cancelling,
                    ObservedTaskState::Cancelled,
                ],
            }
            .declaration()?,
        );
        fs::write(self.output.join("values.ts"), values)?;
        Ok(())
    }
}

struct ValueExport<'a, T> {
    name: &'a str,
    values: &'a [T],
}
impl<T: Serialize> ValueExport<'_, T> {
    fn declaration(self) -> Result<String, Box<dyn std::error::Error>> {
        let mut source = format!("export enum {} {{\n", self.name);
        for value in self.values {
            let serialized = serde_json::to_value(value)?;
            let wire = serialized.as_str().ok_or_else(|| {
                io::Error::new(
                    io::ErrorKind::InvalidData,
                    "observer constant must serialize as a string",
                )
            })?;
            let key = wire
                .split('-')
                .map(|part| {
                    let mut chars = part.chars();
                    chars.next().map_or_else(String::new, |first| {
                        first.to_uppercase().collect::<String>()
                            + &chars.as_str().to_ascii_lowercase()
                    })
                })
                .collect::<String>();
            source.push_str(&format!("  {} = {},\n", key, serde_json::to_string(wire)?));
        }
        source.push_str("}\n");
        Ok(source)
    }
}

#[cfg(test)]
mod tests {
    use super::ObserverContractExport;
    use std::fs;

    #[test]
    fn alert_vocabularies_export_as_runtime_enums() {
        let output = tempfile::tempdir().expect("contract directory");
        ObserverContractExport {
            output: output.path(),
        }
        .write()
        .expect("observer contract export");

        let kind =
            fs::read_to_string(output.path().join("AlertKind.ts")).expect("alert kind output");
        let severity = fs::read_to_string(output.path().join("AlertSeverity.ts"))
            .expect("alert severity output");
        assert!(kind.starts_with("export enum AlertKind"));
        assert!(kind.contains("TaskFailed = \"task-failed\""));
        assert!(severity.starts_with("export enum AlertSeverity"));
        assert!(severity.contains("Critical = \"critical\""));
    }
}
