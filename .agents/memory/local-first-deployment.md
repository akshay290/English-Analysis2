---
name: Local-first deployment
description: Durable product decision for the SSC English mock analyzer's persistence and hosting model.
---

The analyzer intentionally uses browser-local persistence and JSON import/export rather than accounts, a hosted database, or external services. It is packaged as a static Vite site with a root Vercel configuration for GitHub-based deployment.

**Why:** The user's priority is to import the project easily from GitHub into Vercel and keep the tool simple to operate. The study history is personal and can be moved between devices through export/import.

**How to apply:** Preserve the no-secrets/no-backend deployment path unless the user explicitly asks for cross-device sync, authentication, or hosted storage.