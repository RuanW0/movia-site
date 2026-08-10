---
type: metric
title: Example Metric — Monthly Active Users
description: Reference example of a metric definition entry.
tags: [example, metric]
source: src/db/schema.ts#sessions
---

# Monthly Active Users (MAU)

**Definition:** distinct users with at least one qualifying session in a
trailing 30-day window.

**Formula:** `count(distinct user_id) where last_session_at >= now() - interval '30 days'`

**Source of truth:** the `sessions` table (production).

**Caveats:** excludes soft-deleted users; internal/service accounts filtered out.
