import type { Vehicle } from '../db/types';

interface Props {
  vehicles: Vehicle[];
  value: string | null;
  onChange: (id: string) => void;
  label?: string;
}

export function VehicleSelect({ vehicles, value, onChange, label }: Props) {
  if (vehicles.length === 0) return null;
  return (
    <div className="field">
      {label && <label className="field-label">{label}</label>}
      <select value={value ?? ''} onChange={(e) => onChange(e.target.value)}>
        {vehicles.map((v) => (
          <option key={v.id} value={v.id}>
            {v.name}
          </option>
        ))}
      </select>
    </div>
  );
}
