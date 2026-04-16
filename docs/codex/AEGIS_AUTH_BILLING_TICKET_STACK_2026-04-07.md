# AEGIS Auth, Admin, Tiering, and Billing Ticket Stack

Date: 2026-04-07

## Objective

Break the next platform stage into implementation-safe workstreams:

1. identity
2. workspace separation
3. entitlements
4. billing
5. admin control center
6. cost visibility

## Stream 1 — Identity and Workspace Foundation

### AEGIS-AUTH-001

Title:

- Add Firebase Authentication with Identity Platform backbone

Outcome:

- users can sign in with Google and email link
- auth context is available to the Vault app

### AEGIS-AUTH-002

Title:

- Add workspace, membership, and role data model

Outcome:

- support `owner`, `admin`, `editor`, `viewer`, `platform_admin`
- users can belong to more than one workspace safely

### AEGIS-AUTH-003

Title:

- Add Firestore access rules and backend authorization boundary

Outcome:

- workspace separation is enforced in reads and writes
- platform admin actions are isolated explicitly

## Stream 2 — Entitlements and Tier Gating

### AEGIS-BIZ-001

Title:

- Define plan and entitlement schema

Outcome:

- plans map cleanly to entitlements
- admin overrides are additive and reversible

### AEGIS-BIZ-002

Title:

- Implement backend entitlement checks for gated routes

Outcome:

- publish, advanced search, export, and workspace actions can be gated safely

### AEGIS-BIZ-003

Title:

- Implement frontend feature gating and upgrade prompts

Outcome:

- the UI reflects the active entitlement model without breaking source truth

## Stream 3 — Billing and Upgrades

### AEGIS-BILL-001

Title:

- Add Stripe product, price, and subscription model

Outcome:

- Free, Creator, Studio, and Sovereign tiers exist in billing authority

### AEGIS-BILL-002

Title:

- Add Stripe Checkout and self-serve upgrade flow

Outcome:

- new users can start paid plans cleanly

### AEGIS-BILL-003

Title:

- Add Stripe webhook ingestion and Firestore billing mirror

Outcome:

- subscription state, renewal state, and cancellation state are mirrored into product access

### AEGIS-BILL-004

Title:

- Add Customer Portal and downgrade/cancel handling

Outcome:

- payment management is self-serve
- access changes follow subscription truth safely

## Stream 4 — Admin Control Center

### AEGIS-ADMIN-001

Title:

- Build platform admin dashboard shell

Outcome:

- you can inspect users, workspaces, plans, and health in one place

### AEGIS-ADMIN-002

Title:

- Add workspace controls and support actions

Outcome:

- lock, unlock, suspend, override, and support actions exist with auditability

### AEGIS-ADMIN-003

Title:

- Add publish, harvest, and export operational oversight

Outcome:

- backlog, queue health, export freshness, and workspace issue states are visible centrally

## Stream 5 — Cost and Margin Visibility

### AEGIS-COST-001

Title:

- Define cost model per workspace

Outcome:

- storage, runtime, and billing fees can be estimated per tenant

### AEGIS-COST-002

Title:

- Add storage and usage metering

Outcome:

- workspace-level storage and automation usage can be surfaced in the app

### AEGIS-COST-003

Title:

- Add internal margin reporting

Outcome:

- plan pricing can be adjusted based on observed cost reality, not guesses

## Recommended Sequencing

1. `AEGIS-AUTH-001`
2. `AEGIS-AUTH-002`
3. `AEGIS-AUTH-003`
4. `AEGIS-BIZ-001`
5. `AEGIS-BIZ-002`
6. `AEGIS-BILL-001`
7. `AEGIS-BILL-002`
8. `AEGIS-BILL-003`
9. `AEGIS-ADMIN-001`
10. `AEGIS-COST-001`

## Guardrails

1. Preserve the Vault as the Song Master Recording and Recipe.
2. Never let billing or entitlement logic mutate original SUNO source truth.
3. Keep platform admin authority separate from customer workspace authority.
4. Do not offer perpetual hosted plans for storage and automation-backed features.
