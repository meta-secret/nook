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
        let mut values = String::from("// Generated from canonical Rust observer values.\n");
        values.push_str(
            &ValueExport {
                name: "ObservedAlertKind",
                values: &[
                    AlertKind::TaskFailed,
                    AlertKind::DependencyFailed,
                    AlertKind::DependencyBlocked,
                    AlertKind::ActivityStale,
                    AlertKind::CancellationStuck,
                ],
            }
            .declaration()?,
        );
        values.push_str(
            &ValueExport {
                name: "ObservedAlertSeverity",
                values: &[AlertSeverity::Critical, AlertSeverity::Warning],
            }
            .declaration()?,
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
        let mut source = format!("export const {} = {{\n", self.name);
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
            source.push_str(&format!(
                "  {}: {},\n",
                serde_json::to_string(&key)?,
                serde_json::to_string(wire)?
            ));
        }
        source.push_str("} as const;\n");
        Ok(source)
    }
}
