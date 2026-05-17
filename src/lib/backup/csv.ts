import { uid } from '../../db/db';
import type { FuelUp, Vehicle } from '../../db/types';

const NEW_COLUMNS = [
  'date',
  'vehicle',
  'vehicleId',
  'odometer',
  'gasLiters',
  'gasPricePerLiter',
  'kWhCharged',
  'kWhPrice',
  'totalCost',
  'partial',
  'missed',
  'phevKwhPer100Km',
  'phevKwhPrice',
  'notes',
  'id',
] as const;

// Wrap a value in quotes if it contains a separator, quote, or newline.
// RFC 4180–compatible: embedded quotes are doubled (`"` → `""`).
function csvEscape(value: string): string {
  if (
    value.includes(',') ||
    value.includes('"') ||
    value.includes('\n') ||
    value.includes('\r')
  ) {
    return '"' + value.replace(/"/g, '""') + '"';
  }
  return value;
}

// Format any cell value as a CSV-safe string. Nulls become empty, booleans
// become "true"/"false", everything else is stringified then csvEscape'd.
function fmtField(v: string | number | boolean | null | undefined): string {
  if (v == null) return '';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  return csvEscape(String(v));
}

// Split a CSV line into its cells. Handles quoted cells, doubled-quote
// escapes inside quoted cells, and treats unquoted commas as separators.
// Does NOT handle embedded newlines within a quoted cell (we accept that
// limitation — our exports never embed newlines in any field).
function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  let i = 0;
  while (i < line.length) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i += 2;
        } else {
          inQuotes = false;
          i++;
        }
      } else {
        cur += c;
        i++;
      }
    } else if (c === ',') {
      out.push(cur);
      cur = '';
      i++;
    } else if (c === '"' && cur === '') {
      inQuotes = true;
      i++;
    } else {
      cur += c;
      i++;
    }
  }
  out.push(cur);
  return out;
}

// Parse a numeric cell, accepting both "." and "," as the decimal point
// for cross-locale resilience. Empty/blank/unparseable cells return null.
function parseNumOrNull(s: string): number | null {
  const t = s.trim();
  if (t === '') return null;
  const n = parseFloat(t.replace(',', '.'));
  return isFinite(n) ? n : null;
}

// Parse a boolean cell from a variety of common spellings used in CSV
// exports from other apps (true/false, 1/0, yes/no, y/n).
function parseBool(s: string): boolean {
  const t = s.trim().toLowerCase();
  return t === 'true' || t === '1' || t === 'yes' || t === 'y';
}


// Serialize fuel-ups as an Excel-compatible CSV string. Rows are sorted
// chronologically by date so the output reads naturally when opened.
// Includes both human-readable columns (vehicle name) AND the stable
// vehicleId so round-tripping is exact.
export function fuelupsToCsv(fuelups: FuelUp[], vehicles: Vehicle[]): string {
  const byId = new Map(vehicles.map((v) => [v.id, v]));
  const lines: string[] = [NEW_COLUMNS.join(',')];

  const sorted = [...fuelups].sort((a, b) => (a.date < b.date ? -1 : 1));
  for (const f of sorted) {
    const veh = byId.get(f.vehicleId);
    const cells: (string | number | boolean | null | undefined)[] = [
      f.date,
      veh?.name ?? '',
      f.vehicleId,
      f.odometer,
      f.gasLiters,
      f.gasPricePerLiter,
      f.kWhCharged,
      f.kWhPrice,
      f.totalCost,
      f.partial,
      f.missed,
      f.phevKwhPer100Km,
      f.phevKwhPrice,
      typeof f.notes === 'string' ? f.notes.replace(/[\r\n]+/g, ' ') : f.notes,
      f.id,
    ];
    lines.push(cells.map(fmtField).join(','));
  }
  return lines.join('\n') + '\n';
}

// ---------- parse ----------

export interface CsvParseResult {
  fuelups: FuelUp[];
  /** Vehicle names referenced by the CSV that we couldn't resolve. */
  unknownVehicleNames: string[];
}

// Parse a CSV string into fuel-up rows + a list of unknown vehicle names
// the caller will need to create stubs for. Validates a couple of required
// columns up front so we fail fast on completely-wrong files. Expects the
// current split-column format (gasLiters/gasPricePerLiter, kWhCharged/
// kWhPrice, phevKwhPer100Km/phevKwhPrice).
export function csvToFuelups(text: string, vehicles: Vehicle[]): CsvParseResult {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '');
  if (lines.length < 1) throw new Error('CSV is empty.');

  const header = parseCsvLine(lines[0]).map((h) => h.trim());
  if (!header.includes('odometer') || (!header.includes('vehicleId') && !header.includes('vehicle'))) {
    throw new Error(
      "CSV doesn't look like a FuelTracker export (missing odometer or vehicle columns).",
    );
  }

  const col = (name: string) => header.indexOf(name);

  const idx = {
    date: col('date'),
    vehicle: col('vehicle'),
    vehicleId: col('vehicleId'),
    odometer: col('odometer'),
    totalCost: col('totalCost'),
    partial: col('partial'),
    missed: col('missed'),
    notes: col('notes'),
    id: col('id'),

    gasLiters: col('gasLiters'),
    gasPricePerLiter: col('gasPricePerLiter'),
    kWhCharged: col('kWhCharged'),
    kWhPrice: col('kWhPrice'),
    phevKwhPer100Km: col('phevKwhPer100Km'),
    phevKwhPrice: col('phevKwhPrice'),
  };

  const byId = new Map(vehicles.map((v) => [v.id, v]));
  const byName = new Map(vehicles.map((v) => [v.name.toLowerCase(), v]));
  const unknownNames = new Set<string>();

  const out: FuelUp[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = parseCsvLine(lines[i]);
    const get = (j: number): string => (j >= 0 && j < cells.length ? cells[j] : '');

    const rawVehicleId = get(idx.vehicleId).trim();
    const rawVehicleName = get(idx.vehicle).trim();


    let resolvedVehicleId: string;
    if (rawVehicleId && byId.has(rawVehicleId)) {
      resolvedVehicleId = rawVehicleId;
    } else if (rawVehicleName && byName.has(rawVehicleName.toLowerCase())) {
      resolvedVehicleId = byName.get(rawVehicleName.toLowerCase())!.id;
    } else if (rawVehicleId) {
      resolvedVehicleId = rawVehicleId;
      if (rawVehicleName) unknownNames.add(rawVehicleName);
    } else if (rawVehicleName) {
      resolvedVehicleId = '';
      unknownNames.add(rawVehicleName);
    } else {
      throw new Error(`Row ${i + 1}: missing both vehicleId and vehicle name.`);
    }

    const odometerStr = get(idx.odometer).trim();
    const odometer = parseInt(odometerStr || '0', 10);
    if (!isFinite(odometer)) {
      throw new Error(`Row ${i + 1}: invalid odometer "${odometerStr}".`);
    }

    const gasLiters = parseNumOrNull(get(idx.gasLiters));
    const gasPricePerLiter = parseNumOrNull(get(idx.gasPricePerLiter));
    const kWhCharged = parseNumOrNull(get(idx.kWhCharged));
    const kWhPrice = parseNumOrNull(get(idx.kWhPrice));
    const phevKwhPer100Km = parseNumOrNull(get(idx.phevKwhPer100Km));
    const phevKwhPrice = parseNumOrNull(get(idx.phevKwhPrice));

    const notesRaw = get(idx.notes);
    out.push({
      id: get(idx.id).trim() || uid(),
      vehicleId: resolvedVehicleId,
      date: get(idx.date).trim() || new Date().toISOString(),
      odometer,
      partial: parseBool(get(idx.partial)),
      missed: parseBool(get(idx.missed)),
      notes: notesRaw.trim() === '' ? null : notesRaw,
      totalCost: parseNumOrNull(get(idx.totalCost)),
      gasLiters,
      gasPricePerLiter,
      kWhCharged,
      kWhPrice,
      phevKwhPer100Km,
      phevKwhPrice,
    });
  }

  return { fuelups: out, unknownVehicleNames: [...unknownNames] };
}
