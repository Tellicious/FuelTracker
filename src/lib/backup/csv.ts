import { uid } from '../../db/db';
import type { FuelUp, Vehicle } from '../../db/types';

/**
 * Excel-friendly CSV format for the fuel-ups table.
 *
 * Columns (current schema):
 *   date, vehicle, vehicleId, odometer, gasLiters, gasPricePerLiter,
 *   kWhCharged, kWhPrice, totalCost, partial, missed, phevKwhPer100Km,
 *   phevKwhPrice, notes, id
 *
 * Old exports (schema v1) used `liters`, `pricePerLiter`,
 * `avgElectricityConsumption`, `avgElectricityCost` — same `missed` column.
 * The importer transparently handles both — it sniffs the header row and
 * routes columns to the new fields, using the matched vehicle's type to
 * decide whether legacy `liters` means gas litres or kWh charged.
 */

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

// ---------- low-level CSV helpers ----------

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

function fmtField(v: string | number | boolean | null | undefined): string {
  if (v == null) return '';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  return csvEscape(String(v));
}

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

function parseNumOrNull(s: string): number | null {
  const t = s.trim();
  if (t === '') return null;
  const n = parseFloat(t.replace(',', '.'));
  return isFinite(n) ? n : null;
}

function parseBool(s: string): boolean {
  const t = s.trim().toLowerCase();
  return t === 'true' || t === '1' || t === 'yes' || t === 'y';
}

// ---------- serialise ----------

/** Serialize fuel-ups as an Excel-compatible CSV string. */
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

/**
 * Parse a fuel-ups CSV. Accepts both the current schema (gasLiters / kWhCharged
 * / phevKwh* columns) and the legacy schema (liters / pricePerLiter /
 * avgElectricityConsumption / avgElectricityCost) by sniffing the header.
 *
 * For legacy CSVs the importer needs to know each row's vehicle type to
 * decide whether `liters` means gas litres or kWh charged — it looks up the
 * vehicle by `vehicleId` first, falling back to `vehicle` name. Vehicles not
 * found in the provided list are returned as `unknownVehicleNames`.
 */
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
  // New + legacy column indices (negative when absent).
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
    // new
    gasLiters: col('gasLiters'),
    gasPricePerLiter: col('gasPricePerLiter'),
    kWhCharged: col('kWhCharged'),
    kWhPrice: col('kWhPrice'),
    phevKwhPer100Km: col('phevKwhPer100Km'),
    phevKwhPrice: col('phevKwhPrice'),
    // legacy
    liters: col('liters'),
    pricePerLiter: col('pricePerLiter'),
    avgElectricityConsumption: col('avgElectricityConsumption'),
    avgElectricityCost: col('avgElectricityCost'),
  };

  const isLegacy = idx.gasLiters < 0 && idx.liters >= 0;

  const byId = new Map(vehicles.map((v) => [v.id, v]));
  const byName = new Map(vehicles.map((v) => [v.name.toLowerCase(), v]));
  const unknownNames = new Set<string>();

  const out: FuelUp[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = parseCsvLine(lines[i]);
    const get = (j: number): string => (j >= 0 && j < cells.length ? cells[j] : '');

    const rawVehicleId = get(idx.vehicleId).trim();
    const rawVehicleName = get(idx.vehicle).trim();

    // Resolve vehicleId; auto-create-stub deferred to the caller (importFile).
    let resolvedVehicleId: string;
    let matchedVehicle: Vehicle | undefined;
    if (rawVehicleId && byId.has(rawVehicleId)) {
      resolvedVehicleId = rawVehicleId;
      matchedVehicle = byId.get(rawVehicleId);
    } else if (rawVehicleName && byName.has(rawVehicleName.toLowerCase())) {
      matchedVehicle = byName.get(rawVehicleName.toLowerCase())!;
      resolvedVehicleId = matchedVehicle.id;
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

    // Pick fields based on schema.
    let gasLiters: number | null;
    let gasPricePerLiter: number | null;
    let kWhCharged: number | null;
    let kWhPrice: number | null;
    let phevKwhPer100Km: number | null;
    let phevKwhPrice: number | null;

    if (isLegacy) {
      // Legacy schema: liters/pricePerLiter is dual-use; route by vehicle type.
      const legacyAmount = parseNumOrNull(get(idx.liters));
      const legacyUnitPrice = parseNumOrNull(get(idx.pricePerLiter));
      const isEv = matchedVehicle?.type === 'ev';
      if (isEv) {
        kWhCharged = legacyAmount;
        kWhPrice = legacyUnitPrice;
        gasLiters = null;
        gasPricePerLiter = null;
      } else {
        gasLiters = legacyAmount;
        gasPricePerLiter = legacyUnitPrice;
        kWhCharged = null;
        kWhPrice = null;
      }
      phevKwhPer100Km = parseNumOrNull(get(idx.avgElectricityConsumption));
      phevKwhPrice = parseNumOrNull(get(idx.avgElectricityCost));
    } else {
      gasLiters = parseNumOrNull(get(idx.gasLiters));
      gasPricePerLiter = parseNumOrNull(get(idx.gasPricePerLiter));
      kWhCharged = parseNumOrNull(get(idx.kWhCharged));
      kWhPrice = parseNumOrNull(get(idx.kWhPrice));
      phevKwhPer100Km = parseNumOrNull(get(idx.phevKwhPer100Km));
      phevKwhPrice = parseNumOrNull(get(idx.phevKwhPrice));
    }

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
