//! Segment vocabulary for non-authorizing authentication-navigation evidence.
#[derive(Clone, Copy)]
enum AuthenticationPathSubject {
    Login,
    Registration,
    Password,
    Authentication,
    SingleSignOn,
    OneTimeCode,
    TwoFactor,
    MultiFactor,
    Verification,
}
impl AuthenticationPathSubject {
    const ALL: [Self; 9] = [
        Self::Login,
        Self::Registration,
        Self::Password,
        Self::Authentication,
        Self::SingleSignOn,
        Self::OneTimeCode,
        Self::TwoFactor,
        Self::MultiFactor,
        Self::Verification,
    ];
    fn matches(self, segment: &str) -> bool {
        match self {
            Self::Login => matches!(segment, "login" | "signin" | "sign-in" | "log-in"),
            Self::Registration => matches!(segment, "signup" | "sign-up" | "register"),
            Self::Password => matches!(segment, "password" | "passwd"),
            Self::Authentication => segment == "auth",
            Self::SingleSignOn => segment == "sso",
            Self::OneTimeCode => segment == "otp",
            Self::TwoFactor => segment == "2fa",
            Self::MultiFactor => segment == "mfa",
            Self::Verification => segment == "verify",
        }
    }
}
pub struct AuthenticationNavigationPath<'a> {
    pathname: &'a str,
}
impl<'a> From<&'a str> for AuthenticationNavigationPath<'a> {
    fn from(pathname: &'a str) -> Self {
        Self { pathname }
    }
}
impl AuthenticationNavigationPath<'_> {
    #[must_use]
    pub fn has_authentication_segment(self) -> bool {
        self.pathname.split('/').any(|segment| {
            let normalized = segment.to_ascii_lowercase();
            AuthenticationPathSubject::ALL
                .into_iter()
                .any(|subject| subject.matches(&normalized))
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    struct NavigationPathCase<'a> {
        pathname: &'a str,
        expected: bool,
    }
    impl NavigationPathCase<'_> {
        fn assert_recognition(self) {
            assert_eq!(
                AuthenticationNavigationPath::from(self.pathname).has_authentication_segment(),
                self.expected
            );
        }
    }
    #[test]
    fn authentication_paths_require_complete_segments() {
        for (pathname, expected) in [
            ("/login", true),
            ("/a/SIGN-IN/b", true),
            ("/password/", true),
            ("/notlogin", false),
            ("/login-more", false),
            ("/profile?login", false),
            ("/authenticator", false),
            ("/sso/verify", true),
        ] {
            NavigationPathCase { pathname, expected }.assert_recognition();
        }
    }
}
