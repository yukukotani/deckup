# Plan 020: Remove legacy documentation redirects after traffic approval

> **Executor instructions**: This plan has an external approval gate. Do not
> delete redirects solely because repository search shows no inbound links.
>
> **Drift check (run first)**: `git diff --stat d145c09..HEAD -- apps/web/astro.config.ts apps/web/src/content/docs/ apps/web/wrangler.jsonc`

## Status

- **Priority**: P3
- **Effort**: S
- **Risk**: MED
- **Depends on**: none
- **Category**: docs
- **Planned at**: commit `d145c09`, 2026-07-12

## Why this matters

The docs app maintains seven routes from its previous information architecture.
They are absent from the current content tree and navigation, but six were
previously published pages and may have external links. The configuration can
be simplified only after the site owner accepts or disproves that compatibility
cost.

## Current state

`apps/web/astro.config.ts:7-15` maps seven legacy paths to current pages:
`/quickstart`, `/introduction/work-with-ai`, `/concepts/deck-authoring`, and
four `/reference/*` paths. Current sidebar entries at `:20-49` use only the new
`/introduction`, `/guides`, and `/references` hierarchy. The repo contains no
traffic analytics or deployment logs.

## Commands you will need

| Purpose     | Command                                                | Expected                         |
| ----------- | ------------------------------------------------------ | -------------------------------- |
| Check/build | `vp run @deckup/web#check && vp run @deckup/web#build` | pass                             |
| Full        | `vp run ready`                                         | pass                             |
| Deploy      | `vp run deploy:web`                                    | only with explicit authorization |

## Scope

**In scope**:

- `apps/web/astro.config.ts`

**Out of scope**: sidebar/content changes, Cloudflare dashboard rules, 410
responses, deployment configuration, and generated `apps/web/dist` output.

## Git workflow

- Branch: `advisor/020-remove-doc-redirects`
- Conventional commit; do not deploy, push, or open a PR unless instructed.

## Steps

### Step 1: Complete the external traffic gate

Using Cloudflare analytics/logs and Search Console if available, inspect all
seven paths with and without trailing slashes over the maximum retained period
(preferably since docs launch). Check request volume, non-bot traffic,
referrers, search results/backlinks, and any dashboard Redirect/Bulk Redirect
rules.

Proceed only if either:

1. evidence shows no meaningful use; or
2. the site owner explicitly accepts seven 404s despite missing/incomplete
   telemetry and records that approval.

If neither is true, mark the plan BLOCKED and keep the redirects.

### Step 2: Delete only the redirect block

Remove `redirects: { ... }` from `apps/web/astro.config.ts`. Do not alter site,
integrations, sidebar, content, or Wrangler configuration.

### Step 3: Verify build artifacts

Build, then assert all seven old `apps/web/dist/<path>/index.html` files are
absent and these current routes remain present:

- `introduction/getting-started`
- `guides/working-with-ai`
- `guides/writing-slides`
- `guides/authoring-themes`
- `references/cli`
- `references/theme`

Run `vp run ready` and ensure only the config file is tracked as changed.

### Step 4: Optional authorized deployment

Only when explicitly instructed, deploy and verify old paths return 404 while
new paths return 200. If old paths remain live, investigate caches/dashboard
rules rather than deleting unreviewed Cloudflare configuration.

## Test plan

No unit-test framework is added for a seven-line config deletion. Static build
artifact checks are the direct route-level verification.

## Done criteria

- [ ] Traffic evidence or explicit owner approval is recorded.
- [ ] The seven Astro redirects are gone.
- [ ] Old route artifacts are absent; current routes exist.
- [ ] `vp run ready` passes.
- [ ] Only `apps/web/astro.config.ts` changed; index updated.

## STOP conditions

- Any old route has meaningful traffic/backlinks without approval to break it.
- Telemetry is unavailable and the owner has not explicitly approved 404s.
- Cloudflare owns duplicate redirects or the desired status is 410.
- Deployment ownership/procedure is unknown.

## Maintenance notes

Redirects are cheap when they serve real users. Reviewer should demand the
external decision record; repository-local absence of references is not enough.
