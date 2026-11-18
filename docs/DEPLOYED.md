# What is deployed

Newest first. Parity rule: what runs in production is on `main` (tree compared for the deployed paths). Deploys are `fly deploy --remote-only` from a clean checkout of `origin/main`.

| Component | Fly app | Release | Image | Built from | Date |
|---|---|---|---|---|---|
| Web (`web-app/`, scribeai.online) | `scribe-ai-web` | v23 | `registry.fly.io/scribe-ai-web:deployment-01M7P0BYDFYDQ9HQFB8TQJA0QZ` | `origin/main` at `95435c5` (merge of #65; `web-app/` tree identical to main) | 2026-11-18 (UTC) |

## 2026-11-17 Web: install-referrer tags on Play links, descriptive title and meta, SoftwareApplication JSON-LD (#65)
- Every Play link uses `web-app/src/lib/playLinks.ts`: `referrer=utm_source=scribeai_web&utm_medium=web&utm_campaign=<hero|footer|creators|checkout_success|llms>`. Convention: growth-research/LINK-CONVENTION.md.
- Verified live after deploy: homepage title, meta description, JSON-LD present; hero and footer Play links carry the tag; `llms.txt` link tagged; tagged URL returns HTTP 200 on play.google.com.
- Previous release v22 (2026-11-10) was built from the commit before this one (last `web-app/` commit `ff4582e`).
