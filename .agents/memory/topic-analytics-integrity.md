---
name: Topic analytics integrity
description: How the analyzer treats incomplete imported mock records and topic-level recommendations.
---

Topic recommendations must be based on topic rows with actual attempted questions, not merely on a default question allocation. Imported or legacy mocks without topic-level results stay unobserved until the user edits and saves their breakdown.

**Why:** Assigning a sample allocation to incomplete history makes the revision queue recommend topics the user has not actually measured.

**How to apply:** Preserve the valid 25-question grouped editing template for incomplete records, but keep those records out of strength, weakness, and revision calculations until topic attempts are present.