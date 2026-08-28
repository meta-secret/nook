//! Direct browser evidence that filling a one-time code advances the ceremony.

const INPUT_EVENT_ATTRIBUTES: &[&str] = &["oninput=", "onchange="];
const DIRECT_FORM_SUBMIT_CALLS: &[&str] = &["this.form.requestsubmit(", "this.form.submit("];

fn is_receiver_expression_boundary(value: Option<char>) -> bool {
    value.is_none_or(|character| {
        matches!(
            character,
            '(' | ')'
                | '['
                | ']'
                | '{'
                | '}'
                | ';'
                | ','
                | ':'
                | '?'
                | '='
                | '+'
                | '-'
                | '*'
                | '/'
                | '%'
                | '!'
                | '&'
                | '|'
                | '^'
                | '~'
                | '<'
                | '>'
        )
    })
}

fn handler_submits_form(value: &str) -> bool {
    let handler = value.to_ascii_lowercase().replace(char::is_whitespace, "");
    DIRECT_FORM_SUBMIT_CALLS.iter().any(|call| {
        handler
            .match_indices(call)
            .any(|(index, _)| is_receiver_expression_boundary(handler[..index].chars().next_back()))
    })
}

/// True only when an executable input/change handler directly submits the form.
#[must_use]
pub fn looks_like_one_time_code_auto_submit_signal(signal: &str) -> bool {
    if signal.len() > super::MAX_AUTHENTICATION_CONTROL_TEXT_BYTES {
        return false;
    }
    signal.lines().any(|line| {
        let lower = line.trim().to_ascii_lowercase();
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
    }

    #[test]
    fn rejects_absence_and_unrelated_input_handlers() {
        assert!(!looks_like_one_time_code_auto_submit_signal(""));
        assert!(!looks_like_one_time_code_auto_submit_signal(
            "oninput=validateCode()"
        ));
        assert!(!looks_like_one_time_code_auto_submit_signal(
            "data-auto-submit=true"
        ));
        assert!(!looks_like_one_time_code_auto_submit_signal(
            "data-submit-on-input=true"
        ));
    }

    #[test]
    fn rejects_suffixed_and_forged_this_receivers() {
        assert!(!looks_like_one_time_code_auto_submit_signal(
            "oninput=notthis.form.submit()"
        ));
        assert!(!looks_like_one_time_code_auto_submit_signal(
            "onchange=controller.this.form.requestSubmit()"
        ));
        assert!(!looks_like_one_time_code_auto_submit_signal(
            "oninput=thisSuffix.form.submit()"
        ));
    }

    #[test]
    fn rejects_oversized_handler_signals_before_scanning() {
        let oversized = format!(
            "oninput=this.form.submit(){}",
            "x".repeat(super::super::MAX_AUTHENTICATION_CONTROL_TEXT_BYTES)
        );
        assert!(!looks_like_one_time_code_auto_submit_signal(&oversized));
    }
}
