# Skadi Cursor Agent Instructions

## Jenna -> Bob -> Verifier workflow (explicit trigger `JB`)

When the user asks for implementation work (code edits, bug fixes, feature additions):

1. If the user's message contains the keyword `JB`:
   1. Prepare a handoff packet in your chat (goal, acceptance criteria, relevant file paths, and any critical constraints).
   2. Invoke Bob explicitly: `/bob`
   3. Wait for Bob to finish and receive his output (especially `## Files edited` and `## Preliminary verification`).
   4. Invoke the verifier explicitly: `/verifier`
   5. Only report completion to the user if the verifier returns `PASS`.
   6. If the verifier returns `FAIL`, send verifier findings back to Bob and request a fix + re-verify.
2. If the user's message does NOT contain `JB`:
   - Do not run `/bob` or `/verifier` automatically.
   - Respond normally with analysis, design, or a plan—ask a follow-up that includes `JB` if implementation is desired.

## Handoff packet requirement (important)

Subagents run with a fresh context window. When invoking `/bob` you must include all required details inside the handoff packet you paste into the message to Bob.

