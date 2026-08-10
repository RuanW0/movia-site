---
type: schema
title: Example Schema — User
description: Reference example of a domain schema entry.
tags: [example, schema]
source: src/db/schema.ts#users
---

# User

Core identity entity.

| Field | Type | Notes |
|---|---|---|
| id | uuid | primary key |
| email | text | unique, not null |
| created_at | timestamptz | default now() |

**Relationships:** has many `sessions`; has one `profile`.
