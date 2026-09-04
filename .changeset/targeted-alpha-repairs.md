---
"@ucdavis/caes-ai-protocol": patch
"@ucdavis/caes-ai-assistant-react": patch
---

Validate version 1 message, event and interrupt payloads, reject unknown wire fields,
and enforce accepted client tool argument and result schemas. Keep each tool schema's
compiler and ID namespace independent.
