# LinkCV

LinkCV is being migrated from a React + Express prototype to a frontend/backend separated Monorepo.

## Repository layout

```text
apps/web       React, TypeScript, and Vite
apps/backend   Python 3.13 and FastAPI
server         Temporary legacy Express API
deploy         Local dependencies and transitional deployment files
```

The Web and FastAPI projects install and run independently. The root package only coordinates development commands and retains the temporary Express dependencies until all existing APIs have moved.

## Local setup

Requirements:

- Node.js 22 LTS
- npm 10 or newer
- uv
- Docker with Docker Compose

Create local configuration and install dependencies:

```bash
cp .env.example .env
npm ci
npm run sync
```

Start MySQL 8.4 and MinIO:

```bash
npm run infra:up
```

Start Web, FastAPI, and the temporary Express API together:

```bash
npm run dev
```

If port 8000 is already in use, select another backend port for both FastAPI and the Vite proxy:

```bash
BACKEND_PORT=8010 npm run dev
```

Default addresses:

- Web: `http://127.0.0.1:5173`
- FastAPI: `http://127.0.0.1:8000`
- FastAPI docs: `http://127.0.0.1:8000/api/docs`
- Legacy Express API: `http://127.0.0.1:4174`
- MinIO console: `http://127.0.0.1:9001`

Run all current checks:

```bash
npm run check
```

`npm run build` builds both the Vite frontend and the installable Python backend package.

## Transitional API routing

During the migration, Vite routes `/api/health` to FastAPI. Existing `/api/auth`, `/api/resumes`, and `/api/assets` requests continue to use Express. This preserves the current prototype while providing a real Web-to-FastAPI integration path.

Move a route prefix to FastAPI only after its implementation and regression tests are complete. Authentication and resume CRUD need a coordinated cutover because the legacy implementation uses SQLite sessions while the target uses a JWT cookie.

The removal order is:

1. Add the SQLAlchemy, MySQL, and Alembic foundation.
2. Migrate authentication and resume CRUD as a coordinated slice.
3. Migrate MinIO asset APIs and permission checks.
4. Route all `/api` traffic to FastAPI and run end-to-end verification.
5. Remove `server`, SQLite dependencies, and the legacy deployment topology.

Prototype SQLite data is not migrated to MySQL.
