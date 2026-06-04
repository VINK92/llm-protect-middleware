#!/usr/bin/env bash
# End-to-end smoke test exercising all 5 cascade stages.
# Requires: gateway listening on $BASE, Redis healthy.

set -u
BASE=${BASE:-http://localhost:3000}

c_cyan='\033[1;36m'
c_green='\033[1;32m'
c_red='\033[1;31m'
c_off='\033[0m'

sep() { printf "\n${c_cyan}── %s ──${c_off}\n" "$1"; }

run() {
  local label="$1" expected_status="$2" data="$3"
  local resp status body
  resp=$(curl -sS -o /tmp/body.json -w "%{http_code}" -X POST "$BASE/v1/chat/completions" \
    -H 'Content-Type: application/json' -d "$data")
  status=$resp
  body=$(cat /tmp/body.json)
  if [[ "$status" == "$expected_status" ]]; then
    printf "${c_green}✔ %-3s${c_off} %s\n" "$status" "$label"
  else
    printf "${c_red}✘ %-3s${c_off} %s (expected %s)\n" "$status" "$label" "$expected_status"
  fi
  echo "    $(echo "$body" | head -c 220)"
}

probe_headers() {
  local label="$1" data="$2"
  printf "${c_cyan}» %s${c_off}\n" "$label"
  curl -sS -i -X POST "$BASE/v1/chat/completions" \
    -H 'Content-Type: application/json' -d "$data" | grep -iE '^(HTTP|x-cache|x-request-id|x-cache-type|x-cache-similarity)' | head
}

# --- 0. Reset Redis to get deterministic state ---
docker exec llm-protect-redis redis-cli FLUSHDB > /dev/null

sep "STAGE 2 SHA-256 — exact cache MISS then HIT"
NORMAL='{"model":"llama3.2","messages":[{"role":"user","content":"What is the capital of France?"}]}'
probe_headers "1st request (MISS, AI inference)"     "$NORMAL"
probe_headers "2nd identical request (HIT, fast response)" "$NORMAL"

sep "STAGE 3 ENTROPY — low entropy (repetitive flood)"
LOW='{"model":"llama3.2","messages":[{"role":"user","content":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}]}'
run "low-entropy 'aaaa…' flood blocked" 400 "$LOW"

sep "STAGE 3 ENTROPY — high entropy (random printable ASCII)"
# python random.choices over full printable ASCII (95 chars) → entropy ≈ 6.5 > 6.0
RAND_PROMPT=$(python3 -c "import random,string; print(''.join(random.choices(string.printable.strip(), k=300)))" \
  | tr -d '"\\' | tr -d "'")
HIGH="{\"model\":\"llama3.2\",\"messages\":[{\"role\":\"user\",\"content\":\"$RAND_PROMPT\"}]}"
run "high-entropy random ASCII blocked" 400 "$HIGH"

sep "STAGE 4 TOKEN LIMIT — 10k tokens"
PROMPT=$(python3 -c "print('lorem ipsum dolor sit amet ' * 2000, end='')")
TOK="{\"model\":\"llama3.2\",\"messages\":[{\"role\":\"user\",\"content\":\"$PROMPT\"}]}"
run "10000+ token prompt blocked" 413 "$TOK"

sep "STAGE 1b RATE LIMIT — parallel flood 150 reqs (limit 100/min)"
# Use FRESH client id + FLUSHDB so this stage starts with a clean counter,
# then fire in parallel so all reqs hit the same time-bucket.
docker exec llm-protect-redis redis-cli FLUSHDB > /dev/null
seq 1 150 | xargs -n1 -P30 -I{} curl -s -o /dev/null -w "%{http_code}\n" \
  -X POST "$BASE/v1/chat/completions" \
  -H 'Content-Type: application/json' \
  -H 'X-API-Key: flood-tester' \
  -d '{"model":"llama3.2","messages":[{"role":"user","content":"ping-{}"}]}' \
  | sort | uniq -c | awk '{printf "    %4s × HTTP %s\n", $1, $2}'

sep "STAGE 5 SEMANTIC CACHE — mock embeddings are hash-based (no semantic similarity)"
printf "NOTE: with MockEmbeddingProvider (hash-derived), near-duplicate prompts\n"
printf "      will NOT produce similar vectors. To see real semantic-cache hits,\n"
printf "      swap to OnnxEmbeddingProvider (\\\$EMBEDDING_PROVIDER=onnx).\n"

sep "Prometheus metrics — verifying cascade telemetry"
curl -s $BASE/v1/metrics \
  | grep -E '^llm_protect_(blocked|cache_hits|embedding_computed|passed_stage)_total' \
  | head -20

sep "DONE"
