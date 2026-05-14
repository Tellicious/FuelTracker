import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo, useState } from 'react';
import { VehicleSelect } from '../components/VehicleSelect';
import { db } from '../db/db';
import type { FuelUp, Settings, Vehicle } from '../db/types';
import { currencySymbol, fmtDate, fmtMoney, fmtNumber } from '../lib/format';
import { safeGet, safeSet } from '../lib/storage';

interface Props {
  settings: Settings;
  vehicles: Vehicle[];
  activeVehicleId: string | null;
  onActiveVehicleChange: (id: string | null) => void;
  onEdit: (entryId: string) => void;
}

type SortKey = 'date-desc' | 'date-asc';

const SORT_LABELS: Record<SortKey, string> = {
  'date-desc': 'Newest first',
  'date-asc': 'Oldest first',
};

const SORT_STORAGE_KEY = 'ft.recordsSort';
const SORT_DEFAULT: SortKey = 'date-desc';

function loadSort(): SortKey {
  const raw = safeGet(SORT_STORAGE_KEY);
  return raw && raw in SORT_LABELS ? (raw as SortKey) : SORT_DEFAULT;
}

function compareByDate(a: FuelUp, b: FuelUp, key: SortKey): number {
  if (a.date === b.date) return 0;
  const cmp = a.date < b.date ? -1 : 1;
  return key === 'date-desc' ? -cmp : cmp;
}

// Records screen — a chronological list of every fuel-up for the active
// vehicle, newest first by default with a sort toggle. Each row shows the
// date, odometer, amount + unit price + total cost, plus partial/missed
// badges. Tapping a row opens the AddEntry form pre-populated for editing.
export function RecordsScreen({
  settings,
  vehicles,
  activeVehicleId,
  onActiveVehicleChange,
  onEdit,
}: Props) {
  const entries =
    useLiveQuery<FuelUp[]>(
      async () =>
        activeVehicleId
          ? await db.fuelups.where('vehicleId').equals(activeVehicleId).toArray()
          : [],
      [activeVehicleId],
    ) ?? [];

  const [sortKey, setSortKey] = useState<SortKey>(() => loadSort());
  const setSort = (k: SortKey) => {
    setSortKey(k);
    safeSet(SORT_STORAGE_KEY, k);
  };

  const sorted = useMemo(
    () => [...entries].sort((a, b) => compareByDate(a, b, sortKey)),
    [entries, sortKey],
  );

  const remove = async (id: string) => {
    if (!confirm('Delete this entry?')) return;
    await db.fuelups.delete(id);
  };

  return (
    <div className="screen">
      <h1 className="screen-title">Records</h1>

      {vehicles.length > 1 && (
        <VehicleSelect
          vehicles={vehicles}
          value={activeVehicleId}
          onChange={onActiveVehicleChange}
          label="Vehicle"
        />
      )}

      {entries.length > 0 && (
        <div className="records-sort">
          <span className="records-sort-label">Sort</span>
          <div className="segment">
            {(Object.keys(SORT_LABELS) as SortKey[]).map((k) => (
              <button
                key={k}
                className={k === sortKey ? 'active' : ''}
                onClick={() => setSort(k)}
              >
                {SORT_LABELS[k]}
              </button>
            ))}
          </div>
        </div>
      )}

      <div style={{ height: 12 }} />

      {sorted.length === 0 ? (
        <div className="empty">
          <div className="empty-title">No entries yet</div>
          <p>Tap the + tab to log your first fuel-up.</p>
        </div>
      ) : (
        <div className="list">
          {sorted.map((e) => {
            const veh = vehicles.find((v) => v.id === e.vehicleId);
            const isEv = veh?.type === 'ev';
            const sym = currencySymbol(settings.currency);

            const amount = isEv ? e.kWhCharged : e.gasLiters;
            const unitPrice = isEv ? e.kWhPrice : e.gasPricePerLiter;
            const amountUnit = isEv ? 'kWh' : 'l';
            const priceUnit = isEv ? `${sym}/kWh` : `${sym}/l`;
            return (
              <div key={e.id} className="list-item">
                <button
                  onClick={() => onEdit(e.id)}
                  style={{
                    textAlign: 'left',
                    display: 'block',
                    width: '100%',
                    padding: 0,
                    background: 'transparent',
                  }}
                >
                  <div className="list-item-main">
                    {fmtDate(e.date)}
                    <span className="muted" style={{ marginLeft: 8, fontFamily: 'var(--font-mono)' }}>
                      {fmtNumber(e.odometer, 0)} km
                    </span>
                  </div>
                  <div className="list-item-sub">
                    {amount != null && `${fmtNumber(amount, 2)} ${amountUnit}`}
                    {e.totalCost != null && ` · ${fmtMoney(e.totalCost, settings.currency)}`}
                    {unitPrice != null && ` · ${fmtNumber(unitPrice, 3)} ${priceUnit}`}
                    {e.phevKwhPer100Km != null && (
                      <> · {fmtNumber(e.phevKwhPer100Km, 1)} kWh/100km</>
                    )}
                    {(e.partial || e.missed) && (
                      <span style={{ marginLeft: 8 }}>
                        {e.partial && <span className="badge badge-partial">Partial</span>}
                        {e.partial && e.missed && ' '}
                        {e.missed && <span className="badge badge-missed">Missed</span>}
                      </span>
                    )}
                  </div>
                </button>
                <button
                  onClick={() => remove(e.id)}
                  className="muted"
                  aria-label="Delete"
                  style={{ padding: '8px 4px', fontSize: 18 }}
                >
                  ×
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
