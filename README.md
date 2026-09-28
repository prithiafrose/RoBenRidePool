# RoBen RidePool

Take-home project for the RoBenDevs Software Engineer Internship.

**RoBen RidePool** is a shared-mobility platform: passengers join an existing
trip instead of booking a whole car alone, and drivers earn more by filling
empty seats on routes they were already driving.

> **Status: initial project setup.** This repository currently contains the
> foundation only - monorepo layout, working frontend and backend, PostgreSQL
> connection through Prisma, and Docker tooling. No ride-pooling business logic
> has been implemented yet.

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

| Method | Path          | Description                    |
| ------ | ------------- | ------------------------------ |
| `GET`  | `/api/health` | Liveness probe and API status  |

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
npm run dev                    # http://localhost:5000
```

**Frontend** (second terminal)

```bash
cd frontend
npm install
npm run dev                    # http://localhost:3000
```

**Tests**

```bash
cd backend
npm test
```

### Database migrations

The schema is intentionally empty for now. When the first models are added:

```bash
cd backend
npx prisma migrate dev --name init   # create and apply a migration
npx prisma studio                    # browse the data
```

---

## Environment variables

All configuration comes from environment variables. `.env.example` is the
template; copy it to `.env` and adjust. **Never commit a real `.env`.**

| Variable             | Used by | Default                                        | Purpose                                     |
| -------------------- | ------- | ---------------------------------------------- | ------------------------------------------- |
| `DATABASE_URL`       | backend | `postgresql://postgres:postgres@localhost:5432/robenridepool` | PostgreSQL connection string, read by Prisma |
| `PORT`               | backend | `5000`                                         | HTTP port of the API                        |
| `NODE_ENV`           | both    | `development`                                  | Runtime mode                                |
| `CORS_ORIGIN`        | backend | `http://localhost:3000`                        | Comma-separated list of allowed origins     |
| `JWT_SECRET`         | backend | `change_me`                                    | Signing secret for future JWT auth          |
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

- No authentication, authorization or user accounts yet.
- No ride, driver, vehicle or rating domain models; the Prisma schema only
  declares the PostgreSQL connection.
- No request validation layer (Zod) and no migration history.
- Test coverage is limited to the health endpoint and the 404 handler.
- No CI pipeline, no structured logging, no rate limiting.
- The frontend landing page is a placeholder dashboard shell.

## Planned features

1. Prisma models and first migration: `User`, `DriverProfile`, `Vehicle`,
   `Ride`, `RideRequest`, `Rating`.
2. JWT authentication with `bcrypt` password hashing and role-based access.
3. Zod validation middleware on every mutating endpoint.
4. Ride request creation, driver matching, and ride lifecycle endpoints
   (`requested -> accepted -> ongoing -> completed`).
5. Passenger and driver dashboards, live ride status.
6. Expanded Vitest + Supertest coverage and frontend component tests.
7. Seed script and CI pipeline running lint, tests and builds.

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
