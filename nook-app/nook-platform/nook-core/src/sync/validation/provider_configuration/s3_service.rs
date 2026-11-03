#![cfg_attr(
    dylint_lib = "nook_domain_api",
    forbid(invalid_unowned_function_suppression)
)]
#![cfg_attr(dylint_lib = "nook_domain_api", deny(unowned_function))]
//! The S3-compatible services Nook recognises, for the setup form's guidance:
//! each one's endpoint and region formats and the console page where its
//! account issues an access key. Nook never creates a key itself; that needs
//! the account's own sign-in, which Nook must not hold.

use serde::{Deserialize, Serialize};
use tsify::Tsify;
use url::{Host, Url};

/// A service Nook knows by its endpoint's domain.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[serde(rename_all = "kebab-case")]
pub enum S3KnownService {
    Aws,
    CloudflareR2,
    BackblazeB2,
    Wasabi,
    DigitalOceanSpaces,
}

/// How the setup form guides a person for one known service.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub struct S3ServiceGuide {
    pub service: S3KnownService,
    /// The translation key of the service's name.
    pub name_key: String,
    /// The endpoint's shape, for the endpoint field's placeholder.
    pub endpoint_example: String,
    /// A region this service accepts, for the region field's placeholder.
    pub region_example: String,
    /// The service's console page where an access key is created.
    pub key_console_url: String,
}

/// Which service a typed endpoint belongs to.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Tsify)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum S3EndpointService {
    /// The endpoint is on a known service's domain.
    Known { guide: S3ServiceGuide },
    /// Any other S3-compatible server, such as `MinIO` or a self-hosted one,
    /// or an endpoint not typed far enough to tell.
    Other,
}

impl S3KnownService {
    /// Every known service, in the order the form offers them.
    pub const ALL: [Self; 5] = [
        Self::Aws,
        Self::CloudflareR2,
        Self::BackblazeB2,
        Self::Wasabi,
        Self::DigitalOceanSpaces,
    ];

    /// The domain this service's endpoints are on, or below.
    const fn domain(self) -> &'static str {
        match self {
            Self::Aws => "amazonaws.com",
            Self::CloudflareR2 => "r2.cloudflarestorage.com",
            Self::BackblazeB2 => "backblazeb2.com",
            Self::Wasabi => "wasabisys.com",
            Self::DigitalOceanSpaces => "digitaloceanspaces.com",
        }
    }

    #[must_use]
    pub fn guide(self) -> S3ServiceGuide {
        let (name_key, endpoint_example, region_example, key_console_url) = match self {
            Self::Aws => (
                "provider_setup.s3_service_aws",
                "https://s3.us-east-1.amazonaws.com",
                "us-east-1",
                "https://console.aws.amazon.com/iam/home#/users",
            ),
            Self::CloudflareR2 => (
                "provider_setup.s3_service_cloudflare_r2",
                "https://<account-id>.r2.cloudflarestorage.com",
                "auto",
                "https://dash.cloudflare.com/?to=/:account/r2/overview",
            ),
            Self::BackblazeB2 => (
                "provider_setup.s3_service_backblaze_b2",
                "https://s3.us-west-004.backblazeb2.com",
                "us-west-004",
                "https://secure.backblaze.com/app_keys.htm",
            ),
            Self::Wasabi => (
                "provider_setup.s3_service_wasabi",
                "https://s3.us-east-1.wasabisys.com",
                "us-east-1",
                "https://console.wasabisys.com/#/access_keys",
            ),
            Self::DigitalOceanSpaces => (
                "provider_setup.s3_service_digitalocean_spaces",
                "https://nyc3.digitaloceanspaces.com",
                "nyc3",
                "https://cloud.digitalocean.com/spaces/access_keys",
            ),
        };
        S3ServiceGuide {
            service: self,
            name_key: name_key.to_owned(),
            endpoint_example: endpoint_example.to_owned(),
            region_example: region_example.to_owned(),
            key_console_url: key_console_url.to_owned(),
        }
    }

    /// Every known service's guide, in the order the form offers them.
    #[must_use]
    pub fn guides() -> Vec<S3ServiceGuide> {
        Self::ALL.into_iter().map(Self::guide).collect()
    }

    /// Whether `host` is this service's domain or one of its subdomains.
    fn serves(self, host: &str) -> bool {
        let domain = self.domain();
        host == domain
            || host
                .strip_suffix(domain)
                .is_some_and(|rest| rest.ends_with('.'))
    }
}

impl S3EndpointService {
    /// The service of a typed endpoint, judged by its host alone. Anything
    /// that does not parse as a URL with a domain is another server.
    #[must_use]
    pub fn for_endpoint(endpoint: &str) -> Self {
        let Ok(url) = Url::parse(endpoint.trim()) else {
            return Self::Other;
        };
        let Some(Host::Domain(host)) = url.host() else {
            return Self::Other;
        };
        let host = host.to_ascii_lowercase();
        S3KnownService::ALL
            .into_iter()
            .find(|service| service.serves(&host))
            .map_or(Self::Other, |service| Self::Known {
                guide: service.guide(),
            })
    }
}

#[cfg(test)]
mod tests {
    use super::{S3EndpointService, S3KnownService};

    fn service_of(endpoint: &str) -> Result<S3KnownService, String> {
        match S3EndpointService::for_endpoint(endpoint) {
            S3EndpointService::Known { guide } => Ok(guide.service),
            S3EndpointService::Other => Err(format!("{endpoint} was not recognised")),
        }
    }

    #[test]
    fn each_service_is_recognised_by_its_endpoint() -> Result<(), String> {
        assert_eq!(
            service_of("https://s3.eu-west-1.amazonaws.com")?,
            S3KnownService::Aws
        );
        assert_eq!(
            service_of("https://0123abcd.eu.r2.cloudflarestorage.com")?,
            S3KnownService::CloudflareR2
        );
        assert_eq!(
            service_of("https://s3.us-west-004.backblazeb2.com")?,
            S3KnownService::BackblazeB2
        );
        assert_eq!(
            service_of("https://s3.wasabisys.com")?,
            S3KnownService::Wasabi
        );
        assert_eq!(
            service_of(" https://FRA1.DigitalOceanSpaces.com/ ")?,
            S3KnownService::DigitalOceanSpaces
        );
        Ok(())
    }

    #[test]
    fn other_servers_and_unfinished_input_are_other() {
        for endpoint in [
            "http://127.0.0.1:8333",
            "https://minio.example.com",
            "https://amazonaws.com.attacker.example",
            "https://notamazonaws.com",
            "https://",
            "s3.amazonaws",
            "",
        ] {
            assert_eq!(
                S3EndpointService::for_endpoint(endpoint),
                S3EndpointService::Other,
                "{endpoint}"
            );
        }
    }

    #[test]
    fn every_guide_names_its_service_and_links_an_https_console() {
        let guides = S3KnownService::guides();
        assert_eq!(guides.len(), S3KnownService::ALL.len());
        for (guide, service) in guides.iter().zip(S3KnownService::ALL) {
            assert_eq!(guide.service, service);
            assert!(guide.name_key.starts_with("provider_setup.s3_service_"));
            assert!(guide.key_console_url.starts_with("https://"));
            assert!(guide.endpoint_example.starts_with("https://"));
            assert!(!guide.region_example.is_empty());
        }
    }
}
