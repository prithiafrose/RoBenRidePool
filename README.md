# RoBen RidePool

Take-home project for the RoBenDevs Software Engineer Internship.

**RoBen RidePool** is a shared-mobility platform: passengers join an existing
trip instead of booking a whole car alone, and drivers earn more by filling
empty seats on routes they were already driving.

> **Status: authentication milestone (branch `feature/auth`).** The repository
> contains the project foundation plus a complete authentication feature:
> registration, login, JWT-protected profile lookup and role authorization.
> Ride-pooling business logic is not implemented yet.

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
2. A passenger requests a ride with an origin, a destination and a time window.
3. Available drivers are matched to the request and accept or decline it.
4. Both sides can follow the ride status in a role-aware dashboard.
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
| Auth       | JWT + bcrypt (planned)                           |
| Validation | Zod (planned)                                    |
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

- The **frontend** is a Next.js App Router application. It renders pages on the
  server and talks to the backend over plain HTTP/JSON using
  `NEXT_PUBLIC_API_URL`.
- The **backend** is a stateless Express REST API. It owns all business rules
  and is the only process that talks to the database.
- **Prisma** is the single data-access layer for the API; SQL never leaves
  `src/services`.

### Backend layout

```
backend/
├── prisma/
│   └── schema.prisma        # PostgreSQL datasource + migrations
├── src/
│   ├── config/              # env loading, Prisma client
│   ├── controllers/         # HTTP request/response handling
│   ├── middleware/          # centralized error handler, 404 handler
│   ├── routes/              # URL mapping only, no business logic
│   ├── services/            # business logic and data access
│   ├── utils/               # AppError, response helpers
│   ├── app.js               # Express app assembly
│   └── server.js            # HTTP listener + graceful shutdown
└── tests/                   # Vitest + Supertest
```

Requests flow `route -> controller -> service -> Prisma`. Routers only map URLs
to controllers, controllers translate HTTP into service calls, and services hold
the logic, so each layer stays small and independently testable.

### API surface (current)

| Method | Path                 | Auth required | Description                       |
| ------ | -------------------- | ------------- | --------------------------------- |
| `GET`  | `/api/health`        | no            | Liveness probe and API status     |
| `POST` | `/api/auth/register` | no            | Create a passenger or driver      |
| `POST` | `/api/auth/login`    | no            | Exchange credentials for a token  |
| `GET`  | `/api/auth/me`       | Bearer token  | Profile of the authenticated user |

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

### Frontend auth pages

- `/register` - name, email, password and a Passenger/Driver selector. Shows
  inline field errors, a loading state and a success message.
- `/login` - email and password with the same states.
- `/` - a session card that calls `GET /api/auth/me` with the stored token, so
  the protected endpoint is visible in the browser, plus a sign-out button.

`components/auth-form-parts.js` holds the shared inputs, `hooks/use-auth-form.js`
holds the form state (values, field errors, loading, API errors), and
`lib/api.js` is the only module that talks to the backend.

### Testing authentication

```bash
cd backend
npm test
```

`vitest.config.js` applies pending migrations to `TEST_DATABASE_URL` before the
suite runs, and `tests/setup/db.js` truncates the tables before every test, so
runs are repeatable and never depend on manually created records.

Current coverage (36 tests):

| Area                | Examples                                                                                |
| ------------------- | --------------------------------------------------------------------------------------- |
| Registration        | passenger and driver created, duplicate email → 409, invalid role → 400, weak password → 400, malformed email → 400, missing fields → 400 |
| Password handling   | stored value is a bcrypt hash, response body never contains the password                  |
| Email normalization | `  Ada@Example.COM ` is stored and matched as `ada@example.com`                            |
| Login               | valid credentials → 200, wrong password → 401, unknown email → 401, missing password → 400 |
| Protected endpoint   | `/me` with a valid token, without a header, with a malformed header, with a garbage token, with a token signed by another secret, with an expired token |
| Token payload       | contains `sub` and `role`, does not contain the email, expires in exactly 3600 s          |
| Role middleware     | passenger allowed on a passenger route, driver forbidden with 403, unauthenticated → 401, multiple roles allowed |

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
create the `users` table once per fresh database volume:

```bash
docker compose exec backend npx prisma migrate deploy
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
npx prisma migrate deploy      # create the users table from the committed migration
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

The `users` table and the `Role` enum already exist as a checked-in migration
(`prisma/migrations/20260928173811_add_user_model`). Apply the existing
migrations, or create new ones when a model changes:

```bash
cd backend

# Apply what is already committed (used by the test suite and by Docker)
npm run prisma:deploy

# Create a new migration from a schema change
npx prisma migrate dev --name add_ride_model

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
- No ride, driver, vehicle or rating domain models yet.
- The frontend has auth pages but no role-aware dashboard.
- No CI pipeline and no structured logging.

## Planned features

1. Prisma models and migrations: `DriverProfile`, `Vehicle`, `Ride`,
   `RideRequest`, `Rating`.
2. Ride request creation, driver matching, and ride lifecycle endpoints
   (`requested -> accepted -> ongoing -> completed`), all guarded by
   `authenticate` + `requireRole`.
3. Role-aware passenger and driver dashboards.
4. Refresh-token flow with httpOnly cookies, plus logout and password reset.
5. Rate limiting on the auth routes and email verification.
6. Frontend component tests, a seed script, and a CI pipeline running lint,
   tests and builds.

---

## Project structure

```
RoBenRidePool/
├── frontend/               # Next.js App Router application
├── backend/                # Express REST API
├── docs/                   # Architecture notes and future ERD
├── docker-compose.yml
├── .env.example
├── .gitignore
└── README.md
```

See [docs/architecture.md](docs/architecture.md) for the system diagram and the
planned entity-relationship model.
