# AEGIS Edge Case Ticket Stack

## Summary

Use one epic for edge cases and one Jira per edge-case family.

That means:

1. `EPIC-21` is the home for all edge cases and production anomalies
2. each child ticket should represent one validation rule, failure boundary, or anomaly family
3. new examples should reuse an existing edge-case ticket only when they are clearly the same rule problem

## Grouping Rule

Use the same Jira when:

1. the same minimum-field rule is being violated
2. the same fallback rule is wrong
3. the same validation boundary is unclear
4. the same recovery policy applies

Open a new Jira when:

1. a different threshold must be defined
2. a different layer owns the decision
3. the failure should be contained or recovered differently

## Current Edge Case Tickets

### `AEGIS-EDGE-001`
Define minimum viable song thresholds across import, Vault, and publish.

This ticket should answer:

1. what fields are required before harvest accepts a song as valid
2. what fields are required before the Vault renders a song card
3. what fields are required before playback is allowed
4. what fields are required before publish or queue actions are enabled

### `AEGIS-EDGE-002`
Serve private song media without stale public fallback behavior.

This ticket should answer:

1. when private `gs://` media should be proxied through the app
2. what the fallback order is for artwork and audio
3. when the Vault should show `media unavailable`
4. when the Vault should never guess with stale public CDN media

## Example Reuse Guidance

If another malformed song appears with:

1. no title
2. no created date
3. partial media only

that belongs under `AEGIS-EDGE-001` if the question is still:

`How much can be missing before the song is not valid enough to show or use?`

If another song shows:

1. wrong artwork
2. wrong audio
3. stale CDN media
4. private GCS media that exists but is not being served correctly

that belongs under `AEGIS-EDGE-002`.

## Intent

This structure keeps the board organized:

1. one epic for all edge cases
2. one ticket per edge-case type
3. many examples can feed the same Jira when they share the same rule problem
