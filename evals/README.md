# Evals

This directory holds a harness-evals suite scaffolded by `pg-devkit eval init`.

## Contract ownership

pg-devkit is the **distribution and workflow** layer only. The authoritative
**`EvalCase` contract is owned by `pg-platform/ai-runtime`** — pg-devkit never
scores cases itself. The files here are a generic envelope you wire to that
harness.

## Getting started

1. Fill credentials/config your runtime needs (API keys, model, dataset id).
2. Replace `evals/run.sh` with a call into your ai-runtime harness. It must read
   `cases/*.json` and print `{"passed":N,"failed":M,"score":0..1}` on stdout.
3. Run the suite: `pg-devkit eval run`.
4. Promote a real trace into a golden case:
   `pg-devkit eval promote-trace <trace.json>` (then curate the `expected` field).

## Multi-repo

Each repo owns its own `evals/` suite. For fleet rollout, commit `evals/` per
repo and run `pg-devkit eval run` in each repo's CI after wiring `run.sh`. A
fleet batch op is intentionally out of scope for now.
