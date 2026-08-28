//! Direct browser evidence that filling a one-time code advances the ceremony.

const DECLARATIVE_AUTO_SUBMIT_ATTRIBUTES: &[&str] = &[
    "data-auto-submit=",
    "data-autosubmit=",
    "data-submit-on-input=",
];

const INPUT_EVENT_ATTRIBUTES: &[&str] = &["oninput=", "onchange="];

fn declarative_signal_is_enabled(value: &str) -> bool {
    !matches!(
        value
            .trim()
            .trim_matches(['\'', '"'])
            .to_ascii_lowercase()
            .as_str(),
        "" | "0" | "false" | "no" | "off"
    )
}

fn handler_submits_form(value: &str) -> bool {
    let handler = value.to_ascii_lowercase().replace(char::is_whitespace, "");
    handler.contains("this.form.requestsubmit(") || handler.contains("this.form.submit(")
}

/// True only when selected raw DOM attributes directly describe OTP submission.
#[must_use]
pub fn looks_like_one_time_code_auto_submit_signal(signal: &str) -> bool {
    signal.lines().any(|line| {
        let lower = line.trim().to_ascii_lowercase();
        if let Some(attribute) = DECLARATIVE_AUTO_SUBMIT_ATTRIBUTES
            .iter()
            .find(|attribute| lower.starts_with(**attribute))
        {
            return declarative_signal_is_enabled(&lower[attribute.len()..]);
        }
        INPUT_EVENT_ATTRIBUTES.iter().any(|attribute| {
            lower
                .strip_prefix(attribute)
                .is_some_and(handler_submits_form)
        })
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recognizes_direct_auto_submit_dom_signals() {
        assert!(looks_like_one_time_code_auto_submit_signal(
            "oninput=this.form.requestSubmit()"
        ));
        assert!(looks_like_one_time_code_auto_submit_signal(
            "onchange=this.form.submit()"
        ));
        assert!(looks_like_one_time_code_auto_submit_signal(
            "data-auto-submit=true"
        ));
    }

    #[test]
    fn rejects_absence_and_unrelated_input_handlers() {
        assert!(!looks_like_one_time_code_auto_submit_signal(""));
        assert!(!looks_like_one_time_code_auto_submit_signal(
            "oninput=validateCode()"
        ));
        assert!(!looks_like_one_time_code_auto_submit_signal(
            "data-auto-submit=false"
        ));
        assert!(!looks_like_one_time_code_auto_submit_signal(
            "oninput=void new SubmitEvent('submit')"
        ));
        assert!(!looks_like_one_time_code_auto_submit_signal(
            "oninput=this.form.dispatchEvent(new SubmitEvent('submit'))"
        ));
        assert!(!looks_like_one_time_code_auto_submit_signal(
            "oninput=validator.submit()"
        ));
        assert!(!looks_like_one_time_code_auto_submit_signal(
            "onchange=analytics.requestSubmit()"
        ));
    }
}
