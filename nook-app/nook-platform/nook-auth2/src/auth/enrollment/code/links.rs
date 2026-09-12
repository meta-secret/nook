#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]
//! Browser enrollment link observations; normalization does not admit an envelope.
use percent_encoding::{AsciiSet, CONTROLS};
const ENROLLMENT_HASH_PREFIX: &str = "#enroll=";
const ENCODE_URI_COMPONENT: &AsciiSet = &CONTROLS
    .add(b' ')
    .add(b'"')
    .add(b'#')
    .add(b'$')
    .add(b'%')
    .add(b'&')
    .add(b'+')
    .add(b',')
    .add(b'/')
    .add(b':')
    .add(b';')
    .add(b'<')
    .add(b'=')
    .add(b'>')
    .add(b'?')
    .add(b'@')
    .add(b'[')
    .add(b'\\')
    .add(b']')
    .add(b'^')
    .add(b'`')
    .add(b'{')
    .add(b'|')
    .add(b'}');

enum EnrollmentQuery<'a> {
    Code(&'a str),
    NotIncluded,
}

pub struct EnrollmentLinkInput<'a> {
    pub input: &'a str,
}
impl<'a> EnrollmentLinkInput<'a> {
    /// Carry the raw code in a hash under the browser-provided base URL.
    #[must_use]
    pub fn link(&self, base_url: &str) -> String {
        let base = base_url.trim_end_matches('/');
        let encoded =
            percent_encoding::utf8_percent_encode(self.input, ENCODE_URI_COMPONENT).to_string();
        format!("{base}/{ENROLLMENT_HASH_PREFIX}{encoded}")
    }

    /// Accept raw base64url enrollment codes or full enrollment links.
    #[must_use]
    pub fn normalize(&self) -> String {
        let trimmed = self.input.trim();
        if trimmed.is_empty() {
            return String::new();
        }

        if trimmed.contains("://") {
            if let EnrollmentQuery::Code(raw) =
                (EnrollmentLinkInput { input: trimmed }).query_value()
            {
                return EnrollmentLinkInput { input: raw }.decode_component();
            }
            if let Some(hash) = trimmed.split_once('#').map(|(_, hash)| hash) {
                let prefixed = format!("#{hash}");
                if let Some(raw) = prefixed.strip_prefix(ENROLLMENT_HASH_PREFIX) {
                    return EnrollmentLinkInput { input: raw }.decode_component();
                }
            }
        }

        if let Some(raw) = trimmed.strip_prefix(ENROLLMENT_HASH_PREFIX) {
            return EnrollmentLinkInput { input: raw }.decode_component();
        }

        if let EnrollmentQuery::Code(raw) = (EnrollmentLinkInput { input: trimmed }).query_value() {
            return EnrollmentLinkInput { input: raw }.decode_component();
        }

        trimmed.to_owned()
    }

    fn query_value(&self) -> EnrollmentQuery<'a> {
        let Some((_, query)) = self.input.split_once('?') else {
            return EnrollmentQuery::NotIncluded;
        };
        let query = query.split('#').next().unwrap_or_default();
        for part in query.split('&') {
            if let Some((key, value)) = part.split_once('=')
                && key == "enroll"
            {
                return EnrollmentQuery::Code(value);
            }
        }
        EnrollmentQuery::NotIncluded
    }

    fn decode_component(&self) -> String {
        percent_encoding::percent_decode_str(self.input)
            .decode_utf8_lossy()
            .into_owned()
    }
}

#[cfg(test)]
mod tests {
    use super::EnrollmentLinkInput;

    struct NormalizationCase<'a> {
        input: &'a str,
        expected: &'a str,
    }
    impl NormalizationCase<'_> {
        fn verify(self) {
            assert_eq!(
                EnrollmentLinkInput { input: self.input }.normalize(),
                self.expected
            );
        }
    }

    #[test]
    fn normalization_preserves_query_hash_and_decoding_precedence() {
        for case in [
            NormalizationCase {
                input: " \n\t ",
                expected: "",
            },
            NormalizationCase {
                input: "  https://nook.test/?enroll=query#enroll=hash  ",
                expected: "query",
            },
            NormalizationCase {
                input: "https://nook.test/?enroll=first&enroll=second",
                expected: "first",
            },
            NormalizationCase {
                input: "https://nook.test/?enroll&enroll=second",
                expected: "second",
            },
            NormalizationCase {
                input: "https://nook.test/?enroll=#enroll=hash",
                expected: "",
            },
            NormalizationCase {
                input: "https://nook.test/?other=value#enroll=hash",
                expected: "hash",
            },
            NormalizationCase {
                input: "https://nook.test/?Enroll=upper#enroll=hash",
                expected: "hash",
            },
            NormalizationCase {
                input: "?enroll=a+b%2Bc",
                expected: "a+b+c",
            },
            NormalizationCase {
                input: "#enroll=%FF",
                expected: "\u{fffd}",
            },
            NormalizationCase {
                input: "#enroll=%ZZ",
                expected: "%ZZ",
            },
            NormalizationCase {
                input: "#enroll=a%252Fb",
                expected: "a%2Fb",
            },
            NormalizationCase {
                input: "#enroll=hash?enroll=query",
                expected: "hash?enroll=query",
            },
            NormalizationCase {
                input: "?other=value#enroll=hash",
                expected: "?other=value#enroll=hash",
            },
            NormalizationCase {
                input: " raw+%2F ",
                expected: "raw+%2F",
            },
        ] {
            case.verify();
        }
    }

    #[test]
    fn link_generation_keeps_base_whitespace_and_percent_encodes_code() {
        let input = EnrollmentLinkInput { input: " a+b/é " };
        let link = input.link(" https://nook.test///");
        assert_eq!(link, " https://nook.test/#enroll=%20a%2Bb%2F%C3%A9%20");
        assert_eq!(
            EnrollmentLinkInput { input: &link }.normalize(),
            input.input
        );
        assert_eq!(EnrollmentLinkInput { input: "" }.link(""), "/#enroll=");
    }
    #[test]
    fn enrollment_link_roundtrip_normalizes_hash_and_query_forms() {
        let code = "abc-123_DEF";
        let link = EnrollmentLinkInput { input: code }.link("https://nook.example/");
        assert_eq!(link, "https://nook.example/#enroll=abc-123_DEF");
        assert_eq!(EnrollmentLinkInput { input: &link }.normalize(), code);
        assert_eq!(
            EnrollmentLinkInput {
                input: "https://nook.example/?enroll=abc%20123"
            }
            .normalize(),
            "abc 123"
        );
        assert_eq!(
            EnrollmentLinkInput {
                input: "#enroll=abc%2F123"
            }
            .normalize(),
            "abc/123"
        );
        assert_eq!(
            EnrollmentLinkInput {
                input: "  raw-code  "
            }
            .normalize(),
            "raw-code"
        );
    }
}
