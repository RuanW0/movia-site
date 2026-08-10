---
type: playbook
title: Domain overview — movia-site
description: Domain knowledge catalog for movia-site.
tags: [domain, overview, fleet-adoption]
source: package.json
---

# Domain overview — movia-site

Domain knowledge catalog for movia-site.

## Why this catalog exists

This repo adopted the fleet `docs/domain/` OKF catalog so durable domain
knowledge (metrics, schemas, playbooks) has a single, versioned home —
separate from session memory and ADRs.

## Next entries

Add real `metric`, `schema`, or `playbook` files under `docs/domain/` with:

- mandatory frontmatter `type:`
- `source:` pointing at the code or doc that owns the truth
- a one-line definition (do not duplicate long specs — link them)

## Sources

- Product surface: [`README.md`](/README.md) (when present)
- Package identity: `movia-site`
