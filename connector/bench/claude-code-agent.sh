#!/bin/bash
# An external bench agent for bench/run.mjs: Claude Code in headless mode, with only the starfare MCP tools.
#   node bench/run.mjs --suite src/suites/v1.json --split dev --label-agent claude-code --label-model claude-sonnet-5-5 \
#     --agent 'bench/claude-code-agent.sh {mcp_config} {prompt_file} claude-sonnet-5-5 runs/sonnet.transcript.jsonl' --out runs/sonnet.json
# Arguments: the MCP config and prompt paths run.mjs fills in, the model, and a file the stream-json transcript is appended to.
# Needs the claude CLI signed in. Writes {"tokens": n} to STARFARE_BENCH_META so the results row records the tokens used.
set -u
OUT=${4:-/dev/null}
TMP=$(mktemp)
claude -p "$(cat "$2")" --mcp-config "$1" --strict-mcp-config --tools "" --allowedTools "mcp__starfare" \
  --model "${3:-claude-sonnet-5-5}" --output-format stream-json --verbose --max-turns 60 > "$TMP"
cat "$TMP" >> "$OUT"
node -e '
const fs = require("fs"), rows = fs.readFileSync(process.argv[1], "utf8").trim().split("\n").map((x) => { try { return JSON.parse(x); } catch { return null; } });
const r = rows.filter(Boolean).reverse().find((x) => x.type === "result"), u = r && r.usage;
if (u && process.env.STARFARE_BENCH_META) fs.writeFileSync(process.env.STARFARE_BENCH_META, JSON.stringify({
  tokens: (u.input_tokens || 0) + (u.output_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0) }));
' "$TMP"
rm -f "$TMP"
