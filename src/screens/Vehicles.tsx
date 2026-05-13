import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { DecimalInput } from '../components/DecimalInput';
import { Modal } from '../components/Modal';
import { db, uid } from '../db/db';
import type { Settings, Vehicle, VehicleType } from '../db/types';
import { currencySymbol } from '../lib/format';

interface Props {
  settings: Settings;
}

const VEHICLE_TYPES: { value: VehicleType; label: string }[] = [
  { value: 'ice', label: 'ICE (gas/diesel only)' },
  { value: 'hybrid', label: 'Hybrid (HEV)' },
  { value: 'phev', label: 'Plug-in hybrid (PHEV)' },
  { value: 'ev', label: 'Electric (EV)' },
];

export function VehiclesScreen({ settings }: Props) {
  const vehicles = useLiveQuery(() => db.vehicles.orderBy('createdAt').toArray(), []) ?? [];
  const [editing, setEditing] = useState<Vehicle | null>(null);
  const [isNew, setIsNew] = useState(false);

  const startCreate = () => {
    setEditing({
      id: uid(),
      name: '',
      type: 'ice',
      defaultElectricityCost: null,
      createdAt: new Date().toISOString(),
    });
    setIsNew(true);
  };

  const startEdit = (v: Vehicle) => {
    setEditing({ ...v });
    setIsNew(false);
  };

  const save = async () => {
    if (!editing) return;
    if (!editing.name.trim()) return;
    await db.vehicles.put(editing);
    setEditing(null);
  };

  const remove = async () => {
    if (!editing || isNew) return;
    if (!confirm(`Delete "${editing.name}" and all its fuel-ups?`)) return;
    await db.transaction('rw', db.vehicles, db.fuelups, async () => {
      await db.fuelups.where('vehicleId').equals(editing.id).delete();
      await db.vehicles.delete(editing.id);
    });
    setEditing(null);
  };

  return (
    <div className="screen">
      <div className="header">
        <h1>Vehicles</h1>
        <button className="btn btn-primary" onClick={startCreate}>
          + New
        </button>
      </div>

      {vehicles.length === 0 ? (
        <div className="empty">
          <div className="empty-title">No vehicles yet</div>
          <p>Add a vehicle to start logging fuel-ups.</p>
          <button className="btn btn-primary" onClick={startCreate} style={{ marginTop: 16 }}>
            Add vehicle
          </button>
        </div>
      ) : (
        <div className="list">
          {vehicles.map((v) => (
            <button
              key={v.id}
              className="list-item"
              onClick={() => startEdit(v)}
              style={{ textAlign: 'left', cursor: 'pointer' }}
            >
              <div>
                <div className="list-item-main">{v.name}</div>
                <div className="list-item-sub">
                  {VEHICLE_TYPES.find((t) => t.value === v.type)?.label}
                </div>
              </div>
              <div className="muted" style={{ fontSize: 13 }}>
                Edit ›
              </div>
            </button>
          ))}
        </div>
      )}

      <Modal
        open={!!editing}
        title={isNew ? 'New vehicle' : 'Edit vehicle'}
        onClose={() => setEditing(null)}
      >
        {editing && (
          <div className="stack">
            <div className="field">
              <label className="field-label">Name</label>
              <input
                type="text"
                value={editing.name}
                placeholder="e.g. Toyota Yaris"
                onChange={(e) => setEditing({ ...editing, name: e.target.value })}
              />
            </div>

            <div className="field">
              <label className="field-label">Type</label>
              <select
                value={editing.type}
                onChange={(e) =>
                  setEditing({ ...editing, type: e.target.value as VehicleType })
                }
              >
                {VEHICLE_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>

            {(editing.type === 'phev' || editing.type === 'ev') && (
              <div className="field">
                <label className="field-label">
                  Default electricity cost ({currencySymbol(settings.currency)}/kWh)
                </label>
                <DecimalInput
                  value={editing.defaultElectricityCost}
                  placeholder={`Falls back to global (${settings.defaultElectricityCost})`}
                  onChange={(n) =>
                    setEditing({ ...editing, defaultElectricityCost: n })
                  }
                />
              </div>
            )}

            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              {!isNew && (
                <button className="btn btn-danger" onClick={remove}>
                  Delete
                </button>
              )}
              <button
                className="btn"
                style={{ marginLeft: 'auto' }}
                onClick={() => setEditing(null)}
              >
                Cancel
              </button>
              <button className="btn btn-primary" onClick={save} disabled={!editing.name.trim()}>
                Save
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
