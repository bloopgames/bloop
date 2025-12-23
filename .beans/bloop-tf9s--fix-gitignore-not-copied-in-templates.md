---
# bloop-tf9s
title: Fix .gitignore not copied in templates
status: completed
type: bug
priority: normal
created_at: 2025-12-23T17:03:23Z
updated_at: 2025-12-23T17:04:14Z
---

npm doesn't publish .gitignore files. Rename to 'gitignore' in templates and rename back when scaffolding.

## Checklist
- [ ] Update bin/publish.ts to save .gitignore as gitignore
- [ ] Update create-bloop/index.ts to rename gitignore to .gitignore