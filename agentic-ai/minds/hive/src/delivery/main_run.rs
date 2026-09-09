use super::{DeliveryRun, RunConclusion, RunExecution};

impl DeliveryRun {
    pub(super) fn select_successful_main_run<'a>(
        selection: MainRunSelection<'a>,
    ) -> crate::HiveResult<&'a str> {
        let MainRunSelection { runs, merge_commit } = selection;
        for run in runs {
            if run.status != RunExecution::Completed {
                continue;
            }
            if run.conclusion == RunConclusion::Success {
                return Ok(run.head_sha.as_str());
            }
            if matches!(
                &run.conclusion,
                RunConclusion::Cancelled | RunConclusion::Skipped | RunConclusion::Neutral
            ) {
                continue;
            }
            return Err(crate::HiveError::message(format!(
                "Hive repair delivery failed on Main: run at {} concluded {}",
                run.head_sha, run.conclusion
            )));
        }
        Err(crate::HiveError::message(format!(
            "Hive repair delivery is incomplete: no successful Main workflow contains merge {}",
            merge_commit
        )))
    }
}

#[cfg(test)]
mod tests {
    use super::{DeliveryRun, MainRunSelection};

    fn run(sha: &str, conclusion: &str, created_at: &str) -> DeliveryRun {
        DeliveryRun {
            head_sha: sha.to_owned(),
            status: "completed".into(),
            conclusion: conclusion.into(),
            created_at: created_at.to_owned(),
        }
    }

    #[test]
    fn failed_repair_run_is_not_hidden_by_a_successful_descendant() -> anyhow::Result<()> {
        let runs = vec![
            run("repair", "failure", "2026-07-28T01:00:00Z"),
            run("descendant", "success", "2026-07-28T02:00:00Z"),
        ];
        let error = DeliveryRun::select_successful_main_run(MainRunSelection {
            runs: &runs,
            merge_commit: "merge",
        })
        .err()
        .ok_or_else(|| crate::HiveError::message("an explicit failure must remain terminal"))?;
        assert!(error.to_string().contains("repair"));
        Ok(())
    }

    #[test]
    fn cancelled_run_can_coalesce_into_a_successful_descendant() -> crate::HiveResult<()> {
        let runs = vec![
            run("repair", "cancelled", "2026-07-28T01:00:00Z"),
            run("descendant", "success", "2026-07-28T02:00:00Z"),
        ];
        assert_eq!(
            DeliveryRun::select_successful_main_run(MainRunSelection {
                runs: &runs,
                merge_commit: "merge"
            })?,
            "descendant"
        );
        Ok(())
    }

    #[test]
    fn first_successful_completed_descendant_is_selected_chronologically() -> crate::HiveResult<()>
    {
        let runs = vec![
            run("first", "success", "2026-07-28T01:00:00Z"),
            run("second", "success", "2026-07-28T02:00:00Z"),
        ];
        assert_eq!(
            DeliveryRun::select_successful_main_run(MainRunSelection {
                runs: &runs,
                merge_commit: "merge"
            })?,
            "first"
        );
        Ok(())
    }
}

pub(super) struct MainRunSelection<'a> {
    pub(super) runs: &'a [DeliveryRun],
    pub(super) merge_commit: &'a str,
}
