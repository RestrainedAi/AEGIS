# Development operating rules

Read [development principles](docs/codex/DEVELOPMENT_PRINCIPLES.md) before planning or implementing a feature. Use [the feature brief](docs/codex/templates/FEATURE_BRIEF.md) to record ownership, specialist assignments, acceptance evidence, and remaining work in the existing project tracking system.

- Structure work as **Sequence -> Conditional -> Loop**: order dependencies, branch on observed results, then repeat repair and verification until acceptance passes or a specific blocker is recorded. Use bounded retries and explicit resumption conditions.
- Assign **one accountable owner per feature**. Small features may stay with one agent. Large features require focused specialists under that owner; do not overload one agent with unrelated jobs or all implementation and review responsibilities.
- Give specialists bounded outputs, relevant tools and context, dependencies, and acceptance checks. Preserve user instructions and material contrary evidence. Prefer a fresh or limited context for independent verification.
- Treat specialist completion as a handoff. The feature owner inspects artifacts, integrates changes, and verifies the customer outcome before closing the feature.
- Maintain one writer per shared surface. Follow [existing workstream ownership](docs/codex/AEGIS_Workstream_Ownership_And_Change_Control.md); these principles do not replace the recorded Epicurus/Confucius responsibilities. The coordinator records which actual available agent fills each role before work starts.
- Persist owner, status, dependencies, evidence, unresolved items, and next action in the existing board or feature brief. Runtime agents are temporary; never imply a named role is a permanently running agent.
- A successful request, tool call, test, or model turn is evidence for that step only. Use explicit complete, partial, and blocked outcomes. Do not close an unfinished feature because a specialist stopped.
- Preserve original data and provenance. Newly discovered data must be validated, stored, integrated, and checked in the published/customer-facing result where applicable. Production operation must not depend on a daily personal sign-in.
- Verify the actual checkout and deployed revision before release; local source can lag production. Preserve unrelated changes and apply the existing authorization boundaries.

The [master source of truth](docs/codex/AEGIS_MASTER_SOURCE_OF_TRUTH.md) remains the entry point for product, schema, deployment, and identity authority. These instructions supplement those contracts.

## Repository ownership rule (Thomas, September 23, 2026)

Make changes only in our local working copies. Push commits and open pull requests only in GitHub repositories owned by RestrainedAi or another owner explicitly approved by Thomas. Never push changes or open contribution pull requests upstream. Keep third-party upstream remotes fetch-only, with push URLs disabled. Import upstream changes only when explicitly requested. Preserve uncommitted changes before cloning or changing remotes.

Owned suno-api working copy: `C:/Users/blahn/SUNO YouTube Pipeline/owned-repositories/suno-api`. The former `C:/Users/blahn/suno-api` copy is preserved, with upstream pushes disabled. No owned GitHub suno-api repository has been created yet; development is local-only until one is configured. AEGIS remains in the active checkout specified above, using our verified `RestrainedAi/AEGIS` GitHub repository.
