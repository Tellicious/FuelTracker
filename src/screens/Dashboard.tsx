import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useMemo, useState } from 'react';
import { KpiCard } from '../components/KpiCard';
import { LineChart, type ChartPoint, type ChartSeries, type Scale } from '../components/LineChart';
import { VehicleSelect } from '../components/VehicleSelect';
import { db } from '../db/db';
import type { FuelUp, Settings, Vehicle } from '../db/types';
import { computeDashboard } from '../lib/stats';
import { displayUnitLabel, toDisplay } from '../lib/units';
import { currencySymbol, fmtDate, fmtMoney, fmtNumber } from '../lib/format';

interface Props {
  settings: Settings;
  vehicles: Vehicle[];
  activeVehicleId: string | null;
  onActiveVehicleChange: (id: string | null) => void;
}

interface ColumnDef {
  key: 'gas' | 'elec' | 'equiv';
  heading: string;
  unitLine: string;
}

// Dashboard screen. Shows six top-line KPIs in a 2×3 grid — row 1:
// Tracked km / Fill-ups (or Charges) / Total cost; row 2: Avg km per
// fill-up / Avg cost-per-km / Last cost-per-km. Below them, a
// consumption matrix (gas km/l, electricity kWh/100km, equivalent
// km/l × last / average / best), then the LineChart with pan/pinch
// and a smoothing toggle. Empty state shown when there are fewer
// than two full fill-ups (no completed intervals yet).
export function DashboardScreen({
  settings,
  vehicles,
  activeVehicleId,
  onActiveVehicleChange,
}: Props) {


  const [scale, setScale] = useState<Scale>('ALL');
  const [customFrom, setCustomFrom] = useState<string | null>(null);
  const [customTo, setCustomTo] = useState<string | null>(null);

  useEffect(() => {
    setScale('ALL');
    setCustomFrom(null);
    setCustomTo(null);
  }, [activeVehicleId]);

  const [visible, setVisible] = useState<Record<ChartSeries, boolean>>({
    gas: true,
    equiv: true,
    elec: true,
  });
  const [smoothed, setSmoothed] = useState(false);

  const entries =
    useLiveQuery<FuelUp[]>(
      async () =>
        activeVehicleId
          ? await db.fuelups.where('vehicleId').equals(activeVehicleId).toArray()
          : [],
      [activeVehicleId],
    ) ?? [];

  const activeVehicle = vehicles.find((v) => v.id === activeVehicleId);
  const vehicleType = activeVehicle?.type ?? 'ice';
  const unitLabel = displayUnitLabel(settings.consumptionUnit);
  const stats = useMemo(() => computeDashboard(entries, vehicleType), [entries, vehicleType]);






  const showGas = vehicleType === 'ice' || vehicleType === 'hybrid' || vehicleType === 'phev';
  const showElec = vehicleType === 'phev' || vehicleType === 'ev';
  const showEquiv = vehicleType === 'phev';



  const chartPoints: ChartPoint[] = useMemo(
    () =>
      stats.intervals.map((iv) => ({
        date: iv.toDate,
        gas: showGas ? toDisplay(iv.kmPerL, settings.consumptionUnit) : null,
        equivalent:
          showEquiv && iv.electricityCost > 0
            ? toDisplay(iv.equivalentKmPerL, settings.consumptionUnit)
            : null,
        elec: showElec && iv.kWhUsed > 0 ? iv.kWhPer100Km : null,
      })),
    [stats, settings.consumptionUnit, showGas, showElec, showEquiv],
  );

  if (vehicles.length === 0) {
    return (
      <div className="screen">
        <h1 className="screen-title">Dashboard</h1>
        <div className="empty">
          <div className="empty-title">Add a vehicle</div>
          <p>Create a vehicle in the Vehicles tab to get started.</p>
        </div>
      </div>
    );
  }

  const columns: ColumnDef[] = [];
  if (showGas) columns.push({ key: 'gas', heading: 'Gas', unitLine: `[${unitLabel}]` });
  if (showElec)
    columns.push({ key: 'elec', heading: 'Electricity', unitLine: '[kWh/100 km]' });
  if (showEquiv)
    columns.push({ key: 'equiv', heading: 'Equivalent gas', unitLine: `[${unitLabel}]` });

  const fmtConsumption = (kmPerL: number | null) =>
    kmPerL == null ? null : fmtNumber(toDisplay(kmPerL, settings.consumptionUnit), 1);
  const fmtKwh = (v: number | null) => (v == null ? null : fmtNumber(v, 1));

  const valueFor = (col: ColumnDef['key'], row: 'last' | 'avg' | 'best'): string | null => {
    if (col === 'gas') {
      if (row === 'last') return fmtConsumption(stats.lastKmPerL);
      if (row === 'avg') return fmtConsumption(stats.avgKmPerL);
      return fmtConsumption(stats.bestKmPerL);
    }
    if (col === 'elec') {
      if (row === 'last') return fmtKwh(stats.lastKWhPer100Km);
      if (row === 'avg') return fmtKwh(stats.avgKWhPer100Km);
      return fmtKwh(stats.bestKWhPer100Km);
    }

    if (row === 'last') return fmtConsumption(stats.lastEquivalentKmPerL);
    if (row === 'avg') return fmtConsumption(stats.avgEquivalentKmPerL);
    return fmtConsumption(stats.bestEquivalentKmPerL);
  };

  return (
    <div className="screen">
      <h1 className="screen-title">Dashboard</h1>

      {vehicles.length > 1 && (
        <VehicleSelect
          vehicles={vehicles}
          value={activeVehicleId}
          onChange={onActiveVehicleChange}
        />
      )}

      <div style={{ height: 12 }} />

      {}
      {(() => {
  const isEv = vehicleType === 'ev';
  const refuelLabel = isEv ? 'Charges' : 'Fill-ups';
  const avgKmLabel = isEv ? 'Avg km / charge' : 'Avg km / fill-up';
  const sym = currencySymbol(settings.currency);
  return (
    <div className="kpi-grid">
      {/* Row 1 */}
      <KpiCard
        label="Tracked km"
        value={stats.totalTrackedKm > 0 ? fmtNumber(stats.totalTrackedKm, 0) : '—'}
        accent
      />
      <KpiCard
        label={refuelLabel}
        value={stats.totalRefuels > 0 ? fmtNumber(stats.totalRefuels, 0) : '—'}
      />
      <KpiCard
        label="Total cost"
        value={stats.totalCost > 0 ? fmtMoney(stats.totalCost, settings.currency, 2) : '—'}
      />
      {/* Row 2 */}
      <KpiCard
        label={avgKmLabel}
        value={stats.avgKmPerRefuel != null ? fmtNumber(stats.avgKmPerRefuel, 0) : '—'}
      />
      <KpiCard
        label={`Avg ${sym}/km`}
        value={
          stats.avgEurPerKm != null
            ? fmtMoney(stats.avgEurPerKm, settings.currency, 3)
            : '—'
        }
      />
      <KpiCard
        label={`Last ${sym}/km`}
        value={
          stats.lastEurPerKm != null
            ? fmtMoney(stats.lastEurPerKm, settings.currency, 3)
            : '—'
        }
      />
    </div>
  );
})()}

      {}
      {columns.length > 0 && (
        <div
          className="cons-grid"
          style={{ gridTemplateColumns: `repeat(${columns.length}, 1fr)` }}
        >
          {columns.map((col) => (
            <div key={col.key} className="cons-col">
              <div className="cons-col-heading">
                {col.heading} consumption
                <span className="cons-col-heading-unit">{col.unitLine}</span>
              </div>
              {(['last', 'avg', 'best'] as const).map((rowKey) => {
                const val = valueFor(col.key, rowKey);
                const label =
                  rowKey === 'last' ? 'Last' : rowKey === 'avg' ? 'Average' : 'Best';
                return (
                  <div key={rowKey} className="cons-row">
                    <div className="cons-row-label">{label}</div>
                    <div className={`cons-row-value ${val == null ? 'empty' : ''}`}>
                      {val ?? '—'}
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}

      {}
      {(() => {
        if (vehicleType === 'ev') {
          return stats.bestKWhPer100KmDate ? (
            <div className="input-help" style={{ marginTop: 8, marginLeft: 4 }}>
              Best kWh/100 km reached on {fmtDate(stats.bestKWhPer100KmDate)}
            </div>
          ) : null;
        }
        if (vehicleType === 'phev') {
          return stats.bestEquivalentKmPerLDate ? (
            <div className="input-help" style={{ marginTop: 8, marginLeft: 4 }}>
              Best equivalent {unitLabel} reached on {fmtDate(stats.bestEquivalentKmPerLDate)}
            </div>
          ) : null;
        }

        const d = stats.bestEquivalentKmPerLDate ?? stats.bestKmPerLDate;
        return d ? (
          <div className="input-help" style={{ marginTop: 8, marginLeft: 4 }}>
            Best {unitLabel} reached on {fmtDate(d)}
          </div>
        ) : null;
      })()}

      {}
      {chartPoints.length > 0 && (
        <>
          <div className="section-title">Consumption over time</div>
          <LineChart
            points={chartPoints}
            unitLabel={unitLabel}
            scale={scale}
            onScaleChange={setScale}
            customFrom={customFrom}
            customTo={customTo}
            onCustomRangeChange={(from, to) => {
              setCustomFrom(from);
              setCustomTo(to);
            }}
            showGas={showGas}
            showEquiv={showEquiv}
            showElec={showElec}
            visible={visible}
            onVisibleChange={setVisible}
            smoothed={smoothed}
            onSmoothedChange={setSmoothed}
            smoothingWindow={settings.smoothingWindow}
          />
        </>
      )}

      {stats.intervals.length === 0 && (
        <div className="empty" style={{ marginTop: 16 }}>
          <div className="empty-title">Log two full fill-ups</div>
          <p>
            Consumption is computed between consecutive full (non-partial) fill-ups. Add at
            least two to see your numbers.
          </p>
        </div>
      )}
    </div>
  );
}
