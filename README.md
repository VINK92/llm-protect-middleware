# LLM-Protect Middleware

> Middleware-система захисту AI API від атак типу **Model Denial of Service** (MDoS).
> Каскадна архітектура: 5 етапів фільтрації — від найдешевшої операції до найдорожчої.

[![CI](https://github.com/<owner>/llm-protect-middleware/actions/workflows/ci.yml/badge.svg)](./.github/workflows/ci.yml)

Детальна специфікація — у [PRD.md](./PRD.md).

---

## Архітектура каскаду

```
[Вхідний запит]
   │
   ▼
[Stage 1a: Content-Length]       middleware       cost: ~0 ms     → 413
   │
   ▼
[Stage 1b: Rate Limit (Redis)]   Guard            cost: ~1 ms     → 429
   │
   ▼
[Stage 2: SHA-256 Exact Cache]   Interceptor      cost: ~1-2 ms   → HIT (fast response)
   │
   ▼
[Stage 3: Shannon Entropy]       Guard            cost: ~1 ms     → 400
   │
   ▼
[Stage 4: Tokenizer (tiktoken)]  Guard            cost: ~5-20 ms  → 413
   │
   ▼
[Stage 5: ONNX Embedding +       Interceptor      cost: ~30-100 ms → HIT or AI inference
          Vector Search]
   │
   ▼
[Forward to AI Model]                             cost: 300 ms - десятки секунд
```

**Ключова інваріанта (FR-2.2):** Stage 5 (embedding) обчислюється **тільки** якщо запит пройшов усі попередні етапи. Це захищає і AI-модель, і сам семантичний кеш від «забруднення».

---

## Структура монорепо

```
llm-protect-middleware/
├── apps/
│   └── gateway/                  # NestJS bootstrap + controllers
├── libs/
│   ├── shared/                   # DTOs, RequestContext, config schema
│   ├── detection-engine/         # 5 stages of the cascade
│   ├── semantic-cache/           # Redis client + exact/vector repos
│   ├── ai-proxy/                 # Ollama + mock backends
│   ├── logging/                  # nestjs-pino
│   └── metrics/                  # Prometheus instrumentation
├── infra/                        # prometheus.yml etc.
├── .github/workflows/            # CI (lint + test + build + docker)
├── docker-compose.yml
├── Dockerfile
├── nest-cli.json                 # NestJS monorepo config
└── PRD.md
```

---

## Швидкий старт

### Передумови
- **Node.js ≥ 20** (`node --version`)
- **Docker + Docker Compose** (для Redis / Postgres / Ollama)
- **npm ≥ 10**

### 1. Встановити залежності

```bash
npm install
cp .env.example .env
```

### 2. Підняти інфраструктуру (Redis + Postgres)

```bash
docker compose up -d redis postgres
```

Опційно — Ollama (локальна LLM-модель) і Prometheus:

```bash
docker compose --profile ollama up -d ollama
docker compose --profile monitoring up -d prometheus
# Після підняття: docker exec -it llm-protect-ollama ollama pull llama3.2
```

### 3. Запустити gateway

```bash
# режим розробки з hot-reload
npm run start:dev

# продакшн
npm run build && npm start
```

Сервер слухає на `http://localhost:3000`.

- **Swagger UI:** http://localhost:3000/docs
- **Health:** http://localhost:3000/v1/health
- **Prometheus metrics:** http://localhost:3000/v1/metrics

### 4. Альтернативно — все одразу через Docker

```bash
docker compose up -d
```

---

## Приклади запитів

### Нормальний запит (пройде каскад → AI)

```bash
curl -X POST http://localhost:3000/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -d '{
    "model": "llama3.2",
    "messages": [
      { "role": "user", "content": "Hello, how are you?" }
    ]
  }'
```

### Повторний ідентичний запит (Stage 2 hit — миттєва відповідь)

Той самий `curl` ще раз → `X-Cache: HIT`, `X-Cache-Type: exact`.

### Атака: hyper-random garbage (заблокує Stage 3)

```bash
curl -X POST http://localhost:3000/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -d '{
    "model": "llama3.2",
    "messages": [{"role":"user","content":"qz#7@!9xkf$2~m^vRpL3oN8wYu&5tHbGcVjA"}]
  }'
# → 400 BAD_REQUEST { error: { code: "HIGH_ENTROPY_GARBAGE", stage: "ENTROPY", ... } }
```

### Атака: token flood (заблокує Stage 4)

```bash
PROMPT=$(python3 -c "print('word ' * 10000)")
curl -X POST http://localhost:3000/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -d "{\"model\":\"llama3.2\",\"messages\":[{\"role\":\"user\",\"content\":\"$PROMPT\"}]}"
# → 413 PAYLOAD_TOO_LARGE { error: { code: "TOKEN_LIMIT_EXCEEDED", stage: "TOKEN_LIMIT", ... } }
```

### Атака: rate-limit flood (заблокує Stage 1b)

```bash
for i in $(seq 1 200); do
  curl -s -o /dev/null -w "%{http_code}\n" \
    -X POST http://localhost:3000/v1/chat/completions \
    -H 'Content-Type: application/json' \
    -d '{"model":"llama3.2","messages":[{"role":"user","content":"ping"}]}'
done | sort | uniq -c
# → ~100 of "200" and ~100 of "429"
```

---

## Розробка

| Команда | Що робить |
|---|---|
| `npm run start:dev` | Запуск gateway з hot-reload |
| `npm run build` | Збірка |
| `npm test` | Запуск unit-тестів (Jest) |
| `npm test -- --coverage` | Тести з покриттям |
| `npm run lint` | ESLint + автофікс |
| `npm run format` | Prettier |

### Додати новий етап каскаду

1. Створити папку `libs/detection-engine/src/stage-X-<name>/`
2. Реалізувати клас із `CanActivate` (Guard) або `NestInterceptor`
3. Зареєструвати в `DetectionEngineModule.providers`
4. Додати до `@UseGuards()` / `@UseInterceptors()` у `ChatController` **у правильному порядку вартості**
5. Додати лічильник у `CascadeMetricsService`
6. Покрити unit-тестом

### Замінити mock-embedding на справжній ONNX

1. Завантажити модель `all-MiniLM-L6-v2.onnx` у `./models/`
2. Встановити `onnxruntime-node`: `npm i onnxruntime-node`
3. Реалізувати `OnnxEmbeddingProvider implements IEmbeddingProvider` в `libs/detection-engine/src/stage-5-embedding/`
4. У `DetectionEngineModule.providers` замінити:

   ```ts
   { provide: EMBEDDING_PROVIDER, useExisting: MockEmbeddingProvider }
   // →
   { provide: EMBEDDING_PROVIDER, useExisting: OnnxEmbeddingProvider }
   ```
5. У `.env` встановити `EMBEDDING_PROVIDER=onnx`

---

## Конфігурація

Усі параметри керуються через env-vars (валідуються Joi-схемою в `libs/shared/src/config/config.schema.ts`).

Кожен етап каскаду має `STAGE_<NAME>_ENABLED=true|false` для **A/B-тестування внеску** (PRD §FR-2.6 — для розділу «Оцінка ефективності» дипломної).

Повний список — у [`.env.example`](./.env.example).

---

## Метрики Prometheus

Експортуються на `/v1/metrics`:

| Метрика | Тип | Що показує |
|---|---|---|
| `llm_protect_stage_latency_ms{stage}` | Histogram | Latency кожного етапу |
| `llm_protect_passed_stage_total{stage}` | Counter | Скільки запитів пройшло етап |
| `llm_protect_blocked_total{stage}` | Counter | Скільки заблоковано на етапі |
| `llm_protect_cache_hits_total{type}` | Counter | Hit-и exact / semantic кешу |
| `llm_protect_embedding_computed_total` | Counter | Скільки разів запустилось ONNX (має корелювати з `passed_stage_total{stage="TOKEN_LIMIT"}`) |

Інваріанта PRD §13:
```
sum(llm_protect_embedding_computed_total)
  ==
sum(llm_protect_passed_stage_total{stage="TOKEN_LIMIT"}) - sum(exact_cache hits)
```

---

## Stack

- **NestJS 10** (Fastify adapter) — core framework
- **TypeScript 5** — strong typing across cascade
- **ioredis** + Redis Stack — cache, rate-limit, vector store
- **js-tiktoken** — Stage 4 BPE tokenization
- **ONNX Runtime** (опційно) — Stage 5 embeddings
- **Pino** (через `nestjs-pino`) — structured JSON logs
- **prom-client** — Prometheus метрики
- **Jest** — unit + e2e тести

---

## Подальші кроки

- [ ] Реалізувати справжній ONNX embedding provider
- [ ] Adaptive Rate Limiter з token-budget (PRD §FR-5)
- [ ] PostgreSQL логування заблокованих запитів (PRD §FR-6.3)
- [ ] Dashboard (React + Recharts) — `apps/dashboard`
- [ ] Attack Simulator (`tests/attack-simulator`) — k6/Artillery scripts
- [ ] HNSW vector search через RediSearch
- [ ] E2E тести каскадної інваріанти з реальним Redis

Деталі — у [PRD.md](./PRD.md) розділах 10 (Roadmap) та 13 (Acceptance Criteria).

---

## Ліцензія

MIT
