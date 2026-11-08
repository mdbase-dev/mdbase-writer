## Fixed

- Retry transient SDK intake failures across multi-minute outages and authenticate GitHub release-asset downloads when a read-only job token is available, preserving digest and attestation checks and removing the token before dependency or application hooks.
