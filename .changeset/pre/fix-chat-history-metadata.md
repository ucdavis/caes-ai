---
"@ucdavis/caes-ai-assistant-react": patch
"@ucdavis/caes-ai-protocol": patch
---

Remove transport version metadata after validating incoming chat events so it is not stored in message history and rejected on subsequent turns.

Keep protocol package versions aligned for the coordinated beta release; the v1 wire contract is unchanged.
