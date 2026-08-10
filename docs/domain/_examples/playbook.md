---
type: playbook
title: Example Playbook — Incident Response
description: Reference example of an operational playbook entry.
tags: [example, playbook]
---

# Incident Response

1. Acknowledge the alert and declare severity.
2. Page the on-call owner of the affected service.
3. Mitigate (rollback or feature-flag off) before root-causing.
4. Write the post-incident note under `docs/domain/`, linking the affected
   schema/metric with a bundle-relative path.
