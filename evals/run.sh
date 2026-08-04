#!/usr/bin/env bash
# pg-devkit eval runner stub — NOT wired yet.
#
# Replace this with a call into your repo's ai-runtime harness. The harness
# owns the EvalCase scoring contract; this script just needs to:
#   1. read the golden cases (cases/*.json, per suite.json "cases"),
#   2. run them against the system under test,
#   3. print a JSON summary on stdout: {"passed":N,"failed":M,"score":0.0..1.0}
#
# `pg-devkit eval run` shells out here and renders that summary.
set -euo pipefail
echo "eval runner not wired yet — edit evals/run.sh to call your ai-runtime harness" >&2
exit 1
