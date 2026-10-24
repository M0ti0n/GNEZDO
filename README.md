# GNEZDO

Laser nesting software for BO-DA d.o.o.: a web app on the work server that replaces Libellula CUT.
Users work in the browser; parts, jobs and nests live in SQL Server.

| Folder | What | Language |
|---|---|---|
| `frontend/` | Screens: home, tabs, imported parts panel, job part list | TypeScript + React (Vite) |
| `backend/` | Web server and database: parts, imports, projects, jobs | C# / .NET 10, SQL Server |

Planned: DXF/DWG import worker (Python, ezdxf), nesting with PackingSolver (C++), postprocessor.

## Run on the server (Docker)

```bash
cp .env.example .env     # set GNEZDO_DB to a new, empty database
docker compose up -d --build
# or, to try it with its own SQL Server and sample data:
#   set GNEZDO_DB to the "db" line and GNEZDO_SAMPLE_DATA=true in .env, then
docker compose --profile sqlserver up -d --build
```

Open `http://<server>:8080`. The API creates its tables on first start.

## Develop

```bash
# backend (needs .NET 10 SDK and a SQL Server; Development seeds sample data)
cd backend/src/Gnezdo.Api
dotnet run                       # http://localhost:5080
# connection string: appsettings.json, or env ConnectionStrings__Gnezdo

# frontend
cd frontend
npm install
npm run dev                      # http://localhost:5173, sample data built in
echo "VITE_USE_API=true" > .env.local   # use the backend instead (proxied to :5080)
```

Tests: `dotnet test backend/Gnezdo.slnx` with `GNEZDO_TEST_SQL` set to a SQL Server
connection string without a database name; every run uses and drops its own database.
GitHub Actions runs the frontend type-check/build, the backend tests on SQL Server, and
the Docker builds on every push.

## API (so far)

| Endpoint | Returns |
|---|---|
| `GET /api/parts?name=&material=&thicknessMm=&project=&description=&created=on:2026-10-24&modified=upTo:2026-10-24&xMin=&xMax=&yMin=&yMax=&engraved=true` | parts, newest change first (max 500) |
| `GET /api/parts/facets` | materials and thicknesses for the filter lists |
| `GET /api/imports/recent`, `GET /api/imports` | import batches |
| `GET /api/jobs/recent`, `GET /api/jobs?text=&status=&days=` | job summaries |
| `GET /api/jobs/{id}/parts` | parts in a job with quantities |
| `GET /api/projects/recent` | projects by last activity |
| `GET /api/health` | `{ "status": "ok" }` |

Date filters: `on:` that calendar day, `upTo:` up to and including that day, `from:` from that
day on; days are shop days (Europe/Ljubljana).
