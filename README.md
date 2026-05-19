# FuelTracker

Offline-first fuel & energy tracker for ICE, HEV, PHEV and EV vehicles. Built as an installable iOS-style PWA: zero backend, all data lives in the browser (IndexedDB), and you back up to wherever you want (iCloud Drive, Dropbox, Google Drive, etc.) by sharing or downloading the export files.

## What it does

- **Multi-vehicle tracking** — log fuel-ups for as many vehicles as you want,   switch between them on the Dashboard / Records screens.
- **Per-vehicle-type forms** — ICE and HEV get the gas form (liters / €-per-l / total, with 2-of-3 auto-derivation), PHEV adds an optional electricity section, EV gets a pure charging form (kWh + €/kWh, total computed).
- **Cost-equivalent km/l for PHEVs** — converts your real fuel + electricity spend into the equivalent number of liters you'd have bought at the current pump price, so you can compare PHEV to ICE on a fair money basis.
- **iOS-aligned look** — SF system font, iOS systemGreen palette, sentence-case labels, Auto/Light/Dark theme picker. Status bar tint matches.
- **Offline / installable** — runs without network once installed; "Add to Home Screen" on iOS Safari gives you an app icon.
- **Manual backups** — Settings → Back up now exports two files (CSV + JSON). No automatic cloud sync.
- **Consistency warnings on entry** — soft checks for abnormal consumption, suspicious unit prices, oversized odometer jumps, out-of-order dates, and duplicates with thresholds tunable in Settings.

## Quick start

```bash
npm install
npm run dev          # http://localhost:5173
npm test             # vitest
npm run build        # outputs to dist/
```

To enable the service worker for offline-install testing, set
`ENABLE_PWA=1 npm run build`. The default build keeps the SW off because a
stale SW cache on iOS Safari is genuinely painful to debug.

### Deploying

The project is set up for GitHub Pages via `.github/workflows/deploy.yml`, which publishes on push to `main`. Set `BASE_URL=/<repo>/` in the workflow if you're deploying under a project page (`https://<user>.github.io/<repo>/`); for a user/org root page (`https://<user>.github.io/`), leave it as `/` or omit.

For iOS Safari to register the service worker and offer the proper "Add to Home Screen" PWA prompt, the site **must** be served over HTTPS (GitHub Pages serves over HTTPS by default).

## Vehicle types & calculation rules

| Type           | Form fields                                                   | Electricity column on Dashboard | Equivalent km/l      |
| -------------- | ------------------------------------------------------------- | ------------------------------- | -------------------- |
| `ice`          | gas (l, €/l, total)                                           | hidden                          | = gas km/l           |
| `hybrid` (HEV) | gas (l, €/l, total)                                           | hidden                          | = gas km/l           |
| `phev`         | gas + optional kWh/100 km & €/kWh since previous full fuel-up | shown                           | computed (see below) |
| `ev`           | kWh charged + €/kWh                                           | shown (only column)             | hidden               |

### Equivalent km/l (PHEV)

For each full-to-full interval:

```
gasCost          = Σ entry.totalCost          (over interval, gas only)
electricityCost  = (closing.phevKwhPer100Km / 100) × distanceKm × closing.phevKwhPrice
totalCost        = gasCost + electricityCost
equivLiters      = totalCost / closing.gasPricePerLiter
equivalentKmPerL = distanceKm / equivLiters
```

**Average and best are computed over valid intervals**, not over aggregates:

- `avgEquivalentKmPerL` uses the **average pump price ÷ average cost per km**
  formula:

  ```
  totalGasCost      = Σ interval.gasCost          (over valid intervals)
  totalGasQuantity  = Σ interval.gasLitersUsed
  totalOverallCost  = Σ interval.totalCost
  totalKm           = Σ interval.distanceKm

  avgPumpPrice      = totalGasCost     / totalGasQuantity
  costPerKm         = totalOverallCost / totalKm
  avgEquivalentKmPerL = avgPumpPrice / costPerKm
  ```

  Read it as: "across the driving you have a real consumption reading for,
  you spent X €/km on energy overall; converted back to gas at the average
  pump price you paid (Y €/l), that's X⁻¹ × Y km per equivalent litre."
  Partials get rolled into their closing interval and so contribute their
  gas and cost to the totals; intervals containing a missed flag are
  excluded entirely. For ICE/HEV the formula reduces to the standard
  `totalKm / totalGasQuantity` gas km/l identity.

- `bestEquivalentKmPerL` is the highest *per-interval* value, with its
  date. Each interval's equivalent uses its own closing pump price, so the
  "best" matches whichever dot is highest on the chart.

The same per-interval philosophy applies to gas km/l and kWh/100 km, which
use the standard distance- and energy-weighted formulas respectively.

### Partials fills

A fuel-up marked `partial: true` doesn't close an interval — its liters and
cost roll into the next full (non-partial) fuel-up's interval. So a sequence
like `full → partial → partial → full` produces **one** interval spanning all
four entries, with liters and cost summed.

## Backup format

"Back up now" produces **two files** alongside each other:

### `fueltracker-entries-YYYY-MM-DD.csv` — the fuel-ups

A plain, Excel-compatible table. One row per fuel-up. Header row:

```
date,vehicle,vehicleId,odometer,gasLiters,gasPricePerLiter,kWhCharged,kWhPrice,totalCost,partial,missed,phevKwhPer100Km,phevKwhPrice,notes,id
```

| Column             | Type             | Notes                                                                                                                                                                                                        |
| ------------------ | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `date`             | ISO 8601 string  | e.g. `2026-05-11T10:30:00.000Z`                                                                                                                                                                              |
| `vehicle`          | string           | denormalized vehicle name for human reading; matched by `vehicleId` first                                                                                                                                    |
| `vehicleId`        | string           | uid; primary join key                                                                                                                                                                                        |
| `odometer`         | integer          | km                                                                                                                                                                                                           |
| `gasLiters`        | decimal or empty | litres of gas added — populated for ICE / HEV / PHEV                                                                                                                                                         |
| `gasPricePerLiter` | decimal or empty | €/l (or $/l, £/l — whatever the chosen currency is)                                                                                                                                                          |
| `kWhCharged`       | decimal or empty | kWh added at this charging event — populated for EV                                                                                                                                                          |
| `kWhPrice`         | decimal or empty | €/kWh paid for that charge                                                                                                                                                                                   |
| `totalCost`        | decimal or empty | total paid for this entry's purchase                                                                                                                                                                         |
| `partial`          | `true` / `false` | partial fill / partial charge — accumulates into the next full entry's interval                                                                                                                              |
| `missed`           | `true` / `false` | a fuel-up between the previous entry and this one wasn't logged — interval is excluded from stats                                                                                                            |
| `phevKwhPer100Km`  | decimal or empty | PHEV-only: average kWh/100 km observed over the interval ending at this entry, read from the trip computer at the previous full fuel-up. Set only on full fuel-ups; values on partials are ignored by stats. |
| `phevKwhPrice`     | decimal or empty | PHEV-only: €/kWh paid for that electricity                                                                                                                                                                   |
| `notes`            | string           | newlines flattened to spaces on export to keep one row per fuel-up                                                                                                                                           |
| `id`               | string           | uid; empty cells get a fresh id on import (so you can add rows in Excel)                                                                                                                                     |

CSV quirks: standard RFC-style quoting. Commas/quotes/newlines in `notes` are
escaped (`"He said ""hi"", really"`). Booleans accept `true`/`false`/`1`/`yes`
case-insensitively on import.

### `fueltracker-config-YYYY-MM-DD.json` — vehicles + settings

```json
{
  "schemaVersion": 1,
  "exportedAt": "2026-05-11T10:30:00.000Z",
  "vehicles": [
    {
      "id": "abc123",
      "name": "Audi A3 TFSIe",
      "type": "phev",
      "defaultElectricityCost": 0.32,
      "createdAt": "2026-01-01T00:00:00.000Z"
    }
  ],
  "settings": {
    "id": "global",
    "consumptionUnit": "km/l",
    "currency": "EUR",
    "defaultElectricityCost": 0.25,
    "backupCadence": "weekly",
    "themeMode": "auto",
    "schemaVersion": 1,
    "lastBackupAt": null,
    "lastBackupHash": null
  }
}
```

The `lastBackupAt` and `lastBackupHash` fields are scrubbed on export — they're
per-device bookkeeping and shouldn't follow the data to another machine.

### Import behavior

Settings → "Import file" auto-detects by extension:

- **`.csv`** restores fuel-ups. The importer matches each row to a vehicle by
  `vehicleId` first; if that fails, by `vehicle` name; if both fail, it
  auto-creates a stub vehicle of type `ice` so the entries link to something.
  You can re-classify it from the Vehicles screen afterward.
- **`.json`** restores vehicles and settings. Backup-tracking fields are
  preserved from the existing device.

Both formats prompt for **Merge** (upsert by id) or **Replace** (wipe table
first, then insert). Replace requires typing `DELETE` as a sanity check.

### Round-tripping through Excel

You can open `fueltracker-entries-*.csv` directly in Excel, Numbers, or Google
Sheets. Add a row, edit values, save back as CSV, then re-import. Things to
keep in mind:

- Leave `id` empty for new rows — the importer will mint a fresh id.
- `vehicleId` is opaque — fill in `vehicle` (the name column) and the importer
  will resolve it.
- Date column should be ISO 8601. If Excel auto-converts dates to its own
  format, set the column to text before pasting, or use Numbers / Sheets which
  are less aggressive about coercion.

## Project layout

```
index.html             gated bootstrap: error capture + SW/cache cleanup runs
                       BEFORE the entry module is injected, so a stale service
                       worker can't intercept the fetch and serve the wrong
                       content (which iOS Safari masks as "Script error")

src/
  App.tsx              orchestrator: settings, banner, SW update prompt,
                       ErrorBoundary around each tab
  main.tsx             bootstrap: init settings → apply theme → render under
                       a top-level ErrorBoundary
  db/
    db.ts              Dexie schema, initializeSettings,
                       getSettings
    types.ts           FuelUp / Vehicle / Settings, VehicleType, RecordField  lib/
    derive.ts          2-of-3 reconciliation for amount/unitPrice/totalCost
    stats.ts           computeIntervals, computeDashboard, sortFuelUps
    format.ts          fmtNumber, fmtMoney, fmtDate, currencySymbol
    units.ts           consumption-unit conversions (km/l ↔ L/100km ↔ mpg)
    theme.ts           applyThemeFromSettings, watchSystemTheme
    storage.ts         safeGet/safeSet/safeRemove wrappers around localStorage
    records-fields.ts  RECORD_FIELDS catalog + per-vehicle-type allowed sets;
                       drives the configurable Records-row display
    checks.ts          consistency warnings (consumption / unit price /
                       distance / date order / duplicate) for AddEntry
    backup/
      index.ts         BackupPayload, exportBackup, importFile, payloadHash
      csv.ts           CSV serialisation, schema-v1-legacy import shim
      json.ts          JSON config serialisation    backup/
      index.ts         BackupPayload, exportBackup, importFile, payloadHash
      csv.ts           CSV serialisation, schema-v1-legacy import shim
      json.ts          JSON config serialisation
  components/
    LineChart.tsx      custom dual-axis SVG chart with pan/pinch/wheel zoom,
                       toggleable series, viewport-based filtering
    TabBar.tsx         5-tab nav with the centre + pill; stroke-matched SVG
                       icons (gauge / list / + / car / gear)
    KpiCard.tsx        top-row stats
    BackupBanner.tsx   "back up now" prompt when cadence is overdue
    ErrorBoundary.tsx  in-tree React error boundary; surfaces stack + message
                       inline so a screen crash doesn't blank the app
    Modal.tsx, VehicleSelect.tsx, InstallPrompt.tsx
  screens/
    Dashboard.tsx      KPIs + vehicle-type-aware consumption matrix + chart;
                       scale presets + custom date range
    AddEntry.tsx       vehicle-type-aware form, vehicle-default €/kWh,
                       partial/missed toggles, Cancel button
    Records.tsx        chronological list with newest/oldest sort toggle
    Vehicles.tsx       CRUD vehicles; defaultElectricityCost only for PHEV/EV
    Settings.tsx       theme / currency / backup / import-export
  styles.css           SF font stack, iOS systemGreen palette, light/dark vars
```

## Testing

```bash
npm test          # 52 tests across src/lib/**/*.test.ts
```

Coverage spans 2-of-3 derivation, vehicle-type branching (HEV-as-ICE, EV,
PHEV), interval/aggregate stats including the user-bug regressions
(partials rolling into intervals, missed entries excluded,
closing-entry-priced equivalent, totalTrackedKm excluding missed
segments), the dashboard pill metrics (totalRefuels / totalCost /
avgKmPerRefuel — including PHEV imputed-electricity addition, EV
no-double-counting, and exclusion of dangling entries that never closed
an interval), CSV round-trip with notes containing commas and quotes,
JSON config round-trip including the lastBackup field scrub and the new
optional settings fields (per-vehicle-type Records display config +
warning thresholds), and the five AddEntry consistency checks
(consumption ±% vs running average, unit price ±% vs recent median,
distance vs avg interval, out-of-order date, ±time/±km duplicate
detection) including their minimum-history skip conditions and
multi-warning aggregation.

## Tech

- React 18 + TypeScript + Vite 5
- Dexie 4 (IndexedDB) + dexie-react-hooks for live queries
- vite-plugin-pwa (off by default, gated behind `ENABLE_PWA=1`)
- vitest for tests
- No CSS framework — hand-rolled iOS-aligned styles via CSS variables for theming
- No charting library — the SVG line chart is ~300 lines in `LineChart.tsx`
