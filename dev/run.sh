#!/bin/bash
# The api and the inspector together; Ctrl+C stops both
set -m
bash dev/api.sh </dev/null & a=$!
bash dev/inspector.sh </dev/null & i=$!
trap 'kill -- -$a -$i 2>/dev/null' EXIT INT TERM
wait -n
