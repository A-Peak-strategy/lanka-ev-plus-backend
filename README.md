## EV Central System Backend

Node.js backend for an EV charging **Central System** with REST APIs, OCPP 1.6 WebSocket server, wallet & billing, booking, and settlement logic. This document explains how to install, configure, and run the application in development and basic production environments.

---

## Features

- **HTTP API** under `/api` for chargers, wallet, bookings, and admin operations.
- **OCPP 1.6 WebSocket server** for communicating with charge points (`ws://host:PORT/`).
- **MySQL + Prisma** data layer with migrations and seeding.
- **Wallet & ledger** with settlement and background workers (BullMQ + Redis).
- **Firebase Authentication** integration for user identity (optional but recommended).
- **Health endpoints** at `/health` and `/health/detailed`.

---

## Prerequisites

- **Node.js**: v18 or newer recommended.
- **npm**: comes with Node.js.
- **MySQL**: 8.x (or compatible) instance.
- **Redis** (optional but recommended):
  - Required for background workers (grace period, booking, settlement queues).
  - If Redis is not available, the app will still start but workers will be disabled.
- **Firebase project** (optional but recommended) if you want:
  - Authentication using Firebase ID tokens.
  - Push notifications using Firebase Cloud Messaging.

---

## Project Structure (high level)

- `src/server.js` – main entrypoint, HTTP + OCPP server and workers.
- `src/app.js` – Express app (routes, middleware, health checks).
- `src/api` – route handlers and controllers.
- `src/ocpp` – OCPP server, handlers, and message logging.
- `src/services` – domain services (billing, wallet, booking, settlement, etc.).
- `prisma/schema.prisma` – database schema.
- `prisma/migrations` – Prisma migrations.
- `prisma/seed.js` – database seed script.
- `scripts/*.js` – helper scripts (Firebase users, credentials viewer).
- `SEED_README.md` – detailed database seeding guide.

---

## 1. Clone and Install Dependencies

From your terminal (PowerShell on Windows is fine):

```bash
git clone <your-repo-url>
cd Backend
npm install
```

If this project was provided to you as a zip, simply extract it and run `npm install` in the extracted folder.

---

## 2. Environment Configuration

Create a `.env` file in the project root (same folder as `package.json`). At minimum you need the database URL; other variables are optional but recommended.

### 2.1 Required

- **`DATABASE_URL`** – used by Prisma to connect to MySQL.

Example:

```env
DATABASE_URL="mysql://user:password@localhost:3306/ev_central_system"
```

### 2.2 Recommended / Optional

- **`PORT`** – HTTP server port (default: `7070`).
- **`REDIS_URL`** – Redis connection string (default: `redis://localhost:6379`).
- **`CORS_ORIGIN`** – allowed CORS origin for the API (default: `*`).
- **`NODE_ENV`** – `development`, `test`, or `production` (controls logging and error details).

### 2.3 Firebase Configuration (Optional but Recommended)

You can configure Firebase either via a single JSON env variable or via individual fields.

**Option A – Single JSON variable**

```env
FIREBASE_SERVICE_ACCOUNT_JSON='{
  "projectId": "your-project-id",
  "clientEmail": "firebase-adminsdk@your-project-id.iam.gserviceaccount.com",
  "privateKey": "-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
}'
```

**Option B – Individual variables**

```env
FIREBASE_PROJECT_ID="your-project-id"
FIREBASE_CLIENT_EMAIL="firebase-adminsdk@your-project-id.iam.gserviceaccount.com"
# NOTE: keep line breaks escaped as \n
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
```

If Firebase is not configured, the server will still start; Firebase-dependent features (notifications, some auth flows) will be disabled and a warning will be logged.

---

## 3. Database Setup (MySQL + Prisma)

1. **Create the database** in MySQL (e.g. `ev_central_system`) and ensure `DATABASE_URL` points to it.
2. **Run Prisma migrations** to create tables:

```bash
npm run db:migrate
```

This uses `prisma migrate dev` under the hood and applies migrations in `prisma/migrations`.

### 3.1 Generate Prisma Client (if needed)

Normally this is handled automatically by `prisma` when running migrations, but you can regenerate explicitly:

```bash
npm run db:generate
```

---

## 4. Seeding Data (Optional but Recommended)

To populate the database with sample users, stations, chargers, pricing, and wallets:

```bash
npm run db:seed
```

This will:

- Create an admin, multiple station owners, and consumer users.
- Create stations, chargers, connectors, pricing plans, wallets, and related records.
- Generate `SEED_CREDENTIALS.json` with login details (gitignored).

To view the generated credentials:

```bash
npm run db:credentials
```

For **creating matching Firebase users** from the seed data (requires Firebase configured in `.env`):

```bash
npm run db:seed:firebase
```

For a **detailed** explanation of the seed data, roles, and example credentials, see `SEED_README.md`.

---

## 5. Running the Application

### 5.1 Development Mode

Uses `nodemon` to autorestart on file changes:

```bash
npm run dev
```

By default, the server will:

- Listen on `http://localhost:7070` (or `PORT` from `.env`).
- Expose:
  - **HTTP API** at `http://localhost:PORT/api`
  - **OCPP WebSocket** at `ws://localhost:PORT/`
  - **Health check** at `http://localhost:PORT/health`
  - **Detailed health** at `http://localhost:PORT/health/detailed`
- Attempt to:
  - Initialize Firebase (if configured).
  - Check Redis availability and, if available, start background workers (grace period, booking, settlement) automatically.

### 5.2 Production Mode

Build step is not needed; this is a pure Node.js app. Simply run:

```bash
npm start
```

Ensure:

- `NODE_ENV=production`
- Correct `DATABASE_URL`, `REDIS_URL`, and Firebase env vars are set.

You may want to run `npm start` under a process manager like PM2, systemd, or a container orchestration system.

---

## 6. Background Workers and Redis

Background jobs (grace period handling, booking expiration, settlements) use **BullMQ** and **Redis**:

- On server start, `src/server.js` calls a Redis availability check.
- If `REDIS_URL` is reachable, workers are started automatically from within the main process.
- If Redis is not reachable, the API and OCPP server still work, but background features are disabled (a warning is printed to the console).

There are also helper npm scripts if you ever want to run workers as separate processes:

- `npm run worker` – starts the grace period worker.
- `npm run worker:booking` – starts the booking worker.
- `npm run worker:all` – starts both workers in a single Node process.

These are optional; in the default setup the main server already starts workers when Redis is available.

---

## 7. Testing

The project uses **Jest** for unit and integration tests.

- **Run all tests:**

```bash
npm test
```

- **Watch mode:**

```bash
npm run test:watch
```

- **Coverage report:**

```bash
npm run test:coverage
```

The test setup uses its own `DATABASE_URL` and `REDIS_URL` (see `tests/setup.js`). Ensure the test MySQL and Redis instances are available if you want to run the full suite.

---

## 8. APIs and OCPP Endpoints (Quick Reference)

- **HTTP API base**: `http://localhost:PORT/api`
  - Chargers: `GET /api/chargers`, `POST /api/chargers`, etc.
  - Wallet: `GET /api/wallet/...`, `POST /api/wallet/top-up`, etc.
  - Bookings: `GET /api/bookings`, `POST /api/bookings`, etc.
  - Admin: various endpoints under `/api` (see `src/api/admin.routes.js`).
- **Health checks**:
  - `GET /health`
  - `GET /health/detailed`
- **OCPP WebSocket**:
  - URL: `ws://localhost:PORT/`
  - Used by charge points to connect to the Central System.

For precise request/response shapes, refer to the controllers and services in `src/api` and `src/services`.

---

## 9. Common Troubleshooting Tips

- **Server starts but workers are disabled**
  - Ensure Redis is running and `REDIS_URL` points to it.
  - Check console logs for Redis connection warnings.
- **Database connection errors**
  - Verify `DATABASE_URL` (user/password, host, port, database).
  - Confirm the database exists and the user has the necessary privileges.
- **Prisma migration issues**
  - Try `npm run db:reset` (warning: this will reset data) then `npm run db:migrate`.
- **Firebase errors / Authentication not working**
  - Confirm your service account env variables are set correctly.
  - Make sure private key newlines are escaped (`\n`) in `.env`.
  - Check that users exist in Firebase with UIDs matching your database (especially if using seeded data).

---

## 10. Useful npm Scripts (Summary)

- **App lifecycle**
  - `npm run dev` – start server with automatic reload (development).
  - `npm start` – start server (production/normal run).
- **Database & Prisma**
  - `npm run db:migrate` – apply migrations.
  - `npm run db:push` – push schema directly (development only).
  - `npm run db:generate` – regenerate Prisma Client.
  - `npm run db:seed` – seed database with demo data.
  - `npm run db:seed:firebase` – create Firebase users from seed data.
  - `npm run db:credentials` – view seeded user credentials.
  - `npm run db:reset` – reset database using Prisma migrate.
- **Workers**
  - `npm run worker` – grace worker only.
  - `npm run worker:booking` – booking worker only.
  - `npm run worker:all` – both workers in one process.
- **Testing**
  - `npm test` – run tests.
  - `npm run test:watch` – watch mode.
  - `npm run test:coverage` – coverage report.


