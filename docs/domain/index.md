---
type: index
title: Domain Catalog
description: Versioned domain knowledge for this repo, Open Knowledge Format (OKF) compatible.
tags: [domain, okf]
---

# Domain Catalog

Durable, versioned domain knowledge for this repository — metric definitions,
data schemas, and operational playbooks. Aligned to the Open Knowledge Format
(OKF) v0.1 for future export.

## Frontmatter contract (OKF)

Every file in `docs/domain/` MUST declare a `type` field. Recommended values:
`metric`, `schema`, `playbook` (free-string, extensible). Optional: `title`,
`description`, `tags`. For `metric` / `schema` entries, declare `source:` (a
repo-relative `path` or `path#symbol`) anchoring the concept to where its truth
lives in code, so the definition can be grounded against the source.
Cross-document links use bundle-relative paths (`/...`)
so the catalog stays portable when exported as an OKF bundle.

## When to use this vs other systems

| System | Holds | Lifecycle |
|---|---|---|
| `docs/domain/` (here) | Durable domain knowledge, OKF-exportable | Versioned, long-lived |
| `memory-bank/` | Session memory, gotchas, arc topics | Working/rolling |
| Consultoria | Client-facing deliverables | Per-engagement |

## Entries

- [Playbook: Domain overview](/docs/domain/playbook-domain-overview.md) — movia-site product/domain pointer

- [Example: metric](/docs/domain/_examples/metric.md)
- [Example: schema](/docs/domain/_examples/schema.md)
- [Example: playbook](/docs/domain/_examples/playbook.md)

Add new entries here as you create them.
