# PROMPT-FE.md — Backend Build Prompt for the trackIt-web Frontend

## 0. Purpose and how to use this document

You are building the **NestJS + PostgreSQL backend** for **trackIt-web**, the frontend of the
K.B.Y GLOBAL INVESTMENT fuel-station management platform. The frontend is **already complete**
(Next.js 16, TypeScript, TanStack Query) and runs today against an in-browser mock API
(MSW) located in `src/mocks/handlers.ts`. That mock **is** the executable reference
implementation of everything in this document.

Your job: replace the mock with a real server **without changing a single line of frontend
code**. Every path, shape, status code, enum value, role rule and side effect below was
extracted from the frontend's actual API modules (`src/api/*.api.ts`), its types
(`src/types/domain.ts`), its HTTP client (`src/api/client.ts`), its error normaliser
(`src/api/errors.ts`) and the mock handlers. If you implement exactly this, integration is a
one-line change (`NEXT_PUBLIC_USE_MOCK_API=false`, `NEXT_PUBLIC_API_BASE_URL=http://localhost:4000`).

Rules of precedence when reading:

1. This document (it reflects what the frontend *actually does*).
2. `docs/04-api-specification.md` (the MVP API contract the frontend was built to).
3. `docs/03 — Database Design.md` (authoritative for PostgreSQL enums and columns).
4. Where the docs contradict each other, `docs/ASSUMPTIONS.md` records the decisions the
   frontend made — they are baked in here and are **not negotiable** during integration.

---

## 1. System context

### 1.1 What the platform does

Multi-branch fuel station management for one company (K.B.Y GLOBAL INVESTMENT):

- **Managers** run a branch: record sales, receive deliveries, adjust stock, submit daily reports.
- **Administrators (ADMIN)** run a business: create branches and managers, configure fuel types,
  prices, suppliers, tankers, order fuel, review daily reports, void sales, audit everything.
- **Super Administrators (SUPER_ADMIN)** operate the platform: onboard businesses, confirm
  fuel orders, see everything.

Frontend pages (all consuming the API in §4): login / forgot / reset password, dashboard
(role-aware), businesses, branches, users, profile (avatar + password), fuel types, fuel
prices, suppliers, tankers, fuel orders, deliveries, inventory, sales, daily reports,
notifications, reports, audit logs.

### 1.2 Roles and scoping invariants (enforced by the backend, not the UI)

Exactly three roles (`user_role`):

| Role | businessId | branchId | Reads | Typical writes |
|---|---|---|---|---|
| `SUPER_ADMIN` | `null` | `null` | Everything | Businesses, platform-wide config, fuel-order confirm/cancel, reviews |
| `ADMIN` | set | `null` | Own business only | Branches, users (managers), fuel types, prices, suppliers, tankers, orders, adjustments, reviews |
| `MANAGER` | set | set | Own branch only | Sales, delivery receiving/disputes, daily reports (own branch) |

Hard rules:

- **Never trust `businessId` from the client** — derive it from the authenticated caller
  (doc 04 §92). The frontend never sends it.
- **Manager branch clamping**: if a MANAGER passes a `branchId` filter, the backend must
  clamp/override it to the manager's own branch, never serve another branch's rows.
- An ADMIN manages only `MANAGER` users in their own business (doc 07 §57). The SUPER_ADMIN
  account is untouchable by everyone (including itself for status changes).
- Tenant isolation may answer **404 instead of 403** for foreign resources (doc 06 §41);
  the frontend treats both identically.

### 1.3 Non-negotiable business rules (the reason the API shapes look like they do)

1. **The client never prices anything.** `POST /sales` takes only `branchId`, `fuelTypeId`,
   `litresSold`, `soldAt`. The backend resolves the price applicable at `soldAt`, snapshots it
   onto the sale and computes `totalAmount`. There is no unitPrice/totalAmount input to abuse.
2. **Only `actualQuantityLitres` moves inventory** on delivery receiving — never the expected
   quantity. `differenceLitres = actual − expected` (negative = shortage) is recorded per item.
3. **An order is a commitment, not stock.** Nothing in the fuel-order flow touches inventory.
   Inventory only moves via delivery receiving, sales, adjustments and corrections.
4. **History is immutable.** A wrong inventory entry is fixed with a `CORRECTION` transaction;
   a voided sale generates a `CORRECTION` returning the litres — rows are never edited or deleted.
5. **Daily reports are computed by the backend.** The client sends only `branchId`,
   `reportDate`, `managerNotes`. Opening stock, received, sold, closing and revenue are derived
   from the ledger. Reports create **no** inventory transactions.
6. **Price intervals never overlap** per business+fuel type: `[effectiveFrom, effectiveTo)`,
   start inclusive, end exclusive. Creating a price closes the previous open interval.
7. **Audit is append-only.** No endpoint may update or delete audit rows.

---

## 2. Transport and conventions

### 2.1 Base URL and prefix

- The frontend is configured with an **origin only**: `NEXT_PUBLIC_API_BASE_URL=http://localhost:4000`.
- The frontend prepends the mandatory prefix **`/api/v1`** to every path itself. Serve the whole
  API under a global prefix `/api/v1` (NestJS `app.setGlobalPrefix('api/v1')`).
- CORS: allow the frontend origin (default `http://localhost:3000`) **with `credentials: true`** —
  the refresh cookie is cross-origin in development.

### 2.2 Response envelope (doc 04 §6)

Every success response is JSON:

```jsonc
// single resource
{ "data": { ... } }
// collections (paginated)
{ "data": [ ... ], "meta": { "page": 1, "limit": 20, "total": 57, "totalPages": 3 } }
```

- `meta` is present **iff** the endpoint is paginated. `page` starts at 1.
- `204 No Content` responses (logout, logout-all, user delete) have an **empty body**.
- **One documented exception:** `GET /api/v1/inventory` returns a **bare array**
  (`[ {...}, ... ]`, doc 04 §54) — not an envelope. The client tolerates an envelope there too,
  but implement the bare array to match the contract and tests.
- The client also tolerates a legacy `{ success, message, data }` envelope and `access_token`
  snake_case, but **do not rely on that tolerance** — emit exactly the doc 04 shapes.

### 2.3 Pagination and list query params

- `page` (int ≥ 1, default 1), `limit` (int, clamp to 1..100, default 20; audit-logs default 50).
  The frontend clamps limit the same way, so never return more than `limit` items.
- Common filters (omit when absent — the client never sends empty strings):
  - `search` — case-insensitive `ILIKE %term%` over the resource's name-ish columns (users:
    first/last/email; branches: name/code; fuel-types: name/code; suppliers: name/code;
    tankers: registration/code).
  - `status` — exact enum match.
  - `branchId`, `fuelTypeId`, `supplierId`, `role`, `userId`, `action`, `resourceType` — exact match,
    always intersected with the caller's scope.
  - `from` / `to` — ISO 8601 date or datetime, **inclusive** range on the resource's business
    timestamp (`soldAt`, `deliveredAt`, `occurredAt`, `expectedDeliveryAt`, `createdAt`,
    `reportDate`). If given a bare date, treat it as that full day in the business timezone
    (Africa/Lagos, UTC+1 — no DST).
  - `active=true` (fuel-prices only) — only intervals containing "now".

### 2.4 Authentication

- `Authorization: Bearer <accessToken>` on **every** endpoint except:
  `POST /auth/login`, `POST /auth/refresh`, `POST /auth/forgot-password`, `POST /auth/reset-password`.
- Access token: JWT, **short-lived** (`expiresIn` seconds returned by login; 900 = 15 min is the
  documented default), carried in memory by the frontend (never stored).
- Refresh token: **httpOnly cookie** `kby_refresh_token` (Secure in production, SameSite=Lax,
  Path=`/`). Rotated on every refresh. Revocable individually (`logout`) and globally
  (`logout-all`). Persist refresh tokens in a DB table with hash, expiry, user, device metadata.
- **Refresh flow the frontend implements** (`src/api/client.ts`):
  1. Any request may get `401`. The client fires a **single-flight** `POST /api/v1/auth/refresh`
     with header `X-Requested-Refresh: true`, no Authorization header, empty JSON body `{}`.
     (It *can* send `{ "refreshToken": "..." }` if a reader is registered — with a real backend
     the cookie is the source of truth; accept both.)
  2. Success → `{ "data": { "accessToken": "...", "expiresIn": 900 } }` (+ new cookie) and the
     original request is **retried once** with the new token.
  3. Failure → the client clears the token and routes to login. Respond
     `401 { code: "AUTH_REFRESH_TOKEN_INVALID" }`.
  - `GET /auth/me` and everything under `/auth/*` never triggers a refresh loop.
- Account must be `status: 'ACTIVE'` to authenticate. A suspended/inactive user gets
  `AUTH_ACCOUNT_INACTIVE` on login; existing refresh sessions must be revoked on status change.

### 2.5 Idempotency (doc 04 §103)

The frontend sends an `Idempotency-Key: <uuid v4>` header on every financially-dangerous write:

- `POST /sales`
- `POST /fuel-orders` and `POST /fuel-orders/:id/{submit|confirm|in-transit|cancel}`
- `POST /deliveries/:id/receive` and `POST /deliveries/:id/dispute`
- `POST /inventory/adjustments`

Backend behaviour: persist `(key, user/tenant scope)` → first execution wins; a replayed key
returns the original response (or at minimum must **not** repeat the side effect). If a key is
reused with a different payload, respond `409 { code: "DUPLICATE_REQUEST" }`. Suggested retention
24h. A double-tap on a slow network must never create two sales, two orders, or receive a
delivery twice.

### 2.6 Error contract (doc 04 §7) — the most integration-sensitive part

Every non-2xx response body:

```jsonc
{
  "statusCode": 422,                    // mirrors the HTTP status
  "code": "INVALID_ORDER_STATUS",       // machine code from the closed list below
  "message": "This order cannot move to that status.",  // human, safe to show inline
  "errors": [                            // optional, field-level for forms
    { "field": "items.0.unitCost", "message": "unitCost must be greater than 0" }
  ],
  "timestamp": "2026-10-05T10:00:00.000Z",
  "path": "/api/v1/fuel-orders/123/confirm"
}
```

- `message` must be user-presentable (the frontend renders it verbatim in inline alerts) and
  must never contain stack traces (they are filtered out client-side, but don't send them).
- Field errors surface directly under form fields via `errors[].field`.
- Known `code` values (closed list — the frontend maps each to fixed copy):

| Code | Meaning / typical status |
|---|---|
| `AUTH_INVALID_CREDENTIALS` | 401 login failed (use neutral copy — no user enumeration) |
| `AUTH_TOKEN_EXPIRED` | 401 missing/expired/invalid access token → triggers refresh |
| `AUTH_REFRESH_TOKEN_INVALID` | 401 refresh failed |
| `AUTH_ACCOUNT_INACTIVE` | 401/403 account not ACTIVE |
| `VALIDATION_ERROR` | 400 body/query validation failed (`errors[]` populated) |
| `RESOURCE_NOT_FOUND` | 404 |
| `RESOURCE_ALREADY_EXISTS` | 409 unique constraint (email, codes, registration numbers) |
| `BUSINESS_ACCESS_DENIED` | 403 cross-business / role lacks privilege |
| `BRANCH_ACCESS_DENIED` | 403 manager touching another branch |
| `INSUFFICIENT_INVENTORY` | 422 sale/adjustment would take stock below zero |
| `INVALID_FUEL_PRICE` | 422 overlapping price interval, or no applicable price at sale time |
| `INVALID_DELIVERY_QUANTITY` | 422 negative delivery quantity |
| `INVALID_ORDER_STATUS` | 422 illegal fuel-order transition |
| `INVALID_DELIVERY_STATUS` | 422 receive/dispute on a non-PENDING delivery |
| `INVALID_REPORT_STATUS` | 422 illegal daily-report transition |
| `REPORT_ALREADY_EXISTS` | 409 report already exists for (branch, reportDate) |
| `REPORT_NOT_SUBMITTABLE` | 422 submit on non-DRAFT |
| `REPORT_NOT_APPROVABLE` | 422 approve on non-SUBMITTED/UNDER_REVIEW |
| `DUPLICATE_REQUEST` | 409 idempotency replay conflict |
| `INVALID_OPERATION` | 422 semantically disallowed (self-status change, already voided sale, …) |

- The frontend also falls back to **status-based copy** for unknown codes, so an unexpected
  failure degrades gracefully — but always emit a known code where one fits.
- Rate limiting on auth endpoints → `429` (frontend shows "Too many requests…").

### 2.7 Data formatting

- **Money**: PostgreSQL `NUMERIC(18,2)`, JSON wire format **number** (doc 04 examples), `> 0`
  where documented. Never round client-side; the backend computes all amounts.
- **Quantities (litres)**: `NUMERIC(18,3)`, JSON number. Order expected quantities `> 0`;
  delivery actual quantities `>= 0`; sale litres `> 0`.
- **Timestamps**: ISO 8601 UTC (`2026-10-05T14:03:00.000Z`). Store `timestamptz`. Display
  timezone is Africa/Lagos — a pure frontend concern.
- **`reportDate`** is a bare DATE string `"2026-10-05"` (no time, no timezone). Unique per
  `(branchId, reportDate)`.

---

## 3. Enums — must match exactly (PostgreSQL enums / TS unions)

```text
user_role                    : SUPER_ADMIN | ADMIN | MANAGER
account_status               : ACTIVE | INACTIVE | SUSPENDED          (users, and reused for fuel_types/suppliers/tankers)
business_status              : ACTIVE | INACTIVE | SUSPENDED
branch_status                : ACTIVE | INACTIVE                      (no SUSPENDED!)
fuel_order_status            : DRAFT | SUBMITTED | CONFIRMED | IN_TRANSIT | PARTIALLY_DELIVERED | DELIVERED | CANCELLED
delivery_status              : PENDING | RECEIVED | DISPUTED | CANCELLED
inventory_transaction_type   : OPENING_BALANCE | DELIVERY | SALE | ADJUSTMENT | TRANSFER_IN | TRANSFER_OUT | CORRECTION
daily_report_status          : DRAFT | SUBMITTED | UNDER_REVIEW | APPROVED | REJECTED
notification_type            : REPORT_SUBMITTED | REPORT_APPROVED | REPORT_REJECTED | DELIVERY_RECEIVED | DELIVERY_DISCREPANCY | LOW_INVENTORY | SYSTEM
notification_status          : UNREAD | READ
```

Status transition tables (reject with `INVALID_*_STATUS` / 422 on anything else):

```text
fuel_order : DRAFT→SUBMITTED,CANCELLED · SUBMITTED→CONFIRMED,CANCELLED · CONFIRMED→IN_TRANSIT,CANCELLED
             IN_TRANSIT→PARTIALLY_DELIVERED,DELIVERED · PARTIALLY_DELIVERED→DELIVERED · DELIVERED,CANCELLED terminal
delivery   : PENDING→RECEIVED|DISPUTED|CANCELLED (terminal states afterwards)
report     : DRAFT→SUBMITTED · SUBMITTED→APPROVED|REJECTED · UNDER_REVIEW→APPROVED|REJECTED · REJECTED→DRAFT
sale       : no status column — `voidedAt: null | timestamp` decides CREATED vs VOIDED
```

Note: `UNDER_REVIEW` has **no endpoint** (no operation sets or clears it) — keep the enum value
for rendering parity only.

---

## 4. Endpoint reference (58 routes — the complete frontend surface)

Conventions: 🔒 = requires `Authorization`; roles listed are the only ones allowed (others →
`403 BUSINESS_ACCESS_DENIED`). "Scoped" = intersect with caller scope per §1.2. Response shown
is the payload inside `{ "data": ... }`.

### 4.1 Auth — `src/api/auth.api.ts`

| # | Endpoint | Roles | Notes |
|---|---|---|---|
| 1 | `POST /auth/login` `{email, password}` | public | → `{ accessToken, refreshToken: string\|null, expiresIn: number(seconds), user: AuthenticatedUser }`; sets `kby_refresh_token` httpOnly cookie; normalises email (client sends lowercase); `401 AUTH_INVALID_CREDENTIALS` (neutral message), `AUTH_ACCOUNT_INACTIVE` when not ACTIVE; updates `lastLoginAt`; audit `LOGIN_SUCCESS`/`LOGIN_FAILED` |
| 2 | `POST /auth/refresh` | public | header `X-Requested-Refresh: true`, body `{}` (or `{refreshToken}`); rotates cookie → `{ accessToken, expiresIn }`; `401 AUTH_REFRESH_TOKEN_INVALID`; rate-limit |
| 3 | `POST /auth/logout` 🔒 | any | `204` empty; revokes the presented refresh session, clears cookie |
| 4 | `POST /auth/logout-all` 🔒 | any | `204`; revokes **all** the user's refresh sessions |
| 5 | `POST /auth/forgot-password` `{email}` | public | always `204`/200-neutral regardless of account existence (doc 06 §40); emails a single-use token |
| 6 | `POST /auth/reset-password` `{token, password}` | public | `password` (NOT `newPassword`), min 8 chars; token single-use + expiry; invalidates all sessions after reset; audit `PASSWORD_RESET`; `204` |
| 7 | `POST /auth/change-password` 🔒 `{currentPassword, newPassword}` | any | `newPassword ≠ currentPassword` (min 8); `204`; audit `PASSWORD_RESET` |
| 8 | `GET /auth/me` 🔒 | any | → **the AuthenticatedUser object itself** (not `data.user`); `401 AUTH_TOKEN_EXPIRED` when missing/expired |

`AuthenticatedUser` (also the `user` in login):

```jsonc
{ "id": "uuid", "firstName": "...", "lastName": "...", "email": "...", "phone": "...|null",
  "avatarUrl": "string|null", "role": "SUPER_ADMIN|ADMIN|MANAGER", "status": "ACTIVE|INACTIVE|SUSPENDED",
  "businessId": "uuid|null", "branchId": "uuid|null" }
```

### 4.2 Businesses — `businesses.api.ts`

| # | Endpoint | Roles | Notes |
|---|---|---|---|
| 9 | `GET /businesses` `?search&page&limit` | SUPER_ADMIN | paginated `Business[]`; others → 403 |
| 10 | `GET /businesses/:id` | SUPER_ADMIN any; ADMIN/MANAGER own business only | used by the app shell to show the business name; foreign id → `404` |
| 11 | `POST /businesses` `{name, registrationNumber?, email?, phone?, address?}` | SUPER_ADMIN | `201 Business`; audit `BUSINESS_CREATED` |

`Business`: `{ id, name, registrationNumber, email, phone, address, status: business_status }` (nullable strings).

### 4.3 Branches — `branches.api.ts`

| # | Endpoint | Roles | Notes |
|---|---|---|---|
| 12 | `GET /branches` `?search&status&page&limit` | any authed, scoped | ADMIN → own business's branches; MANAGER → **only own branch**; SUPER_ADMIN → all. Never accept businessId (doc 04 §92) |
| 13 | `POST /branches` `{name, code, address, phone?}` | ADMIN, SUPER_ADMIN | businessId derived from caller (for SUPER_ADMIN, require `businessId` in body); `code` unique per business → `409 RESOURCE_ALREADY_EXISTS`; `201 Branch`; audit `BRANCH_CREATED` |
| 14 | `PATCH /branches/:id` `{name?, address?, phone?, status?, code?}` | ADMIN, SUPER_ADMIN | used for edits **and** ACTIVATE/DEACTIVATE (there is no `/branches/:id/status` route — ASSUMPTIONS §2.9); `409` on duplicate code; audit `BRANCH_UPDATED` |

`Branch`: `{ id, businessId, name, code, address, phone, status: branch_status }`.

### 4.4 Users — `users.api.ts`

| # | Endpoint | Roles | Notes |
|---|---|---|---|
| 15 | `GET /users` `?page&limit&search&role&status&branchId` | ADMIN, SUPER_ADMIN | ADMIN → own business only; SUPER_ADMIN → all (optional implicit filtering); MANAGER → 403 |
| 16 | `POST /users` `{firstName, lastName, email, phone?, password, role: 'ADMIN'\|'MANAGER', branchId?}` | ADMIN, SUPER_ADMIN | businessId derived from caller; **MANAGER requires `branchId`** (must belong to caller's business); **ADMIN must not have `branchId`**; email lowercased, unique per `LOWER(email)` → `409`; password min 8, stored hashed (bcrypt/argon2); `201 User`; audit `USER_CREATED` |
| 17 | `PATCH /users/:id` `{firstName, lastName, phone: string\|null, branchId?}` | ADMIN, SUPER_ADMIN | **`email` and `role` are immutable here — reject them**; `phone: null` clears the column; guards: self-edit → `422 INVALID_OPERATION`; target SUPER_ADMIN → 403; ADMIN may only edit MANAGERs of own business → else 403; MANAGER target's `branchId` must stay in same business; audit `USER_UPDATED` |
| 18 | `PATCH /users/:id/status` `{status: 'ACTIVE'\|'INACTIVE'\|'SUSPENDED'}` | ADMIN, SUPER_ADMIN | invalid status → `400 VALIDATION_ERROR`; self → `422 INVALID_OPERATION`; target SUPER_ADMIN → 403; ADMIN only own-business MANAGERs; revokes the target's sessions when not ACTIVE; audit `USER_DEACTIVATED` |
| 19 | `DELETE /users/:id` 🔒 | ADMIN, SUPER_ADMIN | **frontend extension beyond doc 04** (permanent removal) — must exist or the Users-page Delete action breaks; same guards as #18; `204` empty |
| 20 | `POST /users/me/avatar` `{avatarUrl: string\|null}` 🔒 | any | ⚠ see §6.1 decision; validates a `data:image/(png\|jpeg\|webp);base64,` URL ≤ ~3.5M chars or `null` to remove; → updated `AuthenticatedUser`; `400 VALIDATION_ERROR` otherwise |

`User` (list/create responses): `AuthenticatedUser` fields + `lastLoginAt: string|null`.
(Admins see managers' and other admins' `avatarUrl` too — include it.)

### 4.5 Fuel types — `fuel-types.api.ts`

| # | Endpoint | Roles | Notes |
|---|---|---|---|
| 21 | `GET /fuel-types` `?page&limit&search&status` | any authed | paginated |
| 22 | `POST /fuel-types` `{name, code, description?}` | ADMIN, SUPER_ADMIN | `code` matches `^[A-Z0-9_-]+$` (client uppercases first), unique per business → `409`; `description` absent = null; `201 FuelType`; audit `FUEL_TYPE_CREATED` |
| 23 | `PATCH /fuel-types/:id` `{name?, description?: string\|null}` | ADMIN, SUPER_ADMIN | **`code` is immutable after creation — reject it**; `description: null` clears; audit `FUEL_TYPE_UPDATED` |

`FuelType`: `{ id, name, code, description, status }`.

### 4.6 Fuel prices — `fuel-prices.api.ts`

| # | Endpoint | Roles | Notes |
|---|---|---|---|
| 24 | `GET /fuel-prices` `?page&limit&fuelTypeId&active=true&from&to` | any authed | `active=true` → only intervals containing now; `from/to` filters power the history view (sort `effectiveFrom` DESC); paginated |
| 25 | `GET /fuel-prices/current/:fuelTypeId` | any authed | → `{ fuelTypeId, pricePerLitre, effectiveFrom, effectiveTo: null }` for the open interval; `404` when none applies |
| 26 | `POST /fuel-prices` `{fuelTypeId, pricePerLitre (> 0), effectiveFrom (ISO)}` | ADMIN, SUPER_ADMIN | creates a new interval **and closes the previous open one** (`effectiveTo = new effectiveFrom`); overlapping intervals → `422 INVALID_FUEL_PRICE`; backdating is refused by the UI but the API may accept it — implement overlap checks transactionally; audit `FUEL_PRICE_CREATED` |

`FuelPrice`: `{ id, fuelTypeId, pricePerLitre, effectiveFrom, effectiveTo: string|null }`.

### 4.7 Suppliers — `suppliers.api.ts`

| # | Endpoint | Roles | Notes |
|---|---|---|---|
| 27 | `GET /suppliers` `?page&limit&search&status` | any authed, scoped | |
| 28 | `POST /suppliers` `{name, code, contactPerson?, phone?, email?, address?}` | ADMIN, SUPER_ADMIN | `code` unique per business → `409`; `201 Supplier`; audit `SUPPLIER_CREATED` |
| 29 | `PATCH /suppliers/:id` `{name?, code?, contactPerson?|null, phone?|null, email?|null, address?|null, status?}` | ADMIN, SUPER_ADMIN | `409` duplicate code; nullable contact fields clear the column; audit `SUPPLIER_UPDATED` |

`Supplier`: `{ id, businessId, name, code, contactPerson, phone, email, address, status }`.

### 4.8 Tankers — `tankers.api.ts`

| # | Endpoint | Roles | Notes |
|---|---|---|---|
| 30 | `GET /tankers` `?page&limit&search&status` | any authed, scoped | |
| 31 | `POST /tankers` `{registrationNumber, tankerCode?, capacityLitres (> 0), driverName?, driverPhone?}` | ADMIN, SUPER_ADMIN | `registrationNumber` unique per business, compare `UPPER(...)` → `409`; `capacityLitres` `CHECK > 0`; `201 Tanker`; audit `TANKER_CREATED` |
| 32 | `PATCH /tankers/:id` `{registrationNumber?, tankerCode?|null, capacityLitres?, driverName?|null, driverPhone?|null, status?}` | ADMIN, SUPER_ADMIN | `capacityLitres > 0` else 400; `409` duplicate registration; audit `TANKER_UPDATED` |

`Tanker`: `{ id, businessId, registrationNumber, tankerCode, capacityLitres, driverName, driverPhone, status }`.

### 4.9 Fuel orders — `fuel-orders.api.ts`

| # | Endpoint | Roles | Notes |
|---|---|---|---|
| 33 | `GET /fuel-orders` `?page&limit&status&branchId&supplierId&from&to` | any authed, scoped | MANAGER sees orders whose `destinationBranch` is his branch |
| 34 | `GET /fuel-orders/:id` | any authed, scoped | full detail incl. `items[].fuelTypeName` |
| 35 | `POST /fuel-orders` `{supplierId, destinationBranchId, expectedDeliveryAt (ISO), notes?, items: [{fuelTypeId, expectedQuantityLitres (> 0), unitCost (> 0)}]}` | ADMIN, SUPER_ADMIN | exactly these fields — no `businessId`, no `status`; always created `DRAFT`; `items` 1..20; generates `orderNumber` (e.g. `PO-2026-000001`-style, your choice — frontend only displays it); `201 FuelOrder`; audit `FUEL_ORDER_CREATED`; **idempotency-key required** |
| 36 | `POST /fuel-orders/:id/{submit\|confirm\|in-transit\|cancel}` | ADMIN, SUPER_ADMIN | body only for `cancel`: `{"reason": "..."}` (required, else 400); illegal transition → `422 INVALID_ORDER_STATUS`; `cancel` from DRAFT/SUBMITTED/CONFIRMED only; **`confirm` and `in-transit` create the PENDING `Delivery` for the order** (doc 09) so managers can receive it; each → `200 FuelOrder`; audit `FUEL_ORDER_SUBMITTED`/`CONFIRMED`/`CANCELLED`; idempotency-key on all four |

`FuelOrder`:

```jsonc
{ "id": "uuid", "orderNumber": "...", "status": "DRAFT",
  "supplier": { "id": "uuid", "name": "..." },
  "destinationBranch": { "id": "uuid", "name": "..." },
  "expectedDeliveryAt": "ISO", "orderedAt": "ISO?", "notes": "string|null",
  "items": [ { "fuelTypeId": "uuid", "fuelTypeName": "PMS",
               "expectedQuantityLitres": 5, "unitCost": 6 } ] }
```

`unitCost` is procurement cost per litre — **never** the retail price.

### 4.10 Deliveries — `deliveries.api.ts`

Deliveries are **created by the backend** (on order confirm / in-transit — decide per doc 09;
recommend: created `PENDING` at `in-transit`). The frontend never POSTs a delivery.

| # | Endpoint | Roles | Notes |
|---|---|---|---|
| 37 | `GET /deliveries` `?page&limit&status&branchId&from&to` | any authed, scoped | scoped by `destinationBranchId` |
| 38 | `GET /deliveries/:id` | any authed, scoped | full detail; include enrichment `tanker: {id, name?, registrationNumber?, driverName?}` and `fuelOrder: {id, orderNumber}` (the receiving screen renders them) |
| 39 | `POST /deliveries/:id/receive` `{items: [{fuelTypeId, actualQuantityLitres (>= 0), discrepancyReason?}]}` | MANAGER (destination branch), ADMIN, SUPER_ADMIN | the money path — see rules below; `200 Delivery` (status `RECEIVED`); idempotency-key required |
| 40 | `POST /deliveries/:id/dispute` `{reason}` (required) | MANAGER, ADMIN, SUPER_ADMIN | status → `DISPUTED`; **no inventory movement**; `200 Delivery`; audit `DELIVERY_DISPUTED`; idempotency-key |

Receive semantics (all in one DB transaction):

1. Delivery must be `PENDING` → else `422 INVALID_DELIVERY_STATUS`.
2. Quantities `>= 0` → else `422 INVALID_DELIVERY_QUANTITY`.
3. For each item, write an `inventory_transactions` row of type `DELIVERY` with
   `quantityLitres = actualQuantityLitres` (**actual, never expected**) and update that
   branch+fuel stock.
4. Set item `actualQuantityLitres` and `differenceLitres = actual − expected`, store
   `discrepancyReason` when provided.
5. Set delivery `RECEIVED`; advance the parent order: all items received → `DELIVERED`,
   some → `PARTIALLY_DELIVERED` (per the transition table).
6. Notifications: `DELIVERY_RECEIVED` to the branch admins; `DELIVERY_DISCREPANCY` when any
   `differenceLitres ≠ 0`. Audit `DELIVERY_RECEIVED`.

`Delivery`: `{ id, deliveryNumber: string|null, status, fuelOrderId, tankerId,
destinationBranchId, deliveredAt, notes, items: DeliveryItem[], tanker?, fuelOrder? }`;
`DeliveryItem`: `{ id, fuelTypeId, fuelTypeName?, expectedQuantityLitres,
actualQuantityLitres: number|null, differenceLitres: number|null, discrepancyReason: string|null }`.

### 4.11 Inventory — `inventory.api.ts`

| # | Endpoint | Roles | Notes |
|---|---|---|---|
| 41 | `GET /inventory` `?branchId&fuelTypeId` | any authed, scoped | ⚠ **bare array** (no envelope): `InventoryStock[]` — current stock per (branch, fuel type); MANAGER clamped to own branch |
| 42 | `GET /inventory/summary` `?branchId` | any authed, scoped | → `InventorySummary` (below) |
| 43 | `GET /inventory/transactions` `?page&limit&branchId&fuelTypeId&type&from&to` | any authed, scoped | the ledger, `occurredAt` DESC, paginated |
| 44 | `POST /inventory/adjustments` `{branchId, fuelTypeId, quantityLitres (signed), reason (required)}` | ADMIN, SUPER_ADMIN | writes one `ADJUSTMENT` transaction (negative = removal); **never edits historical rows**; `201 InventoryTransaction`; going below zero → `422 INSUFFICIENT_INVENTORY`; audit `INVENTORY_ADJUSTED`; idempotency-key |

```jsonc
// InventoryStock
{ "branchId": "uuid", "branchName": "KBY Ikeja", "fuelTypeId": "uuid",
  "fuelTypeName": "PMS", "currentQuantityLitres": 12500.5 }
// InventorySummary — NOTE the key is "fuelType" here (not "fuelTypeName")
{ "branchId": "uuid", "asOf": "ISO", 
  "fuel": [ { "fuelTypeId": "uuid", "fuelType": "PMS", "currentQuantityLitres": 12500.5 } ] }
// InventoryTransaction
{ "id": "uuid", "branchId": "uuid", "fuelTypeId": "uuid",
  "transactionType": "SALE", "quantityLitres": -35.5, "balanceAfter": 12465,
  "referenceType": "SALE", "referenceId": "uuid", "occurredAt": "ISO", "reason": null }
```

Ledger sign convention: `OPENING_BALANCE +`, `DELIVERY +`, `SALE −`, `TRANSFER_IN +`,
`TRANSFER_OUT −`, `ADJUSTMENT`/`CORRECTION` signed either way. `balanceAfter` is a derived
snapshot; the authoritative value is `SUM(quantity_litres)`.

### 4.12 Sales — `sales.api.ts`

| # | Endpoint | Roles | Notes |
|---|---|---|---|
| 45 | `GET /sales` `?page&limit&branchId&fuelTypeId&from&to` | any authed, scoped | |
| 46 | `POST /sales` `{branchId, fuelTypeId, litresSold (> 0), soldAt (ISO, defaults now)}` | MANAGER, ADMIN, SUPER_ADMIN | exactly four fields — **no price inputs**; backend: resolve price applicable at `soldAt` (none → `422 INVALID_FUEL_PRICE`), snapshot `unitPrice`, compute `totalAmount = litresSold × unitPrice`, generate `saleNumber` `SALE-2026-000001` (unique per business), write the negative `SALE` ledger row; insufficient stock → `422 INSUFFICIENT_INVENTORY`; `201 Sale`; audit `SALE_CREATED`; idempotency-key required |
| 47 | `POST /sales/:id/void` `{reason}` (required) | ADMIN, SUPER_ADMIN | already voided → `422 INVALID_OPERATION`; sets `voidedAt`/`voidReason`; writes a `CORRECTION` ledger row `+litresSold` referencing the sale (history preserved); `200 Sale`; audit `SALE_VOIDED`; idempotency-key |

`Sale`: `{ id, saleNumber, branchId, fuelTypeId, fuelTypeName?, litresSold, unitPrice,
totalAmount, soldAt, voidedAt: string|null, voidReason: string|null }`.

### 4.13 Daily reports — `daily-reports.api.ts`

| # | Endpoint | Roles | Notes |
|---|---|---|---|
| 48 | `GET /daily-reports` `?page&limit&branchId&status&from&to` | any authed, scoped | |
| 49 | `GET /daily-reports/:id` | any authed, scoped | MANAGER cross-branch → `403 BRANCH_ACCESS_DENIED` |
| 50 | `POST /daily-reports` `{branchId, reportDate: "YYYY-MM-DD", managerNotes?}` | MANAGER, ADMIN, SUPER_ADMIN | **all figures backend-computed** from the ledger for that branch+date: `openingStockLitres` (previous day's closing / ledger sum before the day), `totalReceivedLitres` (DELIVERY that date), `totalSoldLitres` (SALE that date), `closingStockLitres = opening + received − sold`, `totalRevenue` (Σ sale `totalAmount` that date); creates as `DRAFT`; `(branchId, reportDate)` already exists → `409 REPORT_ALREADY_EXISTS`; future date → 400; **creates no inventory transactions**; `201 DailyReport`; audit `DAILY_REPORT_CREATED` |
| 51 | `POST /daily-reports/:id/submit` | MANAGER (own branch) | `DRAFT → SUBMITTED`; else `422 REPORT_NOT_SUBMITTABLE`; notification `REPORT_SUBMITTED` to the business admins; audit `DAILY_REPORT_SUBMITTED` |
| 52 | `POST /daily-reports/:id/approve` | ADMIN, SUPER_ADMIN | `SUBMITTED\|UNDER_REVIEW → APPROVED`; else `422 REPORT_NOT_APPROVABLE`; sets `reviewedBy`/`reviewedAt`; notification `REPORT_APPROVED` to the manager; audit `DAILY_REPORT_APPROVED` |
| 53 | `POST /daily-reports/:id/reject` `{reason}` (required) | ADMIN, SUPER_ADMIN | `SUBMITTED\|UNDER_REVIEW → REJECTED`; stores `rejectionReason` (+ reviewer fields); notification `REPORT_REJECTED`; audit `DAILY_REPORT_REJECTED` |
| 54 | `POST /daily-reports/:id/resubmit` | MANAGER (own branch) | `REJECTED → DRAFT` (per doc 04 §71 — manager then edits/resubmits); other statuses → `422 INVALID_REPORT_STATUS` |

`DailyReport`: `{ id, branchId, reportDate: "YYYY-MM-DD", status, openingStockLitres,
totalReceivedLitres, totalSoldLitres, closingStockLitres, totalRevenue, managerNotes: string|null,
reviewedBy?: string|null, reviewedAt?: string|null, rejectionReason?: string|null }`.
The frontend checks `opening + received − sold == closing` and displays mismatches — compute
everything from the ledger so it always reconciles.

### 4.14 Notifications — `notifications.api.ts` (per-user, scoped to recipient)

| # | Endpoint | Roles | Notes |
|---|---|---|---|
| 55 | `GET /notifications` `?page&limit&status(UNREAD\|READ)&type` | any authed | recipient = caller; `createdAt` DESC; paginated |
| 56 | `PATCH /notifications/:id/read` | any authed (own) | sets `status: READ`, `readAt`; `404` foreign id; → updated notification |
| 57 | `PATCH /notifications/read-all` | any authed | static sibling path (must not be swallowed by `:id`); marks all the caller's notifications READ; → `{ "updated": <n> }` (body is ignored by the client) |

The unread badge polls `GET /notifications?status=UNREAD&limit=1` and reads `meta.total` —
**the `meta` envelope is required here.**

`AppNotification`: `{ id, type, title, message: string|null, status, resourceType: string|null,
resourceId: string|null, createdAt, readAt: string|null }`. Backend-generated events: report
submitted (→ admins), approved/rejected (→ the author manager), delivery received /
discrepancy (→ admins), low inventory (threshold breach), SYSTEM.

### 4.15 Dashboard — `dashboard.api.ts`

| # | Endpoint | Roles | Notes |
|---|---|---|---|
| 58 | `GET /dashboard/admin` `?from&to&branchId` (all optional) | ADMIN, SUPER_ADMIN | → `AdminDashboard` below |
| 59 | `GET /dashboard/manager` | MANAGER | auto-scoped to the caller's branch → `ManagerDashboard` |

```jsonc
// AdminDashboard
{ "summary": { "totalBranches": 3, "totalFuelReceivedLitres": 0, "totalFuelSoldLitres": 0,
               "totalRevenue": 0, "lowInventoryBranches": 0 },
  "branches": [ { "branchId": "uuid", "branchName": "KBY Ikeja",
                  "fuelSoldLitres": 0, "revenue": 0 } ] }
// ManagerDashboard
{ "branch": { "id": "uuid", "name": "KBY Ikeja" },
  "inventory": [ /* InventoryStock[] for the branch */ ],
  "today": { "litresSold": 0, "revenue": 0 },
  "dailyReport": { "status": "DRAFT" } | null }   // today's report, null if none
```

`GET /dashboard/inventory` (doc 04 §78) is **not** used by the frontend — optional.

### 4.16 Audit logs — `audit-logs.api.ts`

| # | Endpoint | Roles | Notes |
|---|---|---|---|
| 60 | `GET /audit-logs` `?page&limit(default 50)&userId&action&resourceType&from&to` | ADMIN, SUPER_ADMIN | ADMIN → own business's rows; SUPER_ADMIN → all; `createdAt` DESC; append-only, read-only API |

`AuditLog`: `{ id, businessId: string|null, branchId: string|null, userId: string|null,
action, resourceType: string|null, resourceId: string|null, oldValues: object|null,
newValues: object|null, metadata: object|null, ipAddress: string|null, createdAt }`.
(DB column is `user_id`; the API field is `userId`.)

Canonical `action` values (filter list mirrors these): `USER_CREATED, USER_UPDATED,
USER_DEACTIVATED, BUSINESS_CREATED, BUSINESS_UPDATED, BRANCH_CREATED, BRANCH_UPDATED,
FUEL_TYPE_CREATED, FUEL_TYPE_UPDATED, FUEL_PRICE_CREATED, SUPPLIER_CREATED, SUPPLIER_UPDATED,
TANKER_CREATED, TANKER_UPDATED, FUEL_ORDER_CREATED, FUEL_ORDER_SUBMITTED,
FUEL_ORDER_CONFIRMED, FUEL_ORDER_CANCELLED, DELIVERY_CREATED, DELIVERY_RECEIVED,
DELIVERY_DISPUTED, INVENTORY_ADJUSTED, SALE_CREATED, SALE_VOIDED, DAILY_REPORT_CREATED,
DAILY_REPORT_SUBMITTED, DAILY_REPORT_APPROVED, DAILY_REPORT_REJECTED, LOGIN_SUCCESS,
LOGIN_FAILED, PASSWORD_RESET`. Resource types: `SALE, DELIVERY, DAILY_REPORT, FUEL_ORDER,
FUEL_PRICE, INVENTORY, USER, AUTH` (plus business/branch/fuel-type/supplier/tanker rows).

### 4.17 Branch switcher + reports

| # | Endpoint | Roles | Notes |
|---|---|---|---|
| 61 | `GET /me/branches` | any authed | branches the caller may operate: MANAGER → `[own branch]`; ADMIN → all business branches; SUPER_ADMIN → all; → `Branch[]` |
| 62 | `GET /reports/{sales\|inventory\|deliveries\|daily-reports}` `?from&to&branchId` | ADMIN, SUPER_ADMIN | documented but **unused for data** (no response schema in doc 04) — implement last; any JSON |
| 63 | `GET /reports/{kind}/export` `?format=xlsx&from&to&branchId` | ADMIN, SUPER_ADMIN | file download — see §6.2 auth caveat; `Content-Disposition: attachment`; filename `{kind}-report-{from}-to-{to}.xlsx` (frontend derives the name itself; header is advisory) |

---

## 5. Database design guidance (PostgreSQL)

Suggested core schema (names from doc 03, snake_case):

- `businesses(id, name, registration_number, email, phone, address, status business_status, timestamps)`
- `branches(id, business_id → businesses, name, code, address, phone, status branch_status)`;
  UNIQUE `(business_id, code)`
- `users(id, business_id NULL, branch_id NULL, first_name, last_name, email, phone,
  avatar_url TEXT NULL, role user_role, status account_status, password_hash, last_login_at)`;
  UNIQUE on `LOWER(email)`; CHECKs enforcing the §1.2 scope invariants
  (`role='SUPER_ADMIN' → business_id IS NULL AND branch_id IS NULL`, etc.)
- `fuel_types(id, business_id, name, code, description, status account_status)`;
  UNIQUE `(business_id, code)`; CHECK `code ~ '^[A-Z0-9_-]+$'`
- `fuel_prices(id, business_id, fuel_type_id, price_per_litre NUMERIC(18,2) CHECK > 0,
  effective_from timestamptz, effective_to timestamptz NULL)`;
  overlap prevention: `EXCLUDE USING gist (fuel_type_id WITH =, tstzrange(effective_from, effective_to) WITH &&)`
  (with a `NULL`-friendly constraint or application-level check inside one transaction)
- `suppliers(id, business_id, name, code, contact_person, phone, email, address, status)`;
  UNIQUE `(business_id, code)`
- `tankers(id, business_id, registration_number, tanker_code, capacity_litres NUMERIC(18,3) CHECK > 0,
  driver_name, driver_phone, status)`; UNIQUE `(business_id, UPPER(registration_number))`
- `fuel_orders(id, order_number, business_id, supplier_id, destination_branch_id, status,
  expected_delivery_at, ordered_at, notes)`; UNIQUE `(business_id, order_number)`
- `fuel_order_items(id, fuel_order_id, fuel_type_id, expected_quantity_litres NUMERIC(18,3) CHECK > 0,
  unit_cost NUMERIC(18,2) CHECK > 0)`
- `deliveries(id, delivery_number NULL, fuel_order_id, tanker_id, destination_branch_id,
  status delivery_status, delivered_at, notes)`
- `delivery_items(id, delivery_id, fuel_order_item_id, expected_quantity_litres,
  actual_quantity_litres NUMERIC(18,3) NULL, difference_litres NUMERIC(18,3) NULL,
  discrepancy_reason TEXT NULL)` — `difference` derived; compute on receive
- `inventory_transactions(id, business_id, branch_id, fuel_type_id, type inventory_transaction_type,
  quantity_litres NUMERIC(18,3), balance_after NUMERIC(18,3), reference_type, reference_id,
  occurred_at, reason)` — append-only; index `(branch_id, fuel_type_id, occurred_at DESC)`
- `sales(id, sale_number, business_id, branch_id, fuel_type_id, litres_sold NUMERIC(18,3) CHECK > 0,
  unit_price NUMERIC(18,2), total_amount NUMERIC(18,2), sold_at timestamptz,
  voided_at timestamptz NULL, void_reason TEXT NULL, voided_by UUID NULL)`; UNIQUE `(business_id, sale_number)`
  — **no status column**
- `daily_reports(id, branch_id, report_date DATE, status daily_report_status,
  opening_stock_litres, total_received_litres, total_sold_litres, closing_stock_litres,
  total_revenue NUMERIC(18,2), manager_notes, reviewed_by, reviewed_at, rejection_reason)`;
  UNIQUE `(branch_id, report_date)`
- `notifications(id, user_id, type, title, message, status, resource_type, resource_id,
  read_at, created_at)`; index `(user_id, status, created_at DESC)`
- `audit_logs(id, business_id, branch_id, user_id, action, resource_type, resource_id,
  old_values JSONB, new_values JSONB, metadata JSONB, ip_address, created_at)` — append-only
  (REVOKE UPDATE/DELETE)
- `refresh_tokens(id, user_id, token_hash, expires_at, revoked_at NULL, user_agent, ip)` 
- `password_reset_tokens(id, user_id, token_hash, expires_at, used_at NULL)`
- `idempotency_keys(key, user_id, request_hash, response_snapshot JSONB, created_at)`; PK `key`

Stock per (branch, fuel type) may be a maintained `inventory_stock` table updated in the same
transaction as the ledger, or always derived via `SUM(quantity_litres)` — either is fine as
long as §4.11 shapes hold and `balance_after` matches the running sum.

---

## 6. Integration decisions the backend team must make (flagged by the frontend)

### 6.1 Avatar upload (`POST /users/me/avatar`) — REQUIRED DECISION

The mock accepts `{ avatarUrl: "data:image/png;base64,..." | null }` because a browser mock
has no file storage. A real backend should prefer **multipart/form-data** (`file` field, ≤ 2 MB,
`image/png|jpeg|webp`) and store to object storage / disk, returning the **URL** in
`avatarUrl`. The change is isolated to one frontend function (`updateMyAvatar` in
`src/api/users.api.ts`) — agree on this before integration and tell the frontend team; a
JSON data-URL implementation also works with **zero** frontend changes if you prefer to
postpone (cap the column, e.g. `TEXT`, and serve it back verbatim).

### 6.2 Excel export download (`GET /reports/:kind/export`) — REQUIRED DECISION

The frontend builds a plain URL and lets the **browser navigate** to it — such a request
cannot carry the in-memory `Authorization` header. Pick one:
(a) accept the `kby_refresh_token`-style **cookie session** for this GET (issue a short-lived
access cookie alongside), (b) support a short-lived signed query token, or (c) ask the
frontend to switch to fetch+blob (small change, no backend work). Decide before wiring the
Reports page.

### 6.3 Everything else is fixed

- `DELETE /users/:id` exists in the UI and must exist on the server (it is a deliberate
  extension beyond doc 04; suspension remains the recommended flow).
- The client tolerates `NUMERIC` arriving as strings, but emit **numbers** as documented.
- `POST /fuel-orders/:id/confirm|in-transit` must create the `PENDING` delivery row — the
  Deliveries screen lists only backend-created deliveries.
- Seed script for development parity: same demo accounts as the mock —
  `superadmin@kbyglobal.com`, `admin@kbyglobal.com`, `manager@kbyglobal.com` (plus two more
  branch managers), all `Password123!`, one business "K.B.Y GLOBAL INVESTMENT" with three
  branches (Ikeja, Yaba, Lekki), fuel types PMS/AGO/DPK, and an opening balance per branch.

---

## 7. NestJS implementation checklist

- Global prefix `api/v1`; `ValidationPipe({ whitelist: true, transform: true })` mapped to
  `VALIDATION_ERROR` + `errors[]` (field paths must match the JSON bodies above).
- One `TransformInterceptor` wrapping everything in `{ data, meta? }`; skip it for
  `GET /inventory` (bare array) and 204 routes.
- One `HttpExceptionFilter` emitting the §2.6 error shape with the closed `code` list.
- `JwtAuthGuard` (passport-jwt; 15-min access tokens) + `RolesGuard` + a `ScopingGuard`/
  request-scoped "actor" provider carrying `{ userId, role, businessId, branchId }` used by
  every service for the §1.2 clamps.
- Idempotency: an `@Idempotent()` interceptor + `idempotency_keys` table on the six write
  families listed in §2.5.
- Audit: a service called from each write path (never a DB trigger that writes on read paths),
  capturing `oldValues`/`newValues` and the actor's IP.
- Notifications: raised inside the same DB transaction as the triggering event.
- Modules: `AuthModule, BusinessesModule, BranchesModule, UsersModule, FuelTypesModule,
  FuelPricesModule, SuppliersModule, TankersModule, FuelOrdersModule, DeliveriesModule,
  InventoryModule, SalesModule, DailyReportsModule, NotificationsModule, DashboardsModule,
  AuditLogsModule, ReportsModule` — mirroring §4 exactly.
- Suggested stack: Prisma **or** TypeORM, class-validator DTOs, `pgEnum` for every enum in §3,
  transactions around: price creation, sale recording, delivery receiving, adjustment,
  report approval-free computation, idempotent writes.
- Rate limit `POST /auth/login` and `/auth/refresh` (e.g. 10/min/IP) → `429`.

## 8. Acceptance test

The frontend's own suite (`src/api/*.test.ts`, 251 tests) exercises login, scoping, user CRUD
guards, price overlaps, sales pricing, delivery receiving, report computation, notifications
and avatar validation **against the mock**. Port those expectations to e2e tests against your
server: same requests, same envelopes, same codes. When `NEXT_PUBLIC_USE_MOCK_API=false`
serves every screen with zero console `request:unhandled` warnings and no visible
"We could not find what you were looking for." errors, you are done.
