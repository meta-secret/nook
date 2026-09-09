use super::TurnKind;
use crate::model::TerminalResult;
use serde::{Deserialize, Serialize};

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct PlannerOutput {
    pub feature: PlannedFeature,
    pub tasks: Vec<PlannedTask>,
}
#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct PlannedFeature {
    pub id: String,
    pub title: String,
    pub summary: String,
    pub acceptance_criteria: Vec<String>,
}
#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct PlannedTask {
    pub id: String,
    pub title: String,
    pub description: String,
    pub priority: PlannedTaskPriority,
    pub depends_on: Vec<String>,
    pub resources: PlannedTaskResources,
    pub acceptance_criteria: Vec<String>,
}
#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum PlannedTaskPriority {
    Low,
    Medium,
    High,
    Critical,
}
#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct PlannedTaskResources {
    pub read: Vec<String>,
    pub write: Vec<String>,
}

pub(super) enum CodexTurnOutput {
    Planning(PlannerOutput),
    Task(TerminalResult),
}
impl CodexTurnOutput {
    pub(super) fn decode(kind: &TurnKind, text: &str) -> serde_json::Result<Self> {
        match kind {
            TurnKind::Planning => serde_json::from_str(text).map(Self::Planning),
            TurnKind::Task(_) => serde_json::from_str(text).map(Self::Task),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_malformed_terminal_state_at_completion_boundary() {
        assert!(
            CodexTurnOutput::decode(
                &TurnKind::Task("task".to_owned()),
                r#"{"status":"completed"}"#
            )
            .is_err()
        );
    }
    #[test]
    fn decodes_planning_output_without_requiring_an_internal_json_tree() -> serde_json::Result<()> {
        let output = CodexTurnOutput::decode(
            &TurnKind::Planning,
            r#"{"feature":{"id":"f","title":"Feature","summary":"Summary","acceptance_criteria":[]},"tasks":[]}"#,
        )?;
        assert!(matches!(output, CodexTurnOutput::Planning(plan) if plan.feature.id == "f"));
        Ok(())
    }
}
