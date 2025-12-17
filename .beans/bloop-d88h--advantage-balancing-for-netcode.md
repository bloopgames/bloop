---
# bloop-d88h
title: Advantage balancing for netcode
status: todo
type: feature
priority: low
created_at: 2025-12-16T22:55:44Z
updated_at: 2025-12-16T22:55:44Z
---

Detect when running ahead of peers and drop frames to prevent teleporting.

## Problem

One player sees the other teleporting a lot at the start of sessions. This is caused by advantage imbalance - one client is running ahead.

## Solution

Detect advantages and drop frames if we are running ahead of the peers.

Tier B priority - enhancement to netcode, not blocking launch.