#!/bin/bash
RUSTC="$1"
shift

args=()
for arg in "$@"; do
    if [[ "$arg" != --remap-path-scope=* ]]; then
        args+=("$arg")
    fi
done

exec "$RUSTC" "${args[@]}"
