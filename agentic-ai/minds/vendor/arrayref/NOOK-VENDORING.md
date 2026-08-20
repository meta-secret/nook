# arrayref 0.3.9 vendoring record

This directory contains the unmodified library source and license from the
`arrayref 0.3.9` crates.io archive. The release was vendored after all compatible
registry versions were yanked and the upstream Git repository stopped allowing
anonymous fetches.

- Crates.io archive SHA-256: `76a2e8124351fda1ef8aaaa3bbd7ebbcb486bbcd4225aca0aa0d84bb2db8fecb`
- License: BSD-2-Clause
- Upstream repository recorded by the release: `https://github.com/droundy/arrayref`

Remove this patch when `starlark` no longer pins `blake3 1.8.2`, whose
`arrayref` dependency is the only consumer in the Minds workspace.
