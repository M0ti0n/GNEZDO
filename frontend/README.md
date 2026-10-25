# GNEZDO — nesting web app

`frontend/` — React + TypeScript (Vite). Home page shell:

- **Top bar** (green) — GNEZDO icon + name opens the app menu (Settings, Technology table,
  Stock & remnants, Projects); tabs for Home, jobs, imports and projects; user name on the right.
- **Tools strip** — tools change with the active tab (`src/shell/ToolStrip.tsx`).
  Tools not built yet are shown disabled.
- **Left drawer** — rail with *Parts* and *Jobs*.
  *Imported parts*: the list updates only when you press **Search** (or Enter); the Search
  button gets a yellow ring when filters changed since the last search. Always visible: name;
  material + thickness (thickness list follows the material); project; created and modified
  date, each with a tick box and three pictogram buttons (up to / on / from this date).
  Under **More filters**: description, size X and Y (tick box + min–max mm, bounding box),
  engraved. Text fields and lists are ignored when empty; dates and sizes only count when
  ticked (typing a value ticks the box, unticking keeps the value).
  Results as **grid** (thumbnails) or **list** (full name, project, material, size, quantity,
  engraved); the choice is remembered per browser.
  Select parts (click), drag them into the open job tab or press "Add to job".
  *Job search*: filter by text, status and date; click a job to open it.
- **Job tab** — part list grouped by material and thickness; drop target for parts; edit
  quantities, remove parts. (Nesting, processing and report come next.)
- **Home** — tiles: Import, New job, Job search; three lists: Recent imports,
  Recent jobs, Recent projects (click a job or project to open its tab).

## Run

```bash
cd frontend
npm install
npm run dev          # http://localhost:5173
npm run build        # type-check + production build into dist/
```

The app runs on sample data (`src/api/api.ts`). When the ASP.NET Core API exists,
create `frontend/.env.local` with `VITE_USE_API=true`; `/api` is proxied to
`http://localhost:5080` in development. Endpoints the home page expects:

| Endpoint | Returns |
|---|---|
| `GET /api/jobs/recent?take=8` | `JobSummary[]` |
| `GET /api/imports/recent?take=8` | `ImportSummary[]` |
| `GET /api/projects/recent?take=8` | `ProjectSummary[]` |
| `GET /api/parts?name=&material=&thicknessMm=&project=&description=&created=on:2026-10-24&modified=upTo:2026-10-24&xMin=&xMax=&yMin=&yMax=&engraved=true` | `PartSummary[]` (empty fields are left out) |
| `GET /api/parts/facets` | materials and thicknesses for the filter lists |
| `GET /api/jobs?text=&status=&days=` | `JobSummary[]` |
| `GET /api/jobs/{id}/parts` | `JobPart[]` |
| `GET /api/imports` | `ImportSummary[]` |

Types are in `src/api/types.ts`.

## Icon

`public/gnezdo.svg` is the app icon (favicon, and `components/GnezdoIcon.tsx` in the tab bar);
`public/gnezdo-icon-original.svg` is the file as supplied.

## Fonts

Barlow / Barlow Semi Condensed load from Google Fonts. If the shop PCs have no
internet, download the font files into `frontend/public/fonts/` and replace the
`<link>` in `index.html` with `@font-face` rules.

## Files

```
src/
  App.tsx              tabs + sidebar + page switching
  styles.css           design tokens and all styles
  state/tabs.ts        open-tabs reducer
  shell/               TabBar (app menu, tabs, user), ToolStrip, Drawer (parts / job search)
  pages/HomePage.tsx   tiles and recent lists
  pages/JobPage.tsx    job part list, drop target
  pages/PlaceholderPage.tsx
  components/          Tile, Icons (own SVG set), format helpers
  api/                 types + sample-data client; sampleParts.ts = the 30 test parts
```
