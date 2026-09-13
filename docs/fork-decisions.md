# Fork decisions

Every behaviour this fork changes inside official management-center files,
and the command that proves each one still works.

The fork is a rebase queue: `main` is the upstream release tag we track, plus
one commit per change, with no merge commits. Branch protection rejects direct
pushes and merge commits, so every change lands as one squash-merged PR. The
commits hold the code; this file holds the why and the proof.

After rebasing onto a new upstream release, run:

```bash
bash scripts/fork-verify.sh
```

That script parses this file directly, so there is no second copy to keep in
sync — edit a decision here and the runner picks it up. CI job
`fork-decisions` runs the same script on PRs and on `main`.

Changing an official file? Add a section here with a command that fails
without your change. A decision with no command is a decision nothing
protects. Changes confined to fork-owned files (no upstream counterpart)
cannot conflict on sync and need no section.

## muse-oauth-panel

**Muse OAuth login card (muse-spark subscriptions)**

OAuth page exposes the backend `muse-auth-url` device flow completely from
the UI: Muse provider card, icon, `muse-code` aliases, auth-file
type/presets/icons, and `muse_oauth_*` / `filter_muse` strings in
en/zh-CN/zh-TW/ru. Upstream issue
`router-for-me/CLIProxyAPI#5777`; drop this commit when upstream ships it.

```bash
bun test tests/museOAuth.test.ts
grep -q "id: 'muse'" src/pages/OAuthPage.tsx
grep -q "muse_oauth_title" src/i18n/locales/en.json
```

## muse-quota

**Muse subscription usage panel (rolling + weekly windows)**

Quota page, auth-file cards, and timeline lanes cover muse files via a
dedicated adapter: the key endpoint is proxied through the backend api-call
with the stored account token (empty probe body, no re-onboarding), and only
percent/tier/identity fields are kept — the minted api_key is never stored or
rendered. 429s surface a retry-later message instead of a raw error. Meta
omits subs_usage entirely for some active subscriptions (observed live on
the Everyday Usage tier, intermittently — windows come and go between
probes): that parses to a success state showing tier plus a
no-windows note, never an error.

```bash
grep -q "muse: { ...MUSE_CONFIG" src/features/quota/providers/index.ts
bun test tests/museQuota.test.ts
```

## muse-quota-page-map

**Quota page maps every provider tab or it crashes, not degrades**

`quotaByType` was a hardcoded five-provider literal behind an `as unknown`
cast, so the first muse file crashed the whole Quota route reading
`[file.name]` off `undefined`. The literal now uses `satisfies
Record<QuotaProviderType, …>` instead of a cast: the next unmapped provider
fails type-check (CI) rather than the route at runtime.

```bash
grep -q "muse: museQuota" src/features/quota/QuotaPage.tsx
grep -q "satisfies Record<QuotaProviderType" src/features/quota/QuotaPage.tsx
bun run type-check
```

## opencode-zai-panel

**OpenCode key import + Z.AI OAuth cards and both quota adapters**

OAuth page gains the Z.AI browser-flow card (zcode:// paste-back, same UX as
the xAI manual flow) and the OpenCode Go key-import card (validated save via
the backend import endpoint). Quota page, auth-file cards, and timeline lanes
cover both providers; the page map already guards new providers with
`satisfies`, extended here to the two new slices.

```bash
grep -q "id: 'zai'" src/pages/OAuthPage.tsx
grep -q "opencode: opencodeQuota" src/features/quota/QuotaPage.tsx
bun test tests/opencodeQuota.test.ts tests/zaiQuota.test.ts
```
