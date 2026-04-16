# AEGIS Auth, Admin, Tiering, and Monetization Plan

Date: 2026-04-07

## Executive Summary

AEGIS is no longer just an internal operator tool. The next product phase needs a real SaaS
foundation:

1. login and identity
2. clean separation between customer accounts and internal admin authority
3. entitlement-based feature gating
4. upgrade and renewal flows
5. pricing logic that reflects actual cloud cost drivers

The current repo is not there yet. It has YouTube OAuth and private-application posture, but it
does not yet have end-user login, workspace separation, billing, subscription state, or a real
admin control center.

## Current State

What exists today:

- Firestore-backed content authority in `sunoSongs`
- distribution authority in `ytUploadQueue`
- a live Vault UI and operator-facing publish controls
- YouTube OAuth for upload/runtime flows
- documents that already acknowledge multi-user auth is not mature yet

What does not exist yet:

- end-user sign-up or login
- tenant or workspace separation
- paid plan records
- entitlements or feature gates
- self-serve upgrade and renewal flows
- admin dashboards for customer oversight, quotas, or billing

## Recommended Platform Backbone

### 1. Identity and Login

Recommended choice:

- Firebase Authentication with Identity Platform

Why:

- AEGIS already lives on Google Cloud and Firestore
- Identity Platform adds multi-tenancy and stronger operational controls without changing the
  Firebase Auth developer model
- it keeps auth, Firestore rules, and account claims inside the same cloud control plane

Recommended auth modes:

- Google sign-in
- email magic link
- optional password auth only if needed later

Deferred:

- SAML / enterprise SSO
- MFA for all users by default

### 2. Account and Workspace Separation

Use a hard model:

- `user`
  - human identity
- `workspace`
  - the customer-owned container for sources, vault assets, billing plan, and quotas
- `membership`
  - relationship between a user and a workspace
- `role`
  - permissions inside the workspace

Recommended roles:

- `owner`
- `admin`
- `editor`
- `viewer`
- `platform_admin` for your master control center only

Rule:

- songs and source records remain authoritative content objects
- workspace ownership and access are layered on top, not mixed into the core content recipe

### 3. Admin Control Center

Create a true platform admin surface for you.

It should own:

- user lookup
- workspace lookup
- plan and entitlement overrides
- storage and source counts
- harvest status across workspaces
- queue backlog and publish health
- export freshness status
- billing status and failed renewals
- manual lock / unlock / suspend controls
- support and recovery actions

This should be separate from the customer Vault experience.

### 4. Billing and Upgrades

Recommended choice:

- Stripe Payments + Stripe Billing

Why:

- subscriptions, trials, coupons, and upgrade/downgrade flows are already productized
- usage-based and flat recurring plans are both supported
- customer portal support exists

Recommended billing model:

- use Stripe Checkout for first purchase
- use Stripe Billing for recurring plans
- use Stripe Customer Portal for self-serve payment updates and cancellation
- store the resulting plan and entitlement mirror in Firestore

Rule:

- Stripe is billing authority
- Firestore is product-access mirror and entitlement authority

## Tiering Model

### Product Families

Split the offering into the two identities already forming:

- `sundrop.music`
  - capture, harvest, retrieval, creator memory, source preservation
- `sundrop.cloud`
  - sovereign vault, management, publishing, admin, and business-grade controls

### Tier Structure

Recommended public tiers:

#### 1. Free — Explorer

Purpose:

- let creators see the value quickly

Included:

- one workspace
- one SUNO source connection
- limited vault browsing
- limited exports
- no YouTube automation
- no admin team members
- no advanced search or style/lyric-heavy workflows beyond a small cap

Use this as acquisition, not as the main margin tier.

#### 2. Creator — Core Paid Tier

Purpose:

- serious solo creator using harvest + vault regularly

Included:

- larger source limits
- full vault browsing and preservation outputs
- lyrics artifacts
- normalized styles
- SunSeeker-style retrieval
- limited YouTube publishing automation
- modest storage quota
- one owner plus a small number of collaborators

This should likely become the main monthly plan.

#### 3. Studio — Professional Tier

Purpose:

- creators and small teams using the vault as operational backbone

Included:

- more storage
- more source slots
- more automation volume
- richer YouTube workflow controls
- publish history and distribution management
- more collaborators
- stronger operational reporting

#### 4. Sovereign / Business

Purpose:

- higher-volume or business customers who need tighter control

Included:

- largest quotas
- priority processing
- more team seats
- advanced admin controls
- policy controls
- support commitments
- optional custom onboarding

This should be annual-first or contact-sales-first.

## Feature Gating Model

Do not gate by route names alone. Gate by entitlements.

Recommended entitlement families:

- `sources.max`
- `workspace.members.max`
- `vault.search.advanced`
- `vault.export.download`
- `lyrics.artifacts`
- `styles.normalized`
- `youtube.publish.enabled`
- `youtube.publish.monthly_limit`
- `admin.reports`
- `support.priority`
- `storage.gb.included`

Rule:

- plan -> entitlement bundle
- entitlement bundle -> actual UI/API access
- admin override can add or subtract entitlements without changing plan code

## Duration and Packaging Strategy

Recommended billing durations:

- monthly
- quarterly
- annual

Use cases:

- monthly for normal self-serve adoption
- quarterly for modest discount and retention
- annual for best margin and lower churn

Avoid as standard plan shapes:

- daily
- weekly
- perpetual

Reason:

- daily and weekly create churn noise, support noise, and renewal complexity
- perpetual is a bad fit for cloud-hosted storage, compute, and maintenance-backed products

If you want a short-term offer:

- use a time-boxed trial or promotional pass, not a true daily or weekly core plan

If you want a lifetime offer:

- limit it to a narrowly scoped one-time license later, such as a local export toolkit or
  downloader utility, not the hosted vault or automated cloud workflows

## Cost Drivers To Price Against

### Cloud Run

Official pricing indicates pay-per-use with free tier and published examples for lightweight
services and jobs. Public list pricing shown by Google includes CPU at `$0.00001800 / vCPU-second`
and memory at `$0.00000200 / GiB-second`, plus free monthly allowances for both. Cloud Run also
calls out that source deployments can add Cloud Build and Artifact Registry costs.

Use Cloud Run costs primarily to price:

- viewer serving
- API/backend runtime
- harvest jobs
- upload jobs

### Firestore

Firestore cost comes from:

- document reads
- writes
- deletes
- storage
- network egress

Firebase documents show one free database per project with no-cost quotas such as:

- `1 GiB` stored data
- `50,000` reads/day
- `20,000` writes/day
- `20,000` deletes/day
- `10 GiB/month` outbound transfer

Beyond that, plan pricing should assume usage-based growth in reads, writes, and storage.

### Cloud Storage

Cloud Storage pricing is driven by:

- stored GiB
- operations
- network transfer

Google’s current pricing pages show:

- standard storage starting at `$0.02 / GiB-month`
- operation pricing starting at `$0.0004 / 1,000 operations`
- outbound/general transfer starting at `$0.08 / GiB`

For AEGIS, storage is likely one of the clearest direct cost drivers because media assets,
artwork, lyrics artifacts, and export files accumulate continuously.

### Cloud Build

Cloud Build pricing is relevant for deployment frequency.

Google’s pricing page shows:

- `2,500` free build minutes per month on `e2-standard-2`
- `e2-standard-2` at `$0.006 / minute` after that

This is not a customer-level variable cost in the same way storage is, but it matters for
operating margin.

### Artifact Registry

Artifact Registry pricing matters for stored build images.

Google’s pricing page shows:

- first `0.5 GB` free
- then `$0.10 / GB-month`

This is usually a smaller platform cost, but it should still be tracked in the ops model.

### Authentication

Firebase Authentication with Identity Platform is attractive for this stack because the free/low
cost threshold is generous for early growth.

Firebase documents show:

- Spark projects capped at `3,000` DAUs for most providers when upgraded
- Blaze projects include `50,000` MAUs no-cost for Email/Social/Anonymous/Custom
- above that, MAU pricing begins

This means auth is unlikely to be the first cost pain point unless usage grows materially.

### Billing Fees

Stripe Billing and Payments introduce revenue-side fees.

Stripe’s current public pricing shows:

- Stripe Billing pay-as-you-go at `0.7%` of billing volume
- Stripe Payments standard online cards at `2.9% + 30¢`
- ACH direct debit at `0.8%`, capped at `$5`

These fees should be modeled into paid tier margins from day one.

## Recommended Starting Commercial Strategy

Use a simple launch structure first:

- Free
- Creator monthly / quarterly / annual
- Studio monthly / quarterly / annual
- Sovereign / Business annual or custom

Do not launch with too many feature flags or too many price points.

Recommended first commercial gates:

- number of sources
- storage included
- number of team members
- advanced search / retrieval
- YouTube publishing volume
- admin and reporting features

## Suggested Initial Price Framing

These are planning placeholders, not final market prices:

- Free
  - `$0`
- Creator
  - monthly: `$19 to $39`
  - quarterly: roughly `10%` effective discount
  - annual: roughly `15% to 20%` effective discount
- Studio
  - monthly: `$79 to $149`
  - quarterly: modest discount
  - annual: stronger discount
- Sovereign / Business
  - custom or high annual commitment

Reasonable rule:

- include a healthy storage allowance in the paid tiers
- charge for additional storage or automation usage once real customer behavior is measured

Do not lock exact prices until:

1. one month of real storage growth is measured
2. one month of real Cloud Run usage is measured
3. one month of real Firestore read/write shape is measured

## Implementation Order

### Phase 1 — Identity and Workspace Foundation

- add Firebase Auth / Identity Platform
- add `users`, `workspaces`, `memberships`
- add role model and platform admin role
- scope all future customer actions to workspace ownership

### Phase 2 — Entitlements and Tier Gating

- add `plans`
- add `entitlements`
- add Firestore entitlement mirror
- gate UI and backend routes by entitlements

### Phase 3 — Billing

- add Stripe Checkout
- add Stripe Billing subscriptions
- add Stripe webhooks
- mirror active plan and renewal state into Firestore

### Phase 4 — Admin Control Center

- add platform admin dashboard
- add customer workspace controls
- add usage, quota, and billing visibility
- add suspend / override / support actions

### Phase 5 — Reporting and Margin Discipline

- expose storage totals
- expose Cloud Run usage estimates
- expose export freshness and backlog health
- track per-workspace operating cost estimates

## Strong Product Rules

1. The Vault remains the Song Master Recording and Recipe.
2. Billing and entitlements must not mutate source-of-truth song records.
3. Workspace separation must be explicit and enforceable in backend rules.
4. Platform admin powers must be isolated from customer admin powers.
5. Perpetual pricing should not be used for hosted, continuously operated cloud features.

## Reference Pricing Sources

- Google Cloud Run pricing:
  - https://cloud.google.com/run/pricing
- Firebase / Firestore pricing and limits:
  - https://firebase.google.com/docs/firestore/pricing
  - https://firebase.google.com/pricing
- Firebase Auth with Identity Platform:
  - https://firebase.google.com/docs/auth
- Google Cloud Storage pricing:
  - https://cloud.google.com/storage/
- Cloud Build pricing:
  - https://cloud.google.com/build/pricing
- Artifact Registry pricing:
  - https://cloud.google.com/artifact-registry/pricing
- Stripe Payments pricing:
  - https://stripe.com/pricing
- Stripe Billing pricing:
  - https://stripe.com/billing/pricing
