#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]
#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
//! The origin an S3 provider sends every request to.
//!
//! An endpoint is a scheme, a host, and a port, nothing else. It must use
//! `https://`, except the loopback hosts `localhost`, `127.0.0.1`, and `[::1]`,
//! which may use plain `http://` for the local development server.

use std::fmt;
use std::net::{Ipv4Addr, Ipv6Addr};

use serde::{Deserialize, Serialize};
use tsify::Tsify;
use url::{Host, Url};

use crate::errors::{ValidationError, ValidationResult};

/// How requests reach the endpoint.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum S3EndpointScheme {
    /// TLS, to any host.
    Https,
    /// Plain HTTP, accepted only for a loopback host.
    LoopbackHttp,
}

impl S3EndpointScheme {
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Https => "https",
            Self::LoopbackHttp => "http",
        }
    }
}

/// Whether a host stays on this machine.
enum HostReach {
    Loopback,
    Network,
}

impl HostReach {
    fn of(host: &Host<&str>) -> Self {
        match host {
            Host::Domain("localhost") => Self::Loopback,
            Host::Ipv4(address) if *address == Ipv4Addr::LOCALHOST => Self::Loopback,
            Host::Ipv6(address) if *address == Ipv6Addr::LOCALHOST => Self::Loopback,
            Host::Domain(_) | Host::Ipv4(_) | Host::Ipv6(_) => Self::Network,
        }
    }
}

/// The host as browsers write it into the `Host` header: a lowercase ASCII
/// domain, a dotted IPv4 address, or a bracketed IPv6 address.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
struct S3EndpointHost(String);

/// A port the endpoint names explicitly.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
struct S3EndpointPortNumber(u16);

/// Whether the endpoint names a port. A scheme's default port is never kept:
/// browsers leave it out of the `Host` header, so the signature must too.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
enum S3EndpointPort {
    SchemeDefault,
    Explicit(S3EndpointPortNumber),
}

/// Exactly what a browser sends as the `Host` header for this endpoint,
/// `host[:port]` with a non-default port only. Requests sign this value.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct S3HostHeader(String);

impl S3HostHeader {
    #[must_use]
    pub fn as_str(&self) -> &str {
        let Self(header) = self;
        header
    }
}

impl fmt::Display for S3HostHeader {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(self.as_str())
    }
}

/// A validated S3 endpoint origin, written canonically as
/// `scheme://host[:port]`.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize, Tsify)]
#[tsify(type = "string")]
#[serde(try_from = "String", into = "String")]
pub struct S3Endpoint {
    scheme: S3EndpointScheme,
    host: S3EndpointHost,
    port: S3EndpointPort,
}

impl S3Endpoint {
    /// Parse a user-entered endpoint. Surrounding whitespace is ignored; the
    /// scheme and host are normalized as browsers normalize them.
    pub fn parse(raw: &str) -> ValidationResult<Self> {
        let url = match raw.trim() {
            "" => return Err(ValidationError::S3EndpointRequired),
            raw => Url::parse(raw).map_err(|_| ValidationError::S3EndpointInvalid)?,
        };
        let declared = match url.scheme() {
            "https" => S3EndpointScheme::Https,
            "http" => S3EndpointScheme::LoopbackHttp,
            _ => return Err(ValidationError::S3EndpointInvalid),
        };
        Self::require_origin(&url)?;
        let Some(host) = url.host() else {
            return Err(ValidationError::S3EndpointInvalid);
        };
        let scheme = match declared {
            S3EndpointScheme::Https => S3EndpointScheme::Https,
            S3EndpointScheme::LoopbackHttp => match HostReach::of(&host) {
                HostReach::Loopback => S3EndpointScheme::LoopbackHttp,
                HostReach::Network => return Err(ValidationError::S3EndpointInsecure),
            },
        };
        let Some(host) = url.host_str() else {
            return Err(ValidationError::S3EndpointInvalid);
        };
        let port = match url.port() {
            None => S3EndpointPort::SchemeDefault,
            Some(port) => S3EndpointPort::Explicit(S3EndpointPortNumber(port)),
        };
        Ok(Self {
            scheme,
            host: S3EndpointHost(host.to_owned()),
            port,
        })
    }

    /// An endpoint is an origin: its address is exactly `origin/`, with no
    /// user name or password, no path beyond `/`, no query, and no fragment.
    fn require_origin(url: &Url) -> ValidationResult<()> {
        let origin = format!("{}/", url.origin().ascii_serialization());
        match url.as_str().strip_prefix(origin.as_str()) {
            Some("") => Ok(()),
            Some(_) | None => Err(ValidationError::S3EndpointNotOrigin),
        }
    }

    #[must_use]
    pub const fn scheme(&self) -> S3EndpointScheme {
        self.scheme
    }

    /// The `Host` header a browser sends for this endpoint.
    #[must_use]
    pub fn host_header(&self) -> S3HostHeader {
        let S3EndpointHost(host) = &self.host;
        match self.port {
            S3EndpointPort::SchemeDefault => S3HostHeader(host.clone()),
            S3EndpointPort::Explicit(S3EndpointPortNumber(port)) => {
                S3HostHeader(format!("{host}:{port}"))
            }
        }
    }
}

impl fmt::Display for S3Endpoint {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            formatter,
            "{}://{}",
            self.scheme.as_str(),
            self.host_header()
        )
    }
}

impl TryFrom<String> for S3Endpoint {
    type Error = ValidationError;
    fn try_from(value: String) -> ValidationResult<Self> {
        Self::parse(&value)
    }
}

impl From<S3Endpoint> for String {
    fn from(endpoint: S3Endpoint) -> Self {
        endpoint.to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::{S3Endpoint, S3EndpointScheme};
    use crate::errors::ValidationError;

    struct CanonicalEndpoint {
        raw: &'static str,
        canonical: &'static str,
        host_header: &'static str,
        scheme: S3EndpointScheme,
    }

    struct RejectedEndpoint {
        raw: &'static str,
        error: ValidationError,
    }

    #[test]
    fn endpoints_are_canonical_origins_with_the_host_a_browser_sends() -> anyhow::Result<()> {
        let https = S3EndpointScheme::Https;
        let loopback = S3EndpointScheme::LoopbackHttp;
        for case in [
            CanonicalEndpoint {
                raw: " https://S3.Example.COM ",
                canonical: "https://s3.example.com",
                host_header: "s3.example.com",
                scheme: https,
            },
            CanonicalEndpoint {
                raw: "https://s3.example.com:443/",
                canonical: "https://s3.example.com",
                host_header: "s3.example.com",
                scheme: https,
            },
            CanonicalEndpoint {
                raw: "https://minio.example.com:9000",
                canonical: "https://minio.example.com:9000",
                host_header: "minio.example.com:9000",
                scheme: https,
            },
            CanonicalEndpoint {
                raw: "https://[2001:db8::1]:8443",
                canonical: "https://[2001:db8::1]:8443",
                host_header: "[2001:db8::1]:8443",
                scheme: https,
            },
            CanonicalEndpoint {
                raw: "http://127.0.0.1:8333",
                canonical: "http://127.0.0.1:8333",
                host_header: "127.0.0.1:8333",
                scheme: loopback,
            },
            CanonicalEndpoint {
                raw: "http://localhost:8333/",
                canonical: "http://localhost:8333",
                host_header: "localhost:8333",
                scheme: loopback,
            },
            CanonicalEndpoint {
                raw: "http://[::1]:8333",
                canonical: "http://[::1]:8333",
                host_header: "[::1]:8333",
                scheme: loopback,
            },
            CanonicalEndpoint {
                raw: "HTTP://LOCALHOST:80",
                canonical: "http://localhost",
                host_header: "localhost",
                scheme: loopback,
            },
        ] {
            let endpoint = S3Endpoint::parse(case.raw)?;
            assert_eq!(endpoint.to_string(), case.canonical, "{}", case.raw);
            assert_eq!(endpoint.host_header().as_str(), case.host_header);
            assert_eq!(endpoint.scheme(), case.scheme, "{}", case.raw);
            assert_eq!(S3Endpoint::parse(case.canonical)?, endpoint);
        }
        Ok(())
    }

    impl RejectedEndpoint {
        fn insecure(raw: &'static str) -> Self {
            Self {
                raw,
                error: ValidationError::S3EndpointInsecure,
            }
        }

        fn not_origin(raw: &'static str) -> Self {
            Self {
                raw,
                error: ValidationError::S3EndpointNotOrigin,
            }
        }

        fn invalid(raw: &'static str) -> Self {
            Self {
                raw,
                error: ValidationError::S3EndpointInvalid,
            }
        }
    }

    #[test]
    fn endpoints_reject_insecure_partial_and_decorated_addresses() {
        for case in [
            // Plain HTTP is only for this machine.
            RejectedEndpoint::insecure("http://s3.example.com"),
            RejectedEndpoint::insecure("http://10.0.0.5:9000"),
            RejectedEndpoint::insecure("http://127.0.0.2:8333"),
            RejectedEndpoint::insecure("http://localhost.example.com"),
            RejectedEndpoint::insecure("http://[::2]:8333"),
            // An endpoint is an origin and nothing more.
            RejectedEndpoint::not_origin("https://user@s3.example.com"),
            RejectedEndpoint::not_origin("https://user:secret@s3.example.com"),
            RejectedEndpoint::not_origin("https://s3.example.com/bucket"),
            RejectedEndpoint::not_origin("https://s3.example.com/?"),
            RejectedEndpoint::not_origin("https://s3.example.com?list-type=2"),
            RejectedEndpoint::not_origin("https://s3.example.com/#top"),
            RejectedEndpoint::not_origin("http://user:secret@localhost:8333"),
            // It needs an http(s) scheme and a host.
            RejectedEndpoint::invalid("s3.example.com"),
            RejectedEndpoint::invalid("ftp://s3.example.com"),
            RejectedEndpoint::invalid("file:///tmp/bucket"),
            RejectedEndpoint::invalid("https://"),
            RejectedEndpoint::invalid("//s3.example.com"),
            RejectedEndpoint {
                raw: " \t",
                error: ValidationError::S3EndpointRequired,
            },
        ] {
            assert_eq!(S3Endpoint::parse(case.raw), Err(case.error), "{}", case.raw);
        }
        let rejected = S3Endpoint::parse("https://user:hunter2@s3.example.com");
        assert!(!format!("{rejected:?}").contains("hunter2"));
    }

    #[test]
    fn endpoints_cross_the_wire_as_their_canonical_string() -> anyhow::Result<()> {
        let endpoint: S3Endpoint = serde_json::from_str("\"HTTP://127.0.0.1:8333/\"")?;
        assert_eq!(
            serde_json::to_string(&endpoint)?,
            "\"http://127.0.0.1:8333\""
        );
        assert!(serde_json::from_str::<S3Endpoint>("\"http://s3.example.com\"").is_err());
        Ok(())
    }
}
