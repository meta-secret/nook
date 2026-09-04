//! Direct browser evidence that filling a one-time code advances the ceremony.

const INPUT_EVENT_ATTRIBUTES: &[&str] = &["oninput", "onchange"];

fn strip_token<'a>(value: &'a str, token: &str) -> Option<&'a str> {
    value.trim_start().strip_prefix(token)
}

fn handler_submits_form(value: &str) -> bool {
    let Some(value) = strip_token(value, "this") else {
        return false;
    };
    let Some(value) = strip_token(value, ".") else {
        return false;
    };
    let Some(value) = strip_token(value, "form") else {
        return false;
    };
    let Some(value) = strip_token(value, ".") else {
        return false;
    };
    let Some(value) = strip_token(value, "requestSubmit").or_else(|| strip_token(value, "submit"))
    else {
        return false;
    };
    let Some(value) = strip_token(value, "(") else {
        return false;
    };
    let Some(value) = strip_token(value, ")") else {
        return false;
    };
    let value = value.trim();
    value.is_empty()
        || value
            .strip_prefix(';')
            .is_some_and(|tail| tail.trim().is_empty())
}

/// True only when an executable input/change handler directly submits the form.
#[must_use]
pub fn looks_like_one_time_code_auto_submit_signal(signal: &str) -> bool {
    if signal.len() > super::MAX_AUTHENTICATION_CONTROL_TEXT_BYTES {
        return false;
    }
    let mut lines = signal
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty());
    let Some(line) = lines.next() else {
        return false;
    };
    if lines.next().is_some() {
        return false;
    }

    let Some((attribute, handler)) = line.split_once('=') else {
        return false;
    };
    INPUT_EVENT_ATTRIBUTES
        .iter()
        .any(|expected| attribute.trim().eq_ignore_ascii_case(expected))
        && handler_submits_form(handler)
}

#[cfg(test)]
mod tests {
    use super::super::MAX_AUTHENTICATION_CONTROL_TEXT_BYTES;
    use super::*;

    #[test]
    fn recognizes_direct_auto_submit_dom_signals() {
        assert!(looks_like_one_time_code_auto_submit_signal(
            "oninput=this.form.requestSubmit()"
        ));
        assert!(looks_like_one_time_code_auto_submit_signal(
            "onchange=this.form.submit();"
        ));
        assert!(looks_like_one_time_code_auto_submit_signal(
            "ONINPUT = this . form . requestSubmit ( ) ;"
        ));
    }

    #[test]
    fn rejects_case_changed_and_whitespace_split_javascript_identifiers() {
        for signal in [
            "oninput=this.form.Submit()",
            "onchange=this.form.requestsubmit()",
            "oninput=this.form.request Submit()",
            "onchange=this.form.sub mit()",
        ] {
            assert!(!looks_like_one_time_code_auto_submit_signal(signal));
        }
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
    fn rejects_commented_conditional_and_compound_submit_text() {
        for signal in [
            "oninput=/* this.form.submit() */ validateCode()",
            "onchange=if(false)this.form.requestSubmit()",
            "oninput=validateCode();this.form.submit()",
            "onchange=this.form.requestSubmit();validateCode()",
            "oninput=this.form.submit()\nonchange=validateCode()",
        ] {
            assert!(!looks_like_one_time_code_auto_submit_signal(signal));
        }
    }

    #[test]
    fn rejects_named_helpers_that_only_mention_request_submit() {
        assert!(looks_like_one_time_code_auto_submit_signal(
            "oninput=this.form.submit()"
        ));
        assert!(!looks_like_one_time_code_auto_submit_signal(
            "oninput=validate_requestSubmit()"
        ));
        assert!(!looks_like_one_time_code_auto_submit_signal(
            "onchange=validate_requestSubmit()"
        ));
    }

    #[test]
    fn rejects_oversized_handler_signals_before_scanning() {
        let oversized = format!(
            "oninput=this.form.submit(){}",
            "x".repeat(MAX_AUTHENTICATION_CONTROL_TEXT_BYTES)
        );
        assert!(!looks_like_one_time_code_auto_submit_signal(&oversized));
    }
}
