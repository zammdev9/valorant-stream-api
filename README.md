# Valorant Twitch stream API

Small Next.js App Router API for one streamer. No database or account dashboard.

## Run

Requires Node.js 22.12 or newer. Run `npm ci`, copy `.env.example` to `.env.local`, set `HENRIK_API_KEY` and the Twitch application client ID/secret, then run `npm run dev`. Twitch credentials are needed for stream records; rank only needs the Henrik key. Player identity, platform, and Twitch username come from the URL, with `pc` as the default platform. Existing player/Twitch environment defaults are ignored. Never put credentials in URLs or NEXT_PUBLIC variables.

`npm test`, `npm run typecheck`, and `npm run build` require no live credentials.

## Deploy to Vercel

Import this directory as a Git repository into Vercel, select the Next.js preset, and add the environment variables in project settings. Deploy using the default `npm run build` command. Set a function duration of 60 seconds or use a plan that supports the route's `maxDuration`. Test both public endpoints after deployment. Live local provider checks passed; no Vercel deployment has been performed.

In Vercel's Settings → Build and Deployment, use Framework Preset **Next.js** and leave the Output Directory override disabled. The app uses Next.js's standard `.next` output directory. If an older deployment fails with “The Next.js output directory .next was not found”, update `next.config.ts` to remove the custom `distDir`, commit the updated source, and deploy that new commit. Redeploying an old commit will retain its old configuration.

## Chat commands

Path-based commands:

```
/api/rank/<name>/<tag>/<region>/<twitch>
/api/record/<name>/<tag>/<region>/<twitch>
```

Add `?platform=console` for console, or `?platform=pc` to make the default explicit. Twitch username is optional for rank: `/api/rank/<name>/<tag>/<region>`. It is required for record because it identifies the active broadcast. Record output always includes the Twitch username:

```
streamer is currently up 74R (going 6W-3L) since the stream started
streamer is currently down 43R (going 3W-5L) since the stream started
streamer is currently even 0R (going 0W-0L) since the stream started
```

When RR is missing, verified results remain visible: `streamer is currently going 6W-3L since the stream started (RR unavailable)`. Draws add a `D` count. Incomplete records include the username and an explicit unavailable message. The optional `?showUser=true` prefixes rank output, for example `streamer: Current Rank: Ascendant 2 | 67 RR`, and offline messages. It never duplicates the username in the new record format. Public errors use simple, provider-neutral messages; diagnostic headers and server logs identify the failure category.

An explicit-platform path is also supported: `/api/record/<name>/<tag>/<region>/<platform>/<twitch>` (and the same structure for rank). With four segments the last segment always means Twitch username, preserving the old API's structure.

Query-string equivalents:

```
/api/rank?name=My%20Name&tag=1234&region=na&platform=pc&twitch=streamer&showUser=true
/api/record?name=My%20Name&tag=1234&region=na&platform=pc&twitch=streamer
```

Encode each name/tag segment with `encodeURIComponent`; do not include the Riot ID's `#` separator. Encode spaces as `%20` in paths. Regions: `na`, `eu`, `ap`, `kr`, `latam`, `br`. Platforms: `pc`, `console`. Invalid or missing parameters return HTTP 400 plain text before contacting providers. Missing server credentials return HTTP 503. URLs without identity parameters no longer use environment defaults.

Use the exact Riot ID and region of the account being played on stream. The URL's region controls all rank and history requests; account metadata never forces a different region. Similar names can identify different accounts. The verified Eggsterr URL is `/api/record/ENVY%20Eggsterr/NJLTC/na/eggsterr?platform=pc` (two r's in both the Riot name and Twitch username).

Nightbot command responses:

```
$(urlfetch https://YOUR-DOMAIN.vercel.app/api/record/My%20Name/1234/na/streamer?platform=pc)
$(urlfetch https://YOUR-DOMAIN.vercel.app/api/rank/My%20Name/1234/na/streamer?platform=pc)
```

StreamElements custom command responses:

```
${urlfetch https://YOUR-DOMAIN.vercel.app/api/record/My%20Name/1234/na/streamer?platform=pc}
${urlfetch https://YOUR-DOMAIN.vercel.app/api/rank/My%20Name/1234/na/streamer?platform=pc}
```

Set a bot command cooldown of at least 10 seconds. Responses are UTF-8 plain text. Offline returns `Streamer is currently offline.`; failures return sanitized text with HTTP 503 or 429. Some bots may replace non-2xx bodies with their own error message.

## Accuracy and limitations

The UTC Helix `started_at` timestamp defines the session regardless of category. Completed competitive matches with start + duration strictly after that timestamp count, including matches started before the broadcast. Results join player and team by opaque IDs; RR signs never determine results. Draws appear as an additional `D` count. Ambiguous no-winner matches (including possible remakes) make the record unavailable rather than guessing. Per-match `last_change` is summed across promotions/demotions. Missing entries, unknown placement flags, or unranked updates make RR unavailable.

The live v4 endpoint supports `start` offsets. Cold backfills request between three and ten matches per page, sized from the remaining MMR updates plus a potential pre-stream anchor. Warm refreshes request three matches per page. This reduces repeated page overhead without increasing routine refresh cost. Fresh MMR update IDs identify missing details, which are fetched individually through the v4 match-detail endpoint. A completed pre-stream match must exist in both histories; every update from that anchor onward must have full details. On cold start, the live pages must also reach a pre-stream completion anchor; on warm refresh they must overlap previously verified history. Cached anchors alone do not certify newly fetched history. This preserves games with missing RR beyond the front page. Pagination stops once that proof is satisfied. Candidate anchors are checked by completion time, so a game starting before the stream and ending after it remains included. Short pages, stored totals, and empty lists are never accepted as proof of completeness. New accounts without an anchor and sessions exceeding available upstream history return incomplete-data text. If MMR is down, coverage cannot be verified and no match pages are requested.

Validated completed match details are retained for up to 24 hours, with a 500-match bound per player. Session matches and RR updates are retained for up to 24 hours, including games that later fall out of the live history window. This is instance memory, not a durable historical database. Stream IDs and start times keep session records separate; details can be reused across a restart, but calculations use the new boundary.

This checks completeness within the provider's live history window; upstream omission from BOTH independent lists cannot be detected. HenrikDev does not provide an absolute completeness attestation. If an absolute guarantee beyond this window is required, an authorized continuously collected match ledger with durable storage is necessary; a database alone cannot recover history already missing upstream. No stored-history fallback is used, because it can silently contain holes.

Status caches last 30 seconds; history/MMR/rank snapshots last 120 seconds. The command cache lasts ten seconds. Vercel CDN caches successful record responses for ten seconds and rank responses for 120 seconds; browsers receive `no-store`. Cache layers can compound: record updates may lag about 140 seconds, rank changes about 250 seconds, and stream restart detection about 50 seconds. These are cache bounds, not upstream ingestion guarantees. Errors are never CDN cached, and no `stale-if-error` or `stale-while-revalidate` policy is enabled. [Vercel header behavior](https://vercel.com/docs/caching/cache-control-headers).

OAuth tokens refresh before expiry and retry once on 401. Concurrent identical requests are coalesced. Henrik requests are serialized per API key within each instance so quota headers from one request govern the next. Fetches time out after ten seconds.

## The 30/minute plan

Henrik requests are serialized. When valid `X-RateLimit-Remaining` headers arrive, the guard uses that reported balance, which includes actual background Riot work, and reconciles the local rolling window to actual outgoing API calls. It pauses at three reported units remaining or after 27 outgoing calls in a rolling minute. It does not accumulate hypothetical uncached-download costs on top of a valid reported balance. Until valid quota headers arrive, or after requests fail without headers, it falls back to worst-case estimates: requested page size + two for history pages, two for individual details, and three for account/MMR/rank calls. Successful quota headers reconcile those fallback reservations as well. A 429 honors seconds or HTTP-date `Retry-After`, falling back to the provider reset time. No automatic immediate retries are made to Henrik.

A usual warm record refresh uses one three-match page plus one MMR call: eight conservatively reserved units every two minutes. A rank refresh reserves three more. Cold account lookup and backfill add work, and actual provider cost depends on upstream cache hits and Riot requests. These estimates are not an upstream cost guarantee. If backfill exceeds the current budget, the response is HTTP 429 with a friendly retry message and a Retry-After header calculated from the blocking cooldown. Diagnostic headers distinguish a local pause from an actual upstream 429. Successfully downloaded details remain cached so later calls resume missing IDs instead of fetching them again. Interrupted pagination resumes its offset when the live front-page IDs remain unchanged; changed front-page IDs restart traversal and use separate page-cache keys. No partial record is published as complete.

Instance memory is best effort on Vercel: cold starts and multiple instances can multiply upstream traffic. CDN response caching reduces cross-instance work but is not a global lock or shared match ledger, and can vary by edge location or URL. Use a consistent bot URL to maximize cache reuse. Configure Vercel Firewall rate limits for `/api/*` (for example 30 requests/minute per IP) before public promotion. All URL identities share the same API-key quota guard; unrelated player URLs consume the same 30/minute allowance. Bot cooldowns, request coalescing and caches reduce routine traffic but do not provide a distributed abuse barrier. To enforce a strict 30/minute budget across all instances and other apps using the key, a shared cache and atomic distributed limiter are required. This version adds no database or paid service; it safely reports provider rejection if the global budget is exhausted.

Mocked tests cover URL routing and validation, identity cache isolation, bot output options, calculations, quota reservation, header-based backoff, concurrent quota checks, refresh reuse, targeted backfill, resumed pagination, missing RR beyond the front page, retained RR, expiry, and stream restarts. Tests and build were run with a local Windows sandbox path-resolution workaround; that workaround is not included in the app. Live checks are documented in PROVIDER-FINDINGS.md; the October 14 changes must be committed and deployed to update the public service.

See [PROVIDER-FINDINGS.md](PROVIDER-FINDINGS.md) for verified endpoint choices and documentation.

## Diagnosing intermittent errors

A generic unavailable response does not prove that the Vercel app is down. Before the October 14 update, rate limits, timeouts, HTTP failures and invalid provider data all shared that message. Public errors now say “Stats are temporarily unavailable. Please try again shortly.” or include the retry time, without naming providers or internal limits. Error responses remain uncached and include `X-Statistics-Error` and `X-Request-Id` to distinguish the underlying causes. In Vercel runtime logs, search for the matching request ID and the `statistics_request_failed` event. Logs contain only controlled classifications and status fields, never credentials, request URLs, raw exceptions or provider response bodies.

`henrik_quota_guard` means this instance refused a request before sending it, based on the actual local call count, the reported remaining quota, or fallback estimates when headers were missing. The diagnostic header identifies the local guard; the public message only gives a retry time. `henrik_rate_limit` means the provider returned 429 or its cooldown is active. `henrik_http_500`, `henrik_timeout`, `henrik_network` and `henrik_invalid_response` identify other failure categories; Twitch has equivalent codes. Respect the response's `Retry-After` header. A sufficiently long cold backfill may still need another quota window, and multiple Vercel instances or another app using the key share the upstream allowance.

#   v a l o r a n t - s t r e a m - a p i  
 
