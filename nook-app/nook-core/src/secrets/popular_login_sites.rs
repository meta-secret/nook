//! Curated password-manager-relevant popular login destinations.
//!
//! The catalog drives mock-auth fixture coverage. CI asserts exactly 100
//! entries with stable ids; live third-party pages are never fetched here.

#[cfg(test)]
mod tests {
    use serde::Deserialize;
    use std::collections::HashSet;

    #[derive(Debug, Deserialize)]
    struct PopularLoginSite {
        id: String,
        name: String,
        family: String,
        #[serde(rename = "loginUrl")]
        login_url: String,
        hosts: Vec<String>,
        rank: u32,
    }

    #[test]
    fn catalog_has_exactly_one_hundred_unique_ranked_sites() {
        let sites: Vec<PopularLoginSite> =
            serde_json::from_str(include_str!("../../data/popular_login_sites.json"))
                .expect("bundled popular_login_sites.json must deserialize");
        assert_eq!(sites.len(), 100, "catalog must contain exactly 100 sites");
        let mut ids = HashSet::new();
        let mut ranks = HashSet::new();
        for site in sites {
            assert!(!site.id.is_empty(), "site id must not be empty");
            assert!(!site.name.is_empty(), "site name must not be empty");
            assert!(!site.family.is_empty(), "site family must not be empty");
            assert!(
                site.login_url.starts_with("https://"),
                "loginUrl for {} must be https",
                site.id
            );
            assert!(
                !site.hosts.is_empty(),
                "hosts for {} must not be empty",
                site.id
            );
            assert!(
                ids.insert(site.id.clone()),
                "duplicate popular login site id {}",
                site.id
            );
            assert!(
                (1..=100).contains(&site.rank),
                "rank for {} out of range",
                site.id
            );
            assert!(
                ranks.insert(site.rank),
                "duplicate popular login site rank {}",
                site.rank
            );
        }
    }
}
