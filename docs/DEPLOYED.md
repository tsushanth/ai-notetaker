# What is deployed

Newest first. Parity rule: what runs in production is on `main` (tree compared for the deployed paths). Deploys are `fly deploy --remote-only` from a clean checkout of `origin/main`.

| Component | Fly app | Release | Image | Built from | Date |
|---|---|---|---|---|---|
| Web (`web-app/`, scribeai.online) | `scribe-ai-web` | v23 | `registry.fly.io/scribe-ai-web:deployment-01M7P0BYDFYDQ9HQFB8TQJA0QZ` | `origin/main` at `95435c5` (merge of #65; `web-app/` tree identical to main) | 2026-11-18 (UTC) |

## 2026-11-20 Android 58.30 (versionCode 91), Play production, staged 20%
- Tag `play/android-58.30-vc91` = `origin/main` at `aa4bca2` (#69; the AAB was built from exactly this commit). Play production read-back: 58.30 vc91 `inProgress` userFraction 0.2, 58.28 vc89 `completed`. Package `com.kreativekoala.scribeai`, targetSdk 36 / minSdk 26 (unchanged), AAB sha256 `ddd94f8b35bdcada849a36033add2a70f5b971e9a90ac18fc8c5af70f701293b`.
- Shipped vs 58.28 (vc89): 7 new languages (Czech, Greek, Finnish, Hungarian, Romanian, Swedish, Ukrainian; 28 locales, machine translations, owner accepted), AI language follows the phone, mirrored arrows (#61, #62); 260 hard-coded English strings moved to `strings.xml` with a guard test (#67, #68); privacy text made accurate plus Privacy policy and Terms in the menu (#56); release network config HTTPS-only with system CAs only, no `READ_MEDIA_AUDIO`, optional account-deletion reason, no Android ID sent to the server (#58). Manifest vs 58.28: only `READ_MEDIA_AUDIO` removed; no permission added.
- Deliberately NOT shipped: the microphone foreground-service recording rewrite (#52, #54). Play rejected vc90 with "You must let us know whether your app uses any Foreground Service permissions"; the declaration is Console-only. Owner chose to ship without it; #64 reverted the service, `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_MICROPHONE`, `POST_NOTIFICATIONS`, the WorkManager sender and recovery. Recording is the 58.28 behavior (no locked-screen recording; a killed app loses an in-progress recording). The Play internal draft "58.29 (declaration)" vc90 is left untouched; vc90 is burned, hence vc91.
- Checks run: `testDebugUnitTest` 53 tests, 0 failures (incl. `LocalizationParityTest`, `NoHardcodedUiStringsTest`, `ReleaseNetworkAndPermissionPolicyTest`), `lintDebug` passes (warnings only), `bundleRelease` built from main; merged release manifest has no FOREGROUND_SERVICE*, foregroundServiceType, POST_NOTIFICATIONS or READ_MEDIA permission.
- NOT verified: no device run of the Play-signed build, no crash/ANR review of the new build, translations not reviewed by native speakers.
- Rollback: halt the production rollout in the Play Console (Release > Production > Halt rollout) and the 58.28 vc89 stays on the rest; to go back for everyone, re-promote vc89 in a new release (version codes cannot be reused or lowered).
- Promotion to 100% needs a 24-48 h crash and ANR review of vc91 (Play Console Android vitals) first. Not promoted beyond 20%.
- Web and backend changes in the same range (#55, #57, #65) are deployed separately and are not part of this AAB.

## 2026-11-17 Web: install-referrer tags on Play links, descriptive title and meta, SoftwareApplication JSON-LD (#65)
- Every Play link uses `web-app/src/lib/playLinks.ts`: `referrer=utm_source=scribeai_web&utm_medium=web&utm_campaign=<hero|footer|creators|checkout_success|llms>`. Convention: growth-research/LINK-CONVENTION.md.
- Verified live after deploy: homepage title, meta description, JSON-LD present; hero and footer Play links carry the tag; `llms.txt` link tagged; tagged URL returns HTTP 200 on play.google.com.
- Previous release v22 (2026-11-10) was built from the commit before this one (last `web-app/` commit `ff4582e`).
