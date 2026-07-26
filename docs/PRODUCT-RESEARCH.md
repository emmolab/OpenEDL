# OpenEDL product research

## Reference product

[EDL Manager](https://edlmanager.com/) is primarily a collection, transformation,
and publishing service:

- Sources can be IP, URL, domain, JSON, CSV, STIX/TAXII, or manual data.
- Multiple sources can be combined into a published list.
- Sources can also be used as exclusions.
- Published lists use stable HTTPS URLs and can optionally use HTTP Basic Auth.
- Paid features include custom requests, shorter refresh intervals, teams,
  audit history, SAML, APIs, and custom hostnames.

This suggests that the durable product objects should be reusable `sources`,
type-specific published `lists`, and per-list include/exclude relationships.

## Interoperability constraints

External list implementations vary by vendor, but the portable baseline is:

1. A single list contains one entry type: IP, domain, or URL.
2. Entries are newline-delimited plain text.
3. Security platforms fetch a list from an HTTP or HTTPS URL on a configured
   interval.

IP lists may contain individual IPv4 or IPv6 addresses, CIDR subnets, and
address ranges. Domain lists omit the protocol. URL matching details can differ
between platforms, so lists remain type-pure and plain-text by default.

## MVP decisions

- Keep every published list type-pure.
- Cache normalized source entries instead of fetching upstream feeds during a
  downstream request.
- Continue serving the last successful cache when a source refresh fails.
- Normalize, deduplicate, sort, and then apply exclusions.
- Publish a plain-text response with ETag and CDN cache headers.
- Block obvious local, private, metadata, and non-HTTP source URLs.
- Limit source downloads to 2 MB and 15 seconds.
- Protect management APIs with OIDC SSO and database-backed sessions;
  published feeds remain public.
- Use authorization code flow with PKCE, anti-forgery state, nonce validation,
  provider discovery, and verified ID-token signatures.
- Run a five-minute scheduler and refresh only sources whose configurable
  interval is due.

## Next milestones

1. Exponential refresh backoff and alerting after repeated failures.
2. Multiple list creation and list-specific source reuse.
3. Basic Auth and custom request headers for upstream sources.
4. JSONPath-style extraction, stronger CSV mapping, and STIX/TAXII 2.1.
5. Source templates with licensing and attribution metadata.
6. Audit history, diff previews, notifications, and source-health trends.
7. Published endpoint authentication and token rotation.
8. Import/export configuration and container-first self-hosting.

## Operational cautions

- Feed licenses and redistribution terms vary; templates should record each
  source's license and attribution requirements.
- SSRF defenses should add DNS/IP resolution checks in environments that expose
  private networks.
- Security-platform entry limits vary. Future versions should support configurable
  caps and deterministic prioritization instead of silently truncating output.
