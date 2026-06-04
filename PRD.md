# PRD: Middleware-система захисту AI API від атак типу Model Denial of Service

**Версія:** 1.2
**Статус:** Draft
**Дата:** 2026-06-04
**Автор:** —
**Тип документа:** Product Requirements Document
**Core Tech Stack:** NestJS (TypeScript) + Redis + PostgreSQL + Docker

---

## 1. Огляд проєкту (Overview)

### 1.1 Назва
**LLM-Protect Middleware** — middleware-система захисту AI API від атак типу Model Denial of Service (MDoS).

### 1.2 Контекст і проблема
Сучасні AI-сервіси (LLM-моделі) є дорогими у виклику: кожен inference споживає значні обчислювальні ресурси (GPU, RAM, токени). Це робить їх вразливими до атак типу **Model Denial of Service**, коли зловмисник цілеспрямовано надсилає:
- надвеликі prompts (вичерпання context window та CPU/GPU);
- багаторазові повторювані запити (вичерпання rate-limit бюджету);
- запити з високою обчислювальною складністю (nested структури, токен-флуд);
- комбіновані атаки, що обходять традиційні WAF/Rate-Limiter.

Класичні рішення (WAF, API Gateway, Cloud DDoS Protection) **не враховують специфіки AI-навантажень** — вони працюють на рівні мережевих пакетів і HTTP, але не на рівні семантики prompts та токенового бюджету моделі.

### 1.3 Мета продукту
Створити **middleware-шар** між клієнтом і AI API, що:
1. виявляє підозрілі patterns на основі семантичного та токенового аналізу;
2. блокує/обмежує запити до того, як вони досягнуть дорогої AI-моделі;
3. кешує семантично подібні відповіді для зменшення навантаження;
4. адаптивно змінює rate-ліміти залежно від навантаження;
5. **захищає сам семантичний кеш** від «забруднення» сміттєвими/випадковими prompts (cache poisoning) — це робиться шляхом каскадного відсіювання некоректних запитів до того, як вони потраплять у vector DB.

### 1.4 Ключові метрики успіху (KPI)
| Метрика | Цільове значення MVP |
|---|---|
| Detection Rate (MDoS атаки) | ≥ 90% |
| False Positive Rate | ≤ 5% |
| Middleware Latency overhead | ≤ 50 ms (p95) для cache miss |
| Cache Hit Rate (на повторюваних prompts) | ≥ 60% |
| Resource overhead (CPU, RAM) | ≤ 15% від baseline |

### 1.5 Основна технологія (Core Framework)
**NestJS** (Node.js, TypeScript) обрано як основну платформу для всього backend-стеку (Gateway, Detection Engine, Semantic Cache, Rate Limiter, Logging). Обґрунтування вибору:

- **Модульна архітектура** — кожен етап каскадної детекції природно реалізується як окремий NestJS-модуль (`@Module`).
- **Pipeline-механізми з коробки** — `Guards`, `Interceptors`, `Pipes`, `Middleware`, `ExceptionFilters` ідеально лягають на каскадну фільтрацію запитів.
- **Dependency Injection** — спрощує тестування та підміну компонентів (mock Redis, mock AI backend).
- **Підтримка Fastify** як HTTP-адаптера (швидший за Express, нижчий latency overhead — критично для NFR-1).
- **Вбудована підтримка OpenAPI/Swagger** через `@nestjs/swagger` — відповідає вимозі NFR-8.
- **Готові інтеграції**: `@nestjs/terminus` (health-checks), `@nestjs/throttler` (rate-limit базис), `@nestjs/bull` (черги), `@nestjs/config`, `@nestjs/typeorm` / `@nestjs/prisma`.
- **TypeScript-first** — strong typing для DTO, request/response schemas, конфігурації.
- **Monorepo з коробки** через NestJS CLI workspaces (`nest generate app/lib`).

---

## 2. Цільова аудиторія

| Користувач | Опис | Сценарій використання |
|---|---|---|
| **DevOps / Platform Engineer** | Розгортає та конфігурує middleware перед AI-сервісом | Інтеграція як reverse proxy перед OpenAI/Ollama |
| **Розробник AI-додатків** | Захищає свій SaaS-продукт на базі LLM | Захист від abuse через публічний API |
| **Security Engineer** | Моніторить атаки та інциденти | Аналіз dashboard, threat hunting |
| **Дослідник / Студент** | Демонструє ефективність методів захисту | Тестування на attack simulator |

---

## 3. Scope MVP

### 3.1 In Scope (входить у MVP)
- API Gateway з proxy до AI API (Ollama / mock).
- Каскадний Detection Engine (5 етапів фільтрації).
- Semantic Cache (Redis + vector similarity).
- Adaptive Rate Limiter (token-budget based).
- Logging System (структуровані логи + PostgreSQL).
- Monitoring Dashboard (React, базові графіки).
- Attack Simulator для тестування.
- Документація API (OpenAPI/Swagger).

### 3.2 Out of Scope (НЕ входить у MVP)
- Multi-tenant SaaS-режим.
- Власна UI-консоль для адміністрування правил.
- Інтеграція з SIEM (Splunk/ELK).
- Підтримка стрімінгових (SSE/WebSocket) AI-відповідей.
- ML-based anomaly detection (тільки евристики + ентропія).
- HA-кластер з реплікацією Redis.
- Біллінг / монетизація.

---

## 4. Функціональні вимоги (Functional Requirements)

### FR-1. API Gateway (NestJS)
- **FR-1.1** Система МАЄ бути реалізована на **NestJS** з Fastify HTTP-адаптером і приймати HTTP/HTTPS запити (POST `/v1/chat/completions`, сумісність з OpenAI API).
- **FR-1.2** Система МАЄ виконувати proxy до upstream AI API (Ollama / mock) через виділений `AiProxyService`.
- **FR-1.3** Система МАЄ підтримувати **NestJS request pipeline** з можливістю переривання запиту на будь-якому етапі через `Guards` / `Interceptors` / `ExceptionFilters`.
- **FR-1.4** Система МАЄ повертати стандартизовані помилки (`429`, `400`, `413`, `403`) через глобальний `HttpExceptionFilter` з поясненням причини блокування.
- **FR-1.5** Валідація вхідних DTO МАЄ виконуватися через `ValidationPipe` + `class-validator`.

### FR-2. Detection Engine (каскадна архітектура)
Архітектурний принцип (за вимогою наукового керівника): **«каскадна фільтрація — від найдешевшої операції до найдорожчої. Embedding має рахуватися ЛИШЕ тоді, коли запит пройшов усі „дешеві“ етапи»**.

Реалізація — каскад **NestJS Guards / Interceptors**, де кожен етап є окремим injectable-класом. Цей каскад одночасно захищає **і AI-модель** (від дорогого inference), **і сам семантичний кеш** (від «забруднення» сміттєвими ембеддінгами).

#### 2.1 Каскад етапів

| Етап | Перевірка | NestJS-механізм | Дія при спрацюванні |
|---|---|---|---|
| **1a** | Content-Length check (≤ N байт) | `Middleware` (`ContentLengthMiddleware`) | `413 Payload Too Large` |
| **1b** | Базовий Rate Limit (per-IP, per-API-key) — Redis lookup | `Guard` (`RateLimitGuard`) | `429 Too Many Requests` |
| **2** | SHA-256 exact-match hash → пошук у Redis (O(1)) | `Interceptor` (`ExactCacheInterceptor`) | повернути закешовану відповідь (швидка відповідь) |
| **3** | Shannon Entropy analysis (виявлення випадкового сміття, гіпер-рандому) | `Guard` (`EntropyGuard`) | `400 Bad Request` / drop |
| **4** | Локальний токенізатор (tiktoken) — перевірка ліміту токенів | `Guard` (`TokenLimitGuard`) | `413 Payload Too Large` |
| **5** | Легковаговий ONNX embedding → vector similarity search у Redis Stack | `Interceptor` (`SemanticCacheInterceptor`) | cache hit → return, miss → AI inference |

Етап 1 розділений на два під-етапи (`1a` → `1b`) для збереження принципу «від найдешевшої операції до найдорожчої»: перевірка `Content-Length` — це O(1) без жодних мережевих викликів, тоді як перевірка rate-limit вимагає Redis lookup.

#### 2.2 Профіль вартості операцій (обґрунтування порядку)

| Етап | Тип операції | Очікувана вартість (latency) | Вимагає I/O |
|---|---|---|---|
| 1a | int comparison | < 0.01 ms | ні |
| 1b | Redis `INCR` + TTL | ~0.5–1 ms | так (Redis) |
| 2 | SHA-256 + Redis `GET` | ~1–2 ms | так (Redis) |
| 3 | Shannon entropy (статистика по байтах) | ~0.5–2 ms | ні |
| 4 | tiktoken BPE-токенізація | ~5–20 ms | ні |
| 5 | ONNX embedding (384-dim) + vector search | ~30–100 ms | так (Redis + CPU) |
| **AI** | LLM inference | **300 ms – десятки секунд** | так (GPU/external) |

Цей порядок мінімізує середню вартість обробки запиту: атакувальний трафік відсіюється на ранніх «дешевих» етапах, а embedding (найдорожча локальна операція) обчислюється тільки для запитів, що пройшли всі дешевші перевірки.

#### 2.3 Вимоги до реалізації

- **FR-2.1** Кожен етап МАЄ бути окремим NestJS-модулем (`DetectionStageModule`) з власними тестами.
- **FR-2.2** Embedding МАЄ обчислюватися ТІЛЬКИ якщо запит пройшов етапи 1a–4 (вимога наукового керівника).
- **FR-2.3** Кожен етап МАЄ повертати `risk_score` (0–100), що агрегується у фінальний score через `RiskScoreService` (DI singleton).
- **FR-2.4** Порядок етапів МАЄ декларуватися через `@UseGuards()` / `@UseInterceptors()` декоратори на контролері, де NestJS виконує їх послідовно за визначеним порядком.
- **FR-2.5** Каскад МАЄ захищати семантичний кеш від поповнення «сміттєвими» embeddings (cache poisoning): запит, заблокований на етапі 3 або 4, НЕ ПОВИНЕН досягати етапу 5.
- **FR-2.6** Будь-який етап (крім 1a) МАЄ бути опційно вимикним через конфігурацію — для A/B-тестування та оцінки внеску кожного етапу окремо (для розділу «Оцінка ефективності»).

### FR-3. Cost Estimation
- **FR-3.1** Система МАЄ обчислювати `risk_score` за формулою:
  ```
  risk_score = w1 * token_count + w2 * request_frequency + w3 * repetition_score + w4 * entropy_score
  ```
- **FR-3.2** Ваги (`w1..w4`) МАЮТЬ бути конфігурованими через config-файл.

### FR-4. Semantic Cache
- **FR-4.1** Система МАЄ зберігати пари `(prompt_embedding → response)` у Redis з TTL.
- **FR-4.2** При cache lookup МАЄ виконуватися cosine similarity search (поріг ≥ 0.95 за замовчуванням).
- **FR-4.3** Cache hit МАЄ повертати відповідь з headers: `X-Cache: HIT`, `X-Cache-Similarity: 0.97`.

### FR-5. Adaptive Rate Limiter
- **FR-5.1** Система МАЄ підтримувати **token-budget** замість простого request-count:
  ```
  simple request  = 10 points
  medium request  = 50 points
  complex request = 200 points
  ```
- **FR-5.2** Система МАЄ адаптивно зменшувати бюджет при високому навантаженні (CPU > 80%, queue size > N).
- **FR-5.3** Ліміти МАЮТЬ застосовуватися per-IP, per-API-key, global.

### FR-6. Logging System
- **FR-6.1** Логи МАЮТЬ записуватися у структурованому JSON-форматі через `nestjs-pino`.
- **FR-6.2** Кожен запит МАЄ мати `request_id` (correlation ID), що додається `LoggerMiddleware` на вхід.
- **FR-6.3** У PostgreSQL (через `@nestjs/typeorm` або `Prisma`) МАЮТЬ зберігатися: `request_id`, `timestamp`, `client_ip`, `risk_score`, `decision`, `latency_ms`, `cache_hit`, `tokens_in`, `tokens_out`.

### FR-7. Monitoring Dashboard
- **FR-7.1** Dashboard МАЄ відображати real-time метрики:
  - кількість запитів (RPS);
  - заблоковані запити (по типах атак);
  - cache hit rate;
  - distribution risk_score;
  - latency p50/p95/p99.
- **FR-7.2** Графіки МАЮТЬ оновлюватися кожні 5 секунд.

### FR-8. Attack Simulator
- **FR-8.1** Симулятор МАЄ підтримувати сценарії:
  - spam requests (flood);
  - huge prompts (>100k токенів);
  - repeated prompts (cache abuse);
  - high-entropy garbage;
  - combined attacks.
- **FR-8.2** Симулятор МАЄ генерувати звіт: скільки запитів пройшло / було заблоковано / на якому етапі.

---

## 5. Нефункціональні вимоги (Non-Functional Requirements)

| ID | Категорія | Вимога |
|---|---|---|
| NFR-1 | **Performance** | Latency overhead ≤ 50 ms (p95) для cache miss; ≤ 10 ms для cache hit |
| NFR-2 | **Scalability** | Підтримка ≥ 500 RPS на одному вузлі |
| NFR-3 | **Reliability** | Uptime ≥ 99% (для MVP — single-node) |
| NFR-4 | **Security** | TLS termination, валідація input, відсутність SSRF до AI API |
| NFR-5 | **Observability** | Структуровані логи, Prometheus metrics endpoint `/metrics` |
| NFR-6 | **Portability** | Запуск через `docker-compose up` на будь-якому хості з Docker |
| NFR-7 | **Configurability** | Усі пороги/ліміти налаштовуються через `config.yaml` або env-vars |
| NFR-8 | **Maintainability** | Code coverage ≥ 70%; lint pass; OpenAPI spec для всіх endpoints |

---

## 6. Перелік типів атак (Threat Model)

| # | Тип атаки | Опис | Етап detection |
|---|---|---|---|
| T1 | **Token Flood** | Надвеликий prompt з метою вичерпати context window | Етап 4 (tiktoken) |
| T2 | **Request Flood** | Багато запитів за короткий час з одного IP | Етап 1b (rate limit) |
| T3 | **Repeated Prompts** | Однакові prompts для виснаження GPU | Етап 2 (SHA-256) / 5 (embedding) |
| T4 | **Semantic Variants** | Схожі за змістом prompts з різним формулюванням | Етап 5 (semantic cache) |
| T5 | **Entropy Flood** | Випадкові символи / гіпер-рандом для обходу cache (cache poisoning) | Етап 3 (Shannon entropy) |
| T6 | **Oversized Payload** | Надвеликий HTTP body | Етап 1a (Content-Length) |
| T7 | **Nested Complexity** | Глибокі вкладені структури в JSON / markdown | Етап 4 (tiktoken + структурний аналіз) |
| T8 | **Distributed Attack** | Розподілений flood з багатьох IP | Етап 1b + global rate limit |
| T9 | **Combined Attack** | Комбінація вищезазначених | Каскад усіх етапів |

---

## 7. Архітектура системи

### 7.1 High-Level Architecture

Backend побудовано як єдиний **NestJS-моноліт** з чіткою модульною декомпозицією (кожен підсистемний компонент = окремий `@Module`). Frontend (Dashboard) — окремий React-додаток, що споживає REST API NestJS-сервісу.

```
┌────────────┐    ┌────────────────────────────────────────────────────┐    ┌──────────┐
│   Client   │───▶│           LLM-Protect Middleware (NestJS)           │───▶│  AI API  │
│            │◀───│                                                     │◀───│ (Ollama) │
└────────────┘    │  ┌──────────────────────────────────────────────┐  │    └──────────┘
                  │  │  GatewayModule (Controller + Fastify)        │  │
                  │  │   @UseGuards(RateLimit, Entropy, TokenLimit) │  │
                  │  │   @UseInterceptors(ExactCache, SemanticCache)│  │
                  │  └────────────────────┬─────────────────────────┘  │
                  │                       ▼                              │
                  │  ┌──────────────────────────────────────────────┐  │
                  │  │  DetectionEngineModule (5 sub-modules)       │  │
                  │  │   ├─ RateLimitModule                         │  │
                  │  │   ├─ ExactCacheModule (SHA-256)              │  │
                  │  │   ├─ EntropyModule (Shannon)                 │  │
                  │  │   ├─ TokenizerModule (tiktoken)              │  │
                  │  │   └─ EmbeddingModule (ONNX)                  │  │
                  │  └────────────────────┬─────────────────────────┘  │
                  │                       ▼                              │
                  │  ┌────────────────┐    ┌────────────────────────┐  │
                  │  │ CacheModule    │    │ RateLimiterModule      │  │
                  │  │ (Redis client) │    │ (Redis + token budget) │  │
                  │  └────────────────┘    └────────────────────────┘  │
                  │                       ▼                              │
                  │  ┌──────────────────────────────────────────────┐  │
                  │  │ LoggingModule (nestjs-pino → PostgreSQL)     │  │
                  │  │ MetricsModule (@willsoto/nestjs-prometheus)  │  │
                  │  └──────────────────────────────────────────────┘  │
                  └────────────────────────────────────────────────────┘
                                          │
                                          ▼
                  ┌────────────────────────────────────────────────────┐
                  │     Monitoring Dashboard (React + Recharts)         │
                  └────────────────────────────────────────────────────┘
```

### 7.2 Каскадна архітектура захисту семантичного кешу (Detection Flow)

Діаграма реалізує план наукового керівника: каскадна фільтрація від найдешевшої операції до найдорожчої, де ембеддінг (Етап 5) обчислюється тільки після проходження всіх дешевших етапів. Каскад захищає **і AI-модель**, **і сам семантичний кеш** від поповнення сміттєвими даними.

```
[Вхідний запит]
       │
       ▼
[Етап 1a: Content-Length check]       ──(>limit)──────▶ [BLOCK 413]
       │ pass                                            cost: ~0 ms
       ▼
[Етап 1b: Rate Limit (per-IP/key)]    ──(Перевищено)──▶ [BLOCK 429]
       │ pass                                            cost: ~1 ms (Redis)
       ▼
[Етап 2: SHA-256 exact hash (O(1))]   ──(Hit)─────────▶ [FAST RESPONSE from cache]
       │ miss                                            cost: ~1 ms (Redis)
       ▼
[Етап 3: Shannon Entropy analysis]    ──(Garbage)─────▶ [BLOCK 400 / DROP]
       │ pass                                            cost: ~1 ms (CPU)
       ▼
[Етап 4: Tokenizer (tiktoken)]        ──(Too many)────▶ [BLOCK 413 / DROP]
       │ pass                                            cost: ~10 ms (CPU)
       ▼
[Етап 5: ONNX Embedding (~30-100 ms)] ───▶ [Vector DB search] ──(Similar hit)─▶ [RETURN cached]
       │ miss
       ▼
[Forward to AI Model] ────────────────────────────────▶ cost: 300 ms - десятки секунд
       │
       ▼
[Store {hash, embedding, response} in cache]
       │
       ▼
[Return to Client]
```

**Ключова інваріанта:** запит, заблокований на Етапах 1a–4, ніколи не доходить до Етапу 5, отже:
1. не споживає CPU на обчислення ONNX-ембеддінгу;
2. не «забруднює» vector DB сміттєвими векторами (cache poisoning prevention).

### 7.3 Монорепозиторій (структура проєкту)

Використовується **NestJS monorepo workspace** (`nest-cli.json` → `monorepo: true`) для backend, плюс окрема директорія для React-dashboard.

```
llm-protect-middleware/
├── apps/
│   ├── gateway/                          # NestJS bootstrap (main.ts)
│   │   └── src/
│   │       ├── main.ts                   # Fastify adapter, Swagger setup
│   │       └── app.module.ts             # root module
│   └── dashboard/                        # React monitoring dashboard
│       └── src/
├── libs/                                 # NestJS shared libraries
│   ├── detection-engine/                 # cascade detection
│   │   └── src/
│   │       ├── rate-limit/
│   │       ├── exact-cache/
│   │       ├── entropy/
│   │       ├── tokenizer/
│   │       ├── embedding/
│   │       └── detection-engine.module.ts
│   ├── semantic-cache/                   # Redis vector cache module
│   ├── ai-proxy/                         # Ollama / OpenAI client
│   ├── logging/                          # nestjs-pino + Postgres
│   ├── metrics/                          # Prometheus
│   └── shared/                           # DTOs, types, config
├── tests/
│   ├── attack-simulator/                 # k6 / artillery / custom scripts
│   └── datasets/                         # normal / attack prompts
├── docs/
│   ├── architecture.md
│   ├── threat-model.md
│   └── api.openapi.yaml
├── nest-cli.json                         # NestJS monorepo config
├── tsconfig.json
├── package.json
├── docker-compose.yml
├── .github/workflows/                    # CI/CD pipelines
└── README.md
```

Для backend-частини використовуються NestJS-команди:
```
nest generate app gateway
nest generate library detection-engine
nest generate library semantic-cache
nest generate library ai-proxy
```

---

## 8. API Specification (попередній огляд)

### 8.1 Основні endpoints
| Метод | Шлях | Опис |
|---|---|---|
| `POST` | `/v1/chat/completions` | Proxy до AI з захистом (OpenAI-compatible) |
| `GET`  | `/v1/health` | Health check |
| `GET`  | `/v1/metrics` | Prometheus metrics |
| `GET`  | `/v1/stats` | Агреговані статистики для dashboard |
| `GET`  | `/v1/logs` | Постраничний доступ до логів (admin) |

### 8.2 Формат відповіді при блокуванні
```json
{
  "error": {
    "code": "MDOS_DETECTED",
    "stage": "TOKEN_LIMIT",
    "message": "Request exceeds token budget",
    "risk_score": 87,
    "request_id": "req_01HXYZ..."
  }
}
```

Повна специфікація — у `docs/api.openapi.yaml`.

---

## 9. Технологічний стек

### 9.1 Backend Core — NestJS Ecosystem

| Шар | Технологія | Обґрунтування |
|---|---|---|
| **Framework (core)** | **NestJS 10+** (Node.js 20+, TypeScript 5+) | **основна технологія проєкту**; модульність, DI, pipeline з коробки |
| HTTP-адаптер | **`@nestjs/platform-fastify`** | швидший за Express, нижчий latency (важливо для NFR-1) |
| Конфігурація | **`@nestjs/config`** | env-vars + `config.yaml`, валідація через Joi |
| Валідація DTO | **`class-validator`** + **`class-transformer`** | разом з `ValidationPipe` |
| OpenAPI | **`@nestjs/swagger`** | автоматична генерація `/docs` та `api.openapi.yaml` |
| Health-checks | **`@nestjs/terminus`** | endpoint `/v1/health` (Redis, Postgres, AI backend) |
| Rate Limit (базис) | **`@nestjs/throttler`** | базовий per-IP RL для Етапу 1 |
| Cache | **`@nestjs/cache-manager`** + **`ioredis`** | абстракція над Redis |
| ORM | **`@nestjs/typeorm`** або **Prisma** | для PostgreSQL логів |
| Metrics | **`@willsoto/nestjs-prometheus`** | endpoint `/v1/metrics` |
| Logger | **`nestjs-pino`** | високопродуктивний JSON-logger |
| Scheduled tasks | **`@nestjs/schedule`** | періодичні задачі (cache eviction, metric flush) |

### 9.2 AI / ML Layer

| Шар | Технологія | Обґрунтування |
|---|---|---|
| Tokenizer | **tiktoken** (BPE) | сумісний з OpenAI моделями |
| Embedding runtime | **ONNX Runtime for Node.js** (`onnxruntime-node`) | легкий, локальний, без GPU |
| Embedding model | `all-MiniLM-L6-v2` (384-dim) | швидкий, стандартний baseline |
| AI backend | **Ollama** (локально) або mock controller | для тестів без оплати OpenAI |

### 9.3 Infrastructure

| Шар | Технологія | Обґрунтування |
|---|---|---|
| Cache / Vector DB | **Redis 7** + **Redis Stack** (RediSearch) | швидкий KV + native vector similarity |
| Database | **PostgreSQL 16** | надійні структуровані логи |
| Контейнери | **Docker** + **docker-compose** | відтворюваність dev/prod |
| CI/CD | **GitHub Actions** | безкоштовно, інтеграція з GitHub |
| Моніторинг | **Prometheus** + **Grafana** (опційно) | стандарт для метрик |

### 9.4 Frontend & Testing

| Шар | Технологія | Обґрунтування |
|---|---|---|
| Dashboard | **React 18** + **Vite** + **Recharts** | швидка розробка SPA |
| Unit tests | **Jest** (вбудовано у NestJS) | стандарт для NestJS |
| E2E tests | **Supertest** + `@nestjs/testing` | E2E для NestJS-контролерів |
| Load tests | **k6** / **Artillery** | для performance/security testing |

---

## 10. Етапи реалізації (Roadmap)

| # | Етап | Тривалість | Результат (Deliverable) |
|---|---|---|---|
| 1 | Підготовчий етап: вимоги, аналіз ринку | 1 тиж | scope, comparative analysis |
| 2 | Інфраструктура: repo, CI/CD, Docker | 1 тиж | working dev environment |
| 3 | Архітектура + OpenAPI | 1 тиж | diagrams, swagger spec |
| 4 | API Gateway + AI proxy | 1 тиж | working proxy |
| 5 | Detection Engine (5 етапів каскаду) | 2 тиж | detection module + unit-тести |
| 6 | Semantic Cache | 1 тиж | working cache with hit/miss |
| 7 | Adaptive Rate Limiter | 1 тиж | token-budget RL |
| 8 | Logging + Dashboard | 1.5 тиж | React UI з real-time графіками |
| 9 | Attack Simulator + datasets | 1 тиж | k6/artillery scripts |
| 10 | Тестування (functional / perf / security) | 1.5 тиж | звіт з метриками |
| 11 | Оцінка ефективності | 0.5 тиж | comparative evaluation |
| 12 | Документація | 1 тиж | повний docs/ |
| 13 | MVP Demo + презентація | 1 тиж | demo + slides |

**Загалом: ~14 тижнів** (можна стиснути до 10 при паралельній роботі над модулями).

---

## 11. Метрики оцінки ефективності

| Метрика | Метод вимірювання | Цільове значення |
|---|---|---|
| **Detection Rate** | (заблоковані атаки / усі атаки) × 100% | ≥ 90% |
| **False Positive Rate** | (помилково заблоковані / усі легітимні) × 100% | ≤ 5% |
| **Latency Impact** | різниця p95 latency з/без middleware | ≤ 50 ms |
| **Resource Utilization Overhead** | CPU/RAM overhead vs baseline | ≤ 15% |
| **Cache Hit Rate** | (cache hits / total requests) × 100% | ≥ 60% |
| **Throughput** | RPS до деградації p95 latency | ≥ 500 RPS |

Усі метрики ВИМІРЮЮТЬСЯ через attack simulator + Prometheus.

---

## 12. Ризики та припущення

### 12.1 Ризики
| Ризик | Ймовірність | Вплив | Mitigation |
|---|---|---|---|
| ONNX embedding надто повільний | M | H | fallback на hash-only cache, профілювання |
| Redis як SPOF | M | M | persistence (AOF) + документування HA для post-MVP |
| Високий FP-rate через ентропію | H | M | калібрування порогу, A/B на датасеті |
| Складність калібрування ваг `risk_score` | H | M | конфігурація через `config.yaml`, тюнінг на тестових датасетах |
| Відсутність реальних AI моделей у CI | M | L | mock inference endpoint |

### 12.2 Припущення
- Трафік AI API — переважно POST з JSON-body.
- Клієнти використовують OpenAI-сумісний формат.
- Розгортання — single-node для MVP.
- Дослідження проводиться на synthetic + open датасетах.

---

## 13. Acceptance Criteria (критерії приймання MVP)

MVP вважається готовим, якщо:

- [ ] Усі 5 етапів каскадного Detection Engine реалізовані та покриті unit-тестами (з розбиттям Етапу 1 на 1a + 1b).
- [ ] **Каскадний порядок дотримано**: запит, заблокований на Етапах 1a–4, ніколи не доходить до Етапу 5 (перевіряється інтеграційним тестом, що логує `stage_reached`).
- [ ] **ONNX Embedding обчислюється тільки після проходження Етапів 1a–4** (метрика `embedding_computed_total` має корелювати з `passed_stage_4_total`).
- [ ] Кожен етап каскаду можна вимкнути через конфігурацію для A/B-оцінки внеску (FR-2.6).
- [ ] Gateway успішно проксує запити до Ollama / mock.
- [ ] Semantic Cache повертає cache hit при similarity ≥ 0.95.
- [ ] Adaptive Rate Limiter блокує >90% spam-сценаріїв з симулятора.
- [ ] Dashboard відображає real-time метрики (RPS, blocked, hit-rate, latency).
- [ ] `docker-compose up` піднімає весь стек однією командою.
- [ ] CI pipeline (lint → test → build → docker) проходить green на main.
- [ ] Звіт з тестування показує відповідність KPI з розділу 1.4.
- [ ] Документація: README, architecture, threat model, OpenAPI — заповнена.
- [ ] Demo-сценарій відтворюваний: normal → attack → blocked → cache → adaptive.

---

## 14. Питання, що залишаються відкритими (Open Questions)

1. Чи підтримувати streaming-відповіді (SSE) у пост-MVP версії?
2. Який поріг cosine similarity дає найкращий FP/TP trade-off на конкретному датасеті?
3. Чи використовувати Redis Stack (з vector search) чи окремий vector DB (Qdrant/Milvus)?
4. Чи потрібна підтримка multi-AI-backend (OpenAI + Ollama одночасно з роутингом)?
5. Як обробляти зашифровані payloads (post-quantum scenarios)?

---

## 15. Глосарій

| Термін | Визначення |
|---|---|
| **MDoS** | Model Denial of Service — атака на вичерпання ресурсів AI-моделі |
| **LLM** | Large Language Model |
| **Embedding** | Векторне представлення тексту для семантичного пошуку |
| **Cosine Similarity** | Міра подібності двох векторів (від -1 до 1) |
| **Shannon Entropy** | Метрика випадковості/інформаційного вмісту рядка |
| **tiktoken** | Бібліотека токенізації BPE від OpenAI |
| **ONNX** | Open Neural Network Exchange — формат портативних моделей |
| **Token Budget** | Бюджет «вартості» запитів замість простого request-count |
| **Cascade Filtering** | Послідовність фільтрів від найдешевшого до найдорожчого |
| **NestJS** | Progressive Node.js фреймворк для побудови масштабованих server-side додатків на TypeScript |
| **NestJS Guard** | Клас, що визначає чи запит проходить далі по pipeline (повертає bool) |
| **NestJS Interceptor** | Клас, що може модифікувати/перехоплювати request/response (RxJS-based) |
| **NestJS Module** | Логічна одиниця коду в NestJS з власними providers, controllers, imports |

---

## 16. Посилання

- **NestJS official docs** — https://docs.nestjs.com/
- **NestJS Fastify adapter** — https://docs.nestjs.com/techniques/performance
- **NestJS Monorepo mode** — https://docs.nestjs.com/cli/monorepo
- **NestJS Guards / Interceptors** — https://docs.nestjs.com/guards
- OWASP Top 10 for LLM Applications — https://owasp.org/www-project-top-10-for-large-language-model-applications/
- OpenAI API reference — https://platform.openai.com/docs/api-reference
- Ollama — https://ollama.com/
- ONNX Runtime — https://onnxruntime.ai/
- tiktoken — https://github.com/openai/tiktoken
- Redis Stack (vector search) — https://redis.io/docs/stack/

---

**Кінець документа.**
