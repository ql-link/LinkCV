# LinkCV

LinkCV is a frontend/backend separated Monorepo for editing and exporting resumes.

## Repository layout

```text
apps/web       React, TypeScript, and Vite
apps/backend   Python 3.11+, FastAPI, SQLAlchemy, and Alembic
deploy         Local infrastructure plus Dev/Production Jenkins and Compose deployment
docs           Long-lived architecture, API, module, and operations knowledge
```

The Web and backend projects install and build independently. Root commands coordinate the two applications and local infrastructure.

## Local setup

Requirements:

- Node.js 22 LTS and npm 10+
- uv
- Docker with Docker Compose

Create local configuration and install dependencies:

```bash
cp .env.example .env
npm ci
npm run sync
```

Start MySQL 8.4 and MinIO, then use one command to start both Web and FastAPI locally:

```bash
npm run infra:up
npm run dev:local
```

To start the same Web and FastAPI processes against the shared development configuration, create `.env.development.local` with the required private values, then run:

```bash
npm run dev:development
```

Both commands start the Web application at `http://127.0.0.1:5173` and FastAPI at `http://127.0.0.1:8000`. API documentation is available at `http://127.0.0.1:8000/api/docs` and the MinIO console at `http://127.0.0.1:9001` when local infrastructure is running.

The Vite server proxies every relative `/api` request to FastAPI. Authentication uses a seven-day JWT in an HttpOnly cookie; resumes are stored in MySQL and private images in MinIO. Prototype SQLite data is intentionally not imported.

Run all checks with `npm run check`. `npm run build` builds both the Vite frontend and the installable Python backend package.

Current architecture and module contracts are indexed in [`docs/README.md`](docs/README.md).
