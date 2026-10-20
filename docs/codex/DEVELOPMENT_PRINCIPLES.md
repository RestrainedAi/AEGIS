# Development DNA

Adopted September 14, 2026 from Thomas's explicit development principles and the supplied Agentic Engineering slides. These are operating requirements for feature planning, execution, handoff, and review.

## Sequence -> Conditional -> Loop

**Sequence:** define the customer outcome and acceptance checks, inspect the current state, order dependencies, assign responsibility, implement, integrate, and verify.

**Conditional:** choose the next action from observed results. Distinguish success, partial recovery, retryable failure, unavailable source, and a blocker requiring a decision. Agent/tool stop states guide execution but do not establish product completion.

**Loop:** return unmet acceptance checks to the responsible owner with the failing evidence and a concrete repair task. Preserve successful work. Bound retries by attempts/time and use backoff; when progress requires external change, record the blocker and resumption condition. Do not repeatedly wake unchanged blocked work or claim background persistence without a configured mechanism.

## Feature ownership and specialized teams

Every feature has exactly one accountable owner. That owner maintains scope, acceptance criteria, dependencies, integration, verification, and delivery status. Project coordination manages priorities and contracts between features.

Small bounded features can be executed by their owner. Split a large feature when it spans unrelated expertise, independent components, conflicting write surfaces, or too much context for focused execution. Use specialists by job/task type: for example source ingestion, storage, backend, UI, deployment, or verification. These are role examples, not agents that must all exist for every feature.

Each specialist has a bounded assignment, owned outputs, a focused set of relevant tools, and a defined handoff. The feature owner coordinates the team rather than absorbing all specialist work. Parallelize independent work; order dependent work explicitly. Respect the available execution slots and do not spawn agents simply to fill a roster.

Follow the existing workstream ownership and single-writer rules. Record role-to-agent assignments and reassignments in the existing board or brief, including which agent currently fills historical named roles. An owner is accountable even when specialists perform the work; role assignment alone does not create a persistent runtime agent.

## Context and handoff contract

Give each specialist the objective, relevant source paths and observations, applicable user instructions, preservation and authorization boundaries, owned files, dependencies, acceptance checks, and requested outputs. Include uncertainty and contradictory evidence. Avoid sending the entire conversation or presenting the coordinator's preferred answer as an established fact.

For independent verification, use fresh or deliberately limited context when supported. Reviewers need the requirements, actual artifacts, and relevant evidence. Do not claim that unused tools are technically inaccessible unless the platform actually restricts them. The slide's suggested small toolset is a design heuristic, not a universal numerical limit.

Every handoff records:

- what changed and where;
- checks performed and the observed results;
- unresolved issues, dependencies, and material uncertainty;
- the next owner/action or acceptance evidence supporting closure.

The receiving owner inspects the deliverable. Resolve disagreement by testing against the contract and evidence. Independent review should verify behavior rather than merely agree with the implementer.

## Definition of done

Before closure, require a named owner, satisfied acceptance checks, inspected specialist handoffs, successful integration checks, preserved originals/provenance, and a recorded disposition for every remaining issue. Use an independent specialist check for large features or consequential changes when available. For small changes, use proportionate verification and identify self-review honestly.

For ingestion and recovery, completion means: **discovered -> downloaded -> validated -> stored -> integrated -> published -> verified through the customer-facing path**, wherever each stage applies. A returned URL does not prove the file exists; a successful job does not prove complete source coverage. If customer-path verification is unavailable, record that gap rather than claim end-to-end success.

A feature with unmet required acceptance criteria is partial or blocked, not complete. Optional items may be deferred only with an explicit disposition, owner, and next action consistent with the agreed scope. Preserve successful work while failures are isolated and retried. Production services use durable service identities and supported credential renewal, not routine human sign-ins.

## Durable operating artifacts

Reuse the [existing feature test framework](../../test/README.md): each feature's `MASTER.md` and `suite.json` define its test contract. Disclose manual, optional, skipped, and unexecuted checks in handoffs and release evidence. A green run containing skips does not prove those acceptance criteria passed. Keep recovery loops consistent with the orchestrator's stop-on-failure behavior: diagnose and repair before resuming dependent tests.

Use the [existing project board](../board/README.md), whose `tasks.json` is the board-state authority, for feature status; attach a [feature brief](templates/FEATURE_BRIEF.md) where the board cannot hold sufficient detail. Avoid creating a competing source of truth. Before a pause or handoff, record current owner, state, evidence, dependencies, and next action so a later session can resume.

The root `AGENTS.md` makes these rules discoverable by coding agents. The pull-request template prompts ownership and evidence at review. Neither documentation nor a checked box proves that an agent team was instantiated or a runtime behavior was tested.
