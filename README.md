# RoBen RidePool

Take-home project for the RoBenDevs Software Engineer Internship.

**RoBen RidePool** is a shared-mobility platform: passengers join an existing
trip instead of booking a whole car alone, and drivers earn more by filling
empty seats on routes they were already driving.

> **Status: MVP complete.** The repository contains authentication with JWT and
> role authorization, the full ride-pooling domain (ride requests with departure
> windows, driver pools, matching with accept and decline, the ride lifecycle,
> and ratings), and role-aware passenger and driver dashboards over the documented
> REST API. See [Matching model](#matching-model) for the one rule everything hangs
> off, and [Current limitations](#current-limitations) for what is deliberately
> out of scope.

---

## Problem

Urban transport is inefficient in two directions at once:

- **For passengers** a solo taxi or private ride is expensive, especially for
  short or off-peak trips, and it puts one person in a car built for four.
- **For drivers** empty seats are lost revenue on every trip.

Ride pooling matches passengers travelling in a similar direction and time
window into one shared vehicle, which lowers the cost per passenger and raises
the driver's income per kilometre.

## MVP goal

Deliver a small, production-minded web application in which:

1. Passengers and drivers register, authenticate and manage separate profiles.
2. A passenger requests a ride with an origin, a destination and a departure
   window; a driver opens a pool for their own departure window.
3. Requests whose window overlaps a driver's are shown in that driver's queue,
   and the driver accepts into a pool or declines.
4. Both sides follow the ride status - `WAITING`, `MATCHED`, `IN_PROGRESS`,
   `COMPLETED` or `CANCELLED` - in a role-aware dashboard, and rate each other
   once the ride is complete.
5. The whole flow is reachable through a documented REST API and one web UI.

---

## Technology stack

| Layer      | Technology                                       |
| ---------- | ------------------------------------------------ |
| Frontend   | Next.js 16 (App Router), React 19, JavaScript    |
| Styling    | Tailwind CSS 4                                   |
| Backend    | Node.js 22, Express 5, JavaScript (ESM)          |
| Database   | PostgreSQL 16                                    |
| ORM        | Prisma 6                                         |
| Auth       | JWT + bcrypt                                     |
| Validation | Zod                                              |
| Testing    | Vitest + Supertest                               |
| Tooling    | Docker + Docker Compose                          |

Deliberately **not** used: Redis, Kafka, message queues, WebSockets,
microservices, Kubernetes. The MVP does not need them, and they would add
operational cost without product value.

---

## Architecture

A single repository with two deployable applications and one database.

```mermaid
flowchart LR
    Browser --> Frontend["Next.js frontend<br/>:3000"]
    Frontend --> Api["Express REST API<br/>:5000"]
    Api --> Db[("PostgreSQL<br/>:5432")]
    Api -.-> Prisma["Prisma ORM"]
    Prisma --> Db
```

- The **frontend** is a client-rendered Next.js App Router application. It talks
  to the backend over plain HTTP/JSON using `NEXT_PUBLIC_API_URL`, and resolves
  the session in the browser, because the stored token does not exist during
  prerender.
- The **backend** is a stateless Express REST API. It owns all business rules and
  is the only process that talks to the database.
- **Prisma** is the single data-access layer for the API; SQL never leaves
  `src/services`.

### Backend layout

```
backend/
├── prisma/
│   ├── schema.prisma        # models and the datasource
│   └── migrations/          # checked-in SQL migrations
├── scripts/
│   └── e2e-mvp.mjs          # end-to-end walkthrough against a running API
├── src/
│   ├── config/              # env loading, Prisma client
│   ├── controllers/         # HTTP request/response handling
│   ├── middleware/          # auth guards, error handler, 404 handler
│   ├── routes/              # URL mapping only, no business logic
│   ├── services/            # business rules, transactions, data access
│   ├── utils/               # AppError, response helpers
│   ├── validators/          # Zod schemas, incl. the shared departure window
│   ├── app.js               # Express app assembly
│   └── server.js            # HTTP listener + graceful shutdown
└── tests/                   # Vitest + Supertest
```

Requests flow `route -> controller -> service -> Prisma`. Routers only map URLs
to controllers, controllers translate HTTP into service calls, and services hold
the logic, so each layer stays small and independently testable. Business rules
that more than one endpoint needs live in a shared validator rather than being
re-implemented per route - the departure window rules are in
`src/validators/departureWindow.validator.js` and used by both the pool and the
ride-request schemas.

Two conventions keep the services predictable:

- **Status is never taken from the client.** Transitions go through a named
  service function (`startPool`, `completePool`, `cancelRideRequest`), each of
  which verifies the current status itself and re-derives anything else it needs
  (seats, fare) from the database.
- **Money and identity are never taken from the client either.** The accept call
  takes only a `rideRequestId`; fare and seats come from the ride request, and the
  actor is `req.user.id`. Responses are built by explicit projections, so a new
  sensitive column cannot leak by being added to a `findMany` select.

### API surface

All paths are prefixed with `/api`. "Role" is enforced by `requireRole` after
`authenticate`, so every non-public route needs a valid bearer token of the right
role.

**Public**

| Method | Path                 | Description                       |
| ------ | -------------------- | --------------------------------- |
| `GET`  | `/api/health`        | Liveness probe and API status     |
| `POST` | `/api/auth/register` | Create a passenger or driver      |
| `POST` | `/api/auth/login`    | Exchange credentials for a token  |

**Passenger**

| Method | Path                              | Description                                  |
| ------ | --------------------------------- | -------------------------------------------- |
| `GET`  | `/api/auth/me`                    | Profile of the authenticated user            |
| `POST` | `/api/ride-requests`              | Request a ride for a departure window        |
| `GET`  | `/api/ride-requests`              | Own requests, with the matched pool if any   |
| `GET`  | `/api/ride-requests/:id`          | One own request                              |
| `PATCH`| `/api/ride-requests/:id/cancel`   | Withdraw a request while still `WAITING`     |
| `POST` | `/api/ratings`                    | Rate the driver of a completed ride          |

**Driver**

| Method | Path                              | Description                                    |
| ------ | --------------------------------- | ---------------------------------------------- |
| `POST` | `/api/driver-profile`             | Onboard with the one vehicle you will drive    |
| `GET`  | `/api/driver-profile`             | Own profile, availability and vehicle          |
| `POST` | `/api/availability`               | Set availability explicitly to `ONLINE`/`OFFLINE` |
| `POST` | `/api/pools`                      | Open a pool for a departure window             |
| `GET`  | `/api/pools`                      | Own pools                                      |
| `GET`  | `/api/pools/:poolId`              | One own pool, with members and their requests  |
| `POST` | `/api/pools/:poolId/members`      | Accept a waiting request into this pool        |
| `PATCH`| `/api/pools/:poolId/start`        | Move an `OPEN` pool to `IN_PROGRESS`          |
| `PATCH`| `/api/pools/:poolId/complete`     | Complete the pool and settle each member's fare |
| `GET`  | `/api/ride-requests/available`    | The matching queue of waiting requests         |
| `POST` | `/api/ride-requests/:id/decline`  | Pass on one request                            |
| `POST` | `/api/ratings`                    | Rate a passenger of a completed ride           |

`POST /api/ratings` is listed under both roles on purpose: both parties score
each other, and the service decides the direction from the caller's relationship
to the pool rather than from the route.

```json
{
  "success": true,
  "message": "RoBen RidePool API is running",
  "data": { "uptimeSeconds": 12, "timestamp": "2026-01-01T00:00:00.000Z" }
}
```

Failures always use the same envelope:

```json
{ "success": false, "message": "Route not found: GET /api/unknown" }
```

Validation failures add a `details` array so the UI can show field-level errors:

```json
{
  "success": false,
  "message": "Validation failed",
  "details": [{ "field": "role", "message": "Role must be PASSENGER or DRIVER" }]
}
```

---

## Matching model

The MVP has one idea that everything else hangs off: **a ride is a departure
window, and a pool is a departure window.**

A passenger states the interval they can travel in - `departureFrom` and
`departureTo` - and a driver states the interval they are driving. A driver can
only accept a request when the two intervals overlap, which is the whole
compatibility rule:

```
a.from < b.to  AND  b.from < a.to
```

Both halves are strict, and both windows are half-open, `[from, to)`. That is why
a passenger whose window closes at exactly the moment the driver departs is *not*
a match: the two share a single instant, but there is no time in which the
passenger could still be picked up, and treating that instant as a match would put
a rider in a car that has already gone. Widening either comparison to `<=` would
accept that request, and deliberately is not done.

Consequences worth knowing:

- A contained window overlaps a containing one, and two identical windows overlap
  each other. Both fall out of the two comparisons with no special case.
- Overlap is decided on **instants**, never on wall-clock strings. Both fields
  must be ISO 8601 with an explicit offset (`...+06:00` or `...Z`), because the
  columns are `TIMESTAMP` without time zone; the value stored is the UTC instant.
  A driver and a passenger in different timezones are compared correctly without
  either of them knowing the other's offset.
- There is no duration limit, no booking horizon and no same-day rule, because
  none is documented. Only `departureFrom < departureTo` and a `departureFrom` in
  the future are enforced.
- An incompatible request is refused with **409** at accept time, with a message
  naming the windows. The driver's queue is not pre-filtered, so the full waiting
  list is visible and the verdict is the API's to give.

### Status flow

A ride request moves `WAITING → MATCHED → IN_PROGRESS → COMPLETED`, and may go to
`CANCELLED` from `WAITING` only. Each transition is driven by the pool that
carries the request:

```mermaid
stateDiagram-v2
    [*] --> WAITING: passenger requests
    WAITING --> MATCHED: driver accepts into a pool
    WAITING --> CANCELLED: passenger cancels
    MATCHED --> IN_PROGRESS: pool starts
    IN_PROGRESS --> COMPLETED: pool completes
    COMPLETED --> [*]: both parties may rate
```

Ratings are only possible once the ride is `COMPLETED`, and either party may rate
the other exactly once.

### Accept and decline

A driver matching a ride is `POST /api/pools/:poolId/members` with just a
`rideRequestId`. Seats and fare are read off the ride request by the service, so
a client cannot forge either.

Declining is deliberately **not** a status change. A decline is one driver passing
on one request, so it is recorded as its own row rather than as `CANCELLED` -
cancelling would withdraw the passenger's ride for everybody, and every other
driver would lose it. Consequences:

- The request stays `WAITING` and stays visible to every driver who has not
  declined it.
- One driver declining does not stop another from accepting, and the request can
  still be accepted by the driver who declined it if they change their mind.
- The declining driver no longer sees it in `GET /api/ride-requests/available`.
- Declining twice is a **409**, enforced by a unique constraint on
  `(rideRequestId, driverId)` rather than by a read-then-write check, so two
  concurrent declines cannot both succeed.

### Concurrency

Two operations can touch the same request at the same time, so both claim the row
rather than trusting a prior read:

- **Accept** claims the request first thing in its transaction with a conditional
  `updateMany` on `status: 'WAITING'`. That compiles to one
  `UPDATE ... WHERE id = ? AND status = 'WAITING'`, so PostgreSQL picks the
  winner and two drivers cannot both match the same request.
- **Decline** re-reads the status under `SELECT ... FOR UPDATE` before inserting,
  which is the same row the accepting transaction locks. So a decline can never
  land against a ride that has just been taken.

Capacity is re-aggregated with the transaction client rather than reused from the
pre-flight read, so two accepts racing for the last seat cannot both take it.

---

## Authentication

### Design

Authentication is stateless. The API issues a short-lived JWT and validates it
on every protected request; it stores no session on the server, so the API can
be scaled horizontally without extra work.

```mermaid
flowchart LR
    U[User] -->|POST /api/auth/register| API[Express API]
    U -->|POST /api/auth/login| API
    API --> Zod[Zod validation]
    Z --> S[auth.service]
    S --> B[bcrypt hash]
    S --> P[(PostgreSQL via Prisma)]
    S -->|JWT, 1h expiry| U
    U -->|GET /api/auth/me<br/>Bearer token| API
    API --> AU[authenticate] --> RR[requireRole] --> S
```

| Concern           | Decision                                                                                    |
| ----------------- | ------------------------------------------------------------------------------------------- |
| Password storage  | bcrypt, 10 salt rounds, only the hash is stored in `users.passwordHash`                       |
| Token format      | HS256 JWT, 1 hour expiry, payload is `{ sub, role, iat, exp }`                                 |
| Token transport   | `Authorization: Bearer <token>` header                                                       |
| Token storage     | `localStorage` in the browser (MVP). See the trade-off in `frontend/lib/auth-storage.js`      |
| Validation        | Zod schemas in `src/validators/`, applied by a reusable middleware                             |
| Input handling    | Emails are trimmed and lower-cased before any query, so uniqueness is case-insensitive       |
| Role model        | `Role` Prisma enum: `PASSENGER` or `DRIVER`, fixed at registration                             |

### Role model

`role` is part of the JWT payload, so authorization does not need a database
round trip. Future endpoints attach the existing guard:

```js
// passenger-only
router.post('/rides', authenticate, requireRole('PASSENGER'), createRide);

// driver-only
router.post('/driver/rides/:id/accept', authenticate, requireRole('DRIVER'), acceptRide);
```

- `authenticate` returns **401** when the token is missing, malformed, invalid
  or expired, and attaches `req.user = { id, role }`.
- `requireRole(...)` returns **403** when the role does not match. It must be
  mounted after `authenticate`.

### Endpoints

**POST `/api/auth/register`** - body: `name`, `email`, `password`, `role`

```bash
curl -X POST http://localhost:5000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"name":"Ada Lovelace","email":"ada@example.com","password":"password123","role":"PASSENGER"}'
```

```json
{
  "success": true,
  "message": "Account created successfully",
  "data": {
    "user": { "id": "…", "name": "Ada Lovelace", "email": "ada@example.com", "role": "PASSENGER", "createdAt": "…" },
    "token": "eyJhbGciOiJIUzI1NiIs…"
  }
}
```

Returns **201**, or **400** for invalid input, **409** when the email is taken.

**POST `/api/auth/login`** - body: `email`, `password` → **200** with the same
`{ user, token }` shape, or **401** `Invalid email or password` for both an
unknown email and a wrong password, so the API does not reveal which accounts
exist.

**GET `/api/auth/me`** - header `Authorization: Bearer <token>` → **200** with
the profile, **401** without a valid token.

### Security decisions

- Passwords are hashed with bcrypt; the plaintext is never stored, logged or
  returned. A test asserts the stored value matches `$2[aby]$\d{2}$`.
- The service layer maps the user record to a safe object, so `passwordHash`
  cannot leak even if a future query selects every column.
- Login failures are generic and additionally run a dummy bcrypt comparison, so
  response time does not reveal whether an email exists.
- `JWT_SECRET` is read only from the environment. The API **refuses to start**
  when it is missing, and the placeholder value must be replaced in production.
- Tokens last 1 hour and there is no refresh token yet; the shorter lifetime
  limits the damage from a leaked token.
- Zod strips unknown keys, which prevents a client from setting `passwordHash`
  or `role` through unexpected fields.
- `helmet` headers and the `CORS_ORIGIN` allow-list apply to the auth routes as
  well, since they are mounted on the same app.

**Accepted for the MVP, to revisit before production:** the token lives in
`localStorage` (readable by any script on the origin, so XSS-sensitive). The
next step is an httpOnly, Secure, SameSite cookie plus a CSRF strategy and a
refresh-token flow.

### Frontend

The frontend is a client-rendered Next.js App Router app. The token lives in
`localStorage`, which does not exist during prerender, so session state is
resolved in the browser rather than by middleware - and it is *verified* with
`GET /api/auth/me`, never trusted from the cache. `hooks/use-session.js` holds
one provider for the signed-in area; `Protected` renders children only once the
account is confirmed and redirects a signed-in visitor out of the other role's
pages. That redirect is a convenience, not a security boundary: the API re-checks
every role itself.

**Auth pages**

- `/register` - name, email, password and a Passenger/Driver selector. Shows
  inline field errors, a loading state and a success message.
- `/login` - email and password with the same states.
- `/` - project intro, an API health card and a session card.

**Dashboards** - `/dashboard` sends the account to the page for its role.

| Route                        | Role      | What it does                                                                    |
| ---------------------------- | --------- | ------------------------------------------------------------------------------- |
| `/dashboard/passenger`       | Passenger | Request a ride, follow each request's status, cancel while waiting, rate a finished ride |
| `/dashboard/driver`          | Driver    | Onboard, go online/offline, open a pool for a departure window, list own pools  |
| `/dashboard/driver/rides`    | Driver    | The matching queue: accept a request into a chosen pool, or decline it           |
| `/dashboard/driver/pools/[poolId]` | Driver | One pool: seats, passengers, start/complete, rate a passenger                |

Every visible control calls a real endpoint - there is no placeholder data and no
button that does not do something. States covered across the pages: loading,
empty, error, and success after a write. Field-level validation errors from the
API are shown against their inputs, and messages that have no field are shown
once above the form.

The client shows the *consequence* of a refusal but does not decide it. The queue
displays whether a request fits the selected pool and disables Accept when it
does not, which avoids offering a button the API is going to reject - but the
accept call is made regardless of what the UI believed, and the API's verdict is
what is displayed. Status is never updated optimistically, because the transitions
are the server's to make.

Files:

- `components/ui.js` - shared panel, badge, alert, field, button and score picker
- `components/app-shell.js` - role-aware navigation and sign-out
- `components/auth-form-parts.js` - shared auth form inputs
- `hooks/use-session.js` - session provider, `useSession`, `Protected`
- `hooks/use-auth-form.js` - auth form state (values, field errors, loading)
- `lib/api.js` - the only module that talks to the backend
- `lib/format.js` - paisa, instants, window and status label formatting

`lib/format.js` is presentation only. Paisa are sent as whole numbers and instants
as the ISO strings the API documents; formatting happens on the way to the screen,
never on the way out. The one conversion worth knowing is `toApiInstant`: a
`datetime-local` input yields a naive local string, which the API rejects on
purpose, so it is read as local time and written back as a UTC ISO string with an
explicit `Z`.

### Testing

```bash
cd backend
npm test
```

`vitest.config.js` applies pending migrations to `TEST_DATABASE_URL` before the
suite runs, and `tests/setup/db.js` truncates the tables before every test, so
runs are repeatable and never depend on manually created records. Integration
tests run against a real PostgreSQL, never the development database, so a test
run cannot wipe real data.

Current coverage (417 tests):

| Area                | Examples                                                                                |
| ------------------- | --------------------------------------------------------------------------------------- |
| Registration        | passenger and driver created, duplicate email → 409, invalid role → 400, weak password → 400, malformed email → 400, missing fields → 400 |
| Password handling   | stored value is a bcrypt hash, response body never contains the password                  |
| Email normalization | `  Ada@Example.COM ` is stored and matched as `ada@example.com`                            |
| Login               | valid credentials → 200, wrong password → 401, unknown email → 401, missing password → 400 |
| Protected endpoint   | `/me` with a valid token, without a header, with a malformed header, with a garbage token, with a token signed by another secret, with an expired token |
| Token payload       | contains `sub` and `role`, does not contain the email, expires in exactly 3600 s          |
| Role middleware     | passenger allowed on a passenger route, driver forbidden with 403, unauthenticated → 401, multiple roles allowed |
| Departure windows   | both fields required, ISO with explicit offset, no coercion of a number or naive string, equal and inverted bounds → 400, past start → 400, a 30-day-ahead window is not refused, an offset describing the same instant stores the same UTC value |
| Window compatibility | contained, containing, identical and one-millisecond overlaps accepted; touching boundaries, adjacent and disjoint windows refused; equal instants written with different offsets treated the same; a rejected window leaves the request `WAITING` with no member row |
| Driver queue        | onboarded driver sees waiting requests, not onboarded → 404, passenger → 403, unauthenticated → 401, oldest first, accepted and cancelled requests drop out, a declined request leaves the queue for that driver only, no `passwordHash` or passenger email in the response |
| Decline             | records without touching the request status, never writes `CANCELLED`, another driver can accept afterwards, the same driver can change their mind, several drivers decline independently, repeat → 409, matched and cancelled → 409, missing → 404, malformed id → 400, forged `driverId` in the body ignored |
| Concurrency         | two drivers matching one request: exactly one 201; two declines by one driver: exactly one 201; decline racing an accept: the recorded row always agrees with the response and a matched request never carries a decline that was refused |
| Pool detail         | own pool with window, vehicle and booked seats, members with their requests and passenger names, member status tracked across start and complete, settled fare shown after completion, foreign pool and missing pool both 404 with the same message, malformed id → 400 |
| Driver profile      | 404 before onboarding, profile and vehicle after, reflects the last availability set, no account fields exposed, passenger → 403 |
| Visibility          | a passenger sees `pool: null` while waiting, the matched pool and driver name after acceptance, on both the single and collection endpoints, and cannot read another passenger's request |

### End-to-end walkthrough

`backend/scripts/e2e-mvp.mjs` drives the API over HTTP in the order the UI does,
across three accounts, so the cross-role flows can be checked against a running
server rather than only in unit tests. With the API up:

```bash
cd backend
node scripts/e2e-mvp.mjs
```

It covers registration, onboarding, availability, opening a pool, requesting a
ride, the queue, accept and its races, decline and its races, cancellation rules,
the full pool lifecycle, both rating directions, and the authorization failures
for each. It prints one line per step and exits non-zero if any fail.

### Frontend checks

```bash
cd frontend
npm run lint     # ESLint, standalone
npm run build    # lint, then next build
```

`npm run build` runs the linter first, so an error fails the build.

**Why the linter is part of the build.** A client-side render bug is invisible to
every other gate in this project, and that was demonstrated the hard way: the
passenger dashboard shipped with `useCallback(fn, [user])` in a component that
destructured only `{ token }`. The dependency array is evaluated during render, so
`user is not defined` threw a `ReferenceError` on the first render and blanked the
page for every passenger - while `next build` stayed green, all 417 backend tests
passed, and all 41 end-to-end steps passed, because none of them execute React.

`no-undef` is the rule that catches it, and it is what `npm run lint` runs first.
There is no TypeScript in this project, so nothing else was checking.

| Rule                                | Level   | Why                                                  |
| ----------------------------------- | ------- | ---------------------------------------------------- |
| `no-undef`                          | error   | Catches the crash class above before it ships        |
| `react-hooks/exhaustive-deps`       | warning | A stale closure, the silent version of the same slip |
| `react-hooks/set-state-in-effect`   | warning | The React Compiler's cascade-render advice; every data-loading panel in the app uses the documented `useEffect(() => load(), [load])` shape, so it fires in seven places. Downgraded rather than rewritten - see `eslint.config.mjs` |

`next build` still does the job the linter cannot: it compiles and prerenders
every route, which is what catches import, syntax and client/server boundary
errors.

---

## Getting started

### Option A - Docker (recommended)

```bash
cp .env.example .env    # optional: docker compose works with the defaults
docker compose up
```

| Service    | URL                            |
| ---------- | ------------------------------ |
| Frontend   | http://localhost:3000          |
| Backend    | http://localhost:5000/api/health |
| PostgreSQL | `localhost:5432`               |

The backend waits for the PostgreSQL health check, and the frontend waits for
the backend health check, so the API is already answering when the UI loads.

Useful commands:

```bash
docker compose up -d          # start in the background
docker compose logs -f backend
docker compose down           # stop
docker compose down -v        # stop and delete the database volume
```

The container starts the API but does **not** apply migrations automatically, so
create the tables once per fresh database volume:

```bash
docker compose exec backend npm run prisma:deploy
```

### Option B - Local development

Requires Node.js 20+ and a PostgreSQL 14+ instance.

```bash
cp .env.example .env          # adjust DATABASE_URL if needed
```

**Backend**

```bash
cd backend
npm install
npx prisma generate            # generate the client from prisma/schema.prisma
npm run prisma:deploy          # create the tables from the committed migrations
npm run dev                    # http://localhost:5000
```

**Frontend** (second terminal)

```bash
cd frontend
npm install
npm run dev                    # http://localhost:3000
```

**Tests** - needs a reachable PostgreSQL and `TEST_DATABASE_URL` set:

```bash
cd backend
npm test
```

### Database migrations

Every model is defined by a checked-in migration, so a fresh database needs only
`prisma:deploy` - no history to reconstruct by hand. The checked-in migrations are
`20260928173811_add_user_model` (users and the `Role` enum) and
`20260930080103_add_pool_departure_window_and_request_declines` (the pool window,
request window and `RideRequestDecline`). Apply them, or create a new one when a
model changes:

```bash
cd backend

# Apply what is already committed (used by the test suite and by Docker)
npm run prisma:deploy

# Create a new migration from a schema change
npx prisma migrate dev --name add_cancellation_reason

npx prisma studio                    # browse the data
```

Regenerate the client after any schema change:

```bash
npx prisma generate
```

---

## Environment variables

All configuration comes from environment variables. `.env.example` is the
template; copy it to `.env` and adjust. **Never commit a real `.env`.**

| Variable             | Used by | Default                                        | Purpose                                     |
| -------------------- | ------- | ---------------------------------------------- | ------------------------------------------- |
| `DATABASE_URL`       | backend | `postgresql://postgres:postgres@localhost:5432/robenridepool` | PostgreSQL connection string, read by Prisma |
| `TEST_DATABASE_URL`  | tests   | `postgresql://postgres:postgres@localhost:5432/robenridepool_test` | Database used by `npm test`; tables are truncated on every run |
| `PORT`               | backend | `5000`                                         | HTTP port of the API                        |
| `NODE_ENV`           | both    | `development`                                  | Runtime mode                                |
| `CORS_ORIGIN`        | backend | `http://localhost:3000`                        | Comma-separated list of allowed origins     |
| `JWT_SECRET`         | backend | `change_me`                                    | **Required.** Signs the access tokens; the API refuses to start without it |
| `NEXT_PUBLIC_API_URL`| frontend| `http://localhost:5000`                        | Base URL of the API, inlined in the browser |
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | compose | `postgres` / `postgres` / `robenridepool` | Credentials for the database container      |
| `POSTGRES_PORT` / `BACKEND_PORT` / `FRONTEND_PORT` | compose | `5432` / `5000` / `3000`           | Host port mapping                           |

Notes:

- `NEXT_PUBLIC_*` variables are **embedded in the client bundle at build time**.
  Changing one requires a rebuild, which is why it is also passed as a Docker
  build argument.
- Inside Docker, `DATABASE_URL` points at the `postgres` service hostname
  instead of `localhost`; compose builds it from the `POSTGRES_*` values.
- The Prisma CLI is pinned to the 6.x line so the schema keeps the familiar
  `url = env("DATABASE_URL")` datasource. Backend `overrides` pin
  `deepmerge-ts` to a patched version (transitive Prisma CLI dependency), so
  `npm audit` stays clean.

---

## Current limitations

- No refresh tokens, logout revocation or password reset, so a token is valid
  for its full hour with no way to invalidate it early.
- The token is stored in `localStorage`, which is XSS-sensitive; the plan is an
  httpOnly cookie before production.
- No rate limiting on the auth endpoints, so login can be brute-forced.
- No email verification, and no `ADMIN` role.
- The driver's queue is not filtered by compatibility, so a driver sees requests
  they cannot serve. Accepting one is refused with a message naming the windows,
  and the UI marks the verdict in advance, but the list itself is unfiltered.
- A pool cannot be cancelled and an accepted request cannot be withdrawn: the only
  exit from `MATCHED` is completing the ride.
- The frontend has no component or page tests. ESLint now gates the build, which
  catches undefined identifiers, but nothing exercises a component render, so a
  runtime-only React error would still reach a deployed page.
- No TypeScript, so prop shapes and API payloads are not checked at compile time.
- No CI pipeline and no structured logging.

## Planned features

1. Refresh-token flow with httpOnly cookies, plus logout and password reset.
2. Rate limiting on the auth routes and email verification.
3. Server-side filtering of the driver queue by departure-window compatibility,
   with a reason for anything left visible.
4. Pool cancellation and an accept-time confirmation step.
5. Frontend component tests, a seed script, and a CI pipeline running the backend
   suite, the end-to-end walkthrough and the frontend build.

---

## Project structure

```
RoBenRidePool/
├── frontend/               # Next.js App Router application
│   ├── app/                # routes: auth pages and the role-aware dashboards
│   ├── components/         # shared UI, auth form parts, app shell
│   ├── hooks/              # session provider, auth form state
│   └── lib/                # API client, formatting, token storage
├── backend/                # Express REST API
│   ├── prisma/             # schema and checked-in migrations
│   ├── scripts/            # e2e-mvp.mjs end-to-end walkthrough
│   ├── src/                # routes, controllers, services, validators
│   └── tests/              # Vitest + Supertest
├── docs/                   # Architecture notes and ERD
├── docker-compose.yml
├── .env.example
├── .gitignore
└── README.md
```

See [docs/architecture.md](docs/architecture.md) for the system diagram, the
request flow and the entity-relationship model.
