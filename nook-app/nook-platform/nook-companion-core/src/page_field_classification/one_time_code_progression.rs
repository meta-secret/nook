//! Direct browser evidence that filling a one-time code advances the ceremony.

const INPUT_EVENT_ATTRIBUTES: &[&str] = &["oninput", "onchange"];

impl<'a> AuthenticationControlText<'a> {
    fn strip_token(&self, token: &str) -> Option<&'a str> {
        self.as_str().trim_start().strip_prefix(token)
    }
}

impl AuthenticationControlText<'_> {
    fn handler_submits_form(&self) -> bool {
        let value = self.as_str();
        let Some(value) = AuthenticationControlText::new(value).strip_token("this") else {
            return false;
        };
        let Some(value) = AuthenticationControlText::new(value).strip_token(".") else {
            return false;
        };
        let Some(value) = AuthenticationControlText::new(value).strip_token("form") else {
            return false;
        };
        let Some(value) = AuthenticationControlText::new(value).strip_token(".") else {
            return false;
        };
        let Some(value) = AuthenticationControlText::new(value)
            .strip_token("requestSubmit")
            .or_else(|| AuthenticationControlText::new(value).strip_token("submit"))
        else {
            return false;
        };
        let Some(value) = AuthenticationControlText::new(value).strip_token("(") else {
            return false;
        };
        let Some(value) = AuthenticationControlText::new(value).strip_token(")") else {
            return false;
        };
        let value = value.trim();
        value.is_empty()
            || value
                .strip_prefix(';')
                .is_some_and(|tail| tail.trim().is_empty())
    }
}

/// True only when an executable input/change handler directly submits the form.
use crate::AuthenticationControlText;
impl AuthenticationControlText<'_> {
    #[must_use]
    pub fn looks_like_one_time_code_auto_submit_signal(&self) -> bool {
        let signal = self.as_str();
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
            && AuthenticationControlText::new(handler).handler_submits_form()
    }
}

#[cfg(test)]
mod tests {
    use super::super::MAX_AUTHENTICATION_CONTROL_TEXT_BYTES;
    use super::*;

    #[test]
    fn recognizes_direct_auto_submit_dom_signals() {
        assert!(
            AuthenticationControlText::new("oninput=this.form.requestSubmit()")
                .looks_like_one_time_code_auto_submit_signal()
        );
        assert!(
            AuthenticationControlText::new("onchange=this.form.submit();")
                .looks_like_one_time_code_auto_submit_signal()
        );
        assert!(
            AuthenticationControlText::new("ONINPUT = this . form . requestSubmit ( ) ;")
                .looks_like_one_time_code_auto_submit_signal()
        );
    }

    #[test]
    fn rejects_case_changed_and_whitespace_split_javascript_identifiers() {
        for signal in [
            "oninput=this.form.Submit()",
            "onchange=this.form.requestsubmit()",
            "oninput=this.form.request Submit()",
            "onchange=this.form.sub mit()",
        ] {
            assert!(
                !AuthenticationControlText::new(signal)
                    .looks_like_one_time_code_auto_submit_signal()
            );
        }
    }

    #[test]
    fn rejects_absence_and_unrelated_input_handlers() {
        assert!(!AuthenticationControlText::new("").looks_like_one_time_code_auto_submit_signal());
        assert!(
            !AuthenticationControlText::new("oninput=validateCode()")
                .looks_like_one_time_code_auto_submit_signal()
        );
        assert!(
            !AuthenticationControlText::new("data-auto-submit=true")
                .looks_like_one_time_code_auto_submit_signal()
        );
        assert!(
            !AuthenticationControlText::new("data-submit-on-input=true")
                .looks_like_one_time_code_auto_submit_signal()
        );
    }

    #[test]
    fn rejects_suffixed_and_forged_this_receivers() {
        assert!(
            !AuthenticationControlText::new("oninput=notthis.form.submit()")
                .looks_like_one_time_code_auto_submit_signal()
        );
        assert!(
            !AuthenticationControlText::new("onchange=controller.this.form.requestSubmit()")
                .looks_like_one_time_code_auto_submit_signal()
        );
        assert!(
            !AuthenticationControlText::new("oninput=thisSuffix.form.submit()")
                .looks_like_one_time_code_auto_submit_signal()
        );
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
            assert!(
                !AuthenticationControlText::new(signal)
                    .looks_like_one_time_code_auto_submit_signal()
            );
        }
    }

    #[test]
    fn rejects_named_helpers_that_only_mention_request_submit() {
        assert!(
            AuthenticationControlText::new("oninput=this.form.submit()")
                .looks_like_one_time_code_auto_submit_signal()
        );
        assert!(
            !AuthenticationControlText::new("oninput=validate_requestSubmit()")
                .looks_like_one_time_code_auto_submit_signal()
        );
        assert!(
            !AuthenticationControlText::new("onchange=validate_requestSubmit()")
                .looks_like_one_time_code_auto_submit_signal()
        );
    }

    #[test]
    fn rejects_oversized_handler_signals_before_scanning() {
        let oversized = format!(
            "oninput=this.form.submit(){}",
            "x".repeat(MAX_AUTHENTICATION_CONTROL_TEXT_BYTES)
        );
        assert!(
            !AuthenticationControlText::new(&oversized)
                .looks_like_one_time_code_auto_submit_signal()
        );
    }
}
