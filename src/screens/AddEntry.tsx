import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useMemo, useState } from 'react';
import { db, uid } from '../db/db';
import type { FuelUp, Settings, Vehicle, VehicleType } from '../db/types';
import { reconcile, type DeriveField, type DeriveValues } from '../lib/derive';
import { currencySymbol, fmtMoney, fromInputDateTime, parseDecimalInput, toInputDateTime } from '../lib/format';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Props {
  settings: Settings;
  vehicles: Vehicle[];
  activeVehicleId: string | null;
  onActiveVehicleChange: (id: string | null) => void;
  editingId?: string | null;
  onSaved: () => void;
  onCancel: () => void;
}

/**
 * Form state. `amount` and `unitPrice` are vehicle-type-neutral — they map to
 * gasLiters/gasPricePerLiter for ICE/HEV/PHEV and to kWhCharged/kWhPrice for
 * EV at save time.
 */
interface FormState {
  vehicleId: string;
  date: string; // ISO
  odometer: string;
  amount: string;
  unitPrice: string;
  totalCost: string;
  partial: boolean;
  /** Marks the previous fuel-up as not logged → interval excluded from stats. */
  missed: boolean;
  // PHEV-only: electricity stats since the previous entry
  phevKwhPer100Km: string;
  phevKwhPrice: string;
  notes: string;
}

function blank(vehicleId: string): FormState {
  return {
    vehicleId,
    date: new Date().toISOString(),
    odometer: '',
    amount: '',
    unitPrice: '',
    totalCost: '',
    partial: false,
    missed: false,
    phevKwhPer100Km: '',
    phevKwhPrice: '',
    notes: '',
  };
}

function toNumOrNull(v: string): number | null {
  if (v.trim() === '') return null;
  const n = parseDecimalInput(v);
  return Number.isFinite(n) ? n : null;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function AddEntryScreen({
  settings,
  vehicles,
  activeVehicleId,
  onActiveVehicleChange,
  editingId,
  onSaved,
  onCancel,
}: Props) {
  const editingEntry = useLiveQuery<FuelUp | undefined>(
    async () => (editingId ? await db.fuelups.get(editingId) : undefined),
    [editingId],
  );

  const [form, setForm] = useState<FormState>(() =>
    blank(activeVehicleId ?? ''),
  );
  const [lastTouched, setLastTouched] = useState<DeriveField[]>([]);
  const [previousOdometer, setPreviousOdometer] = useState<number | null>(null);
  const [showErrors, setShowErrors] = useState(false);

  const currentVehicle: Vehicle | undefined = vehicles.find((v) => v.id === form.vehicleId);
  const vehicleType: VehicleType = currentVehicle?.type ?? 'ice';
  const isEv = vehicleType === 'ev';
  const isPhev = vehicleType === 'phev';

  // -------------------------------------------------------------------------
  // Hydration: load values from an existing entry when editing
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (!editingEntry) return;
    const editVehicle = vehicles.find((v) => v.id === editingEntry.vehicleId);
    const editIsEv = editVehicle?.type === 'ev';
    const elecDefault =
      editVehicle?.defaultElectricityCost ?? settings.defaultElectricityCost;
    setForm({
      vehicleId: editingEntry.vehicleId,
      date: editingEntry.date,
      odometer: String(editingEntry.odometer),
      amount: editIsEv
        ? editingEntry.kWhCharged?.toString() ?? ''
        : editingEntry.gasLiters?.toString() ?? '',
      unitPrice: editIsEv
        ? editingEntry.kWhPrice?.toString() ?? ''
        : editingEntry.gasPricePerLiter?.toString() ?? '',
      totalCost: editingEntry.totalCost?.toString() ?? '',
      partial: editingEntry.partial,
      missed: editingEntry.missed ?? false,
      phevKwhPer100Km: editingEntry.phevKwhPer100Km?.toString() ?? '',
      phevKwhPrice:
        editingEntry.phevKwhPrice?.toString() ?? String(elecDefault),
      notes: editingEntry.notes ?? '',
    });
    setLastTouched([]);
  }, [editingEntry, vehicles, settings.defaultElectricityCost]);

  // -------------------------------------------------------------------------
  // Sync form.vehicleId with the app-level active vehicle (cross-tab)
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (editingId) return;
    if (activeVehicleId && activeVehicleId !== form.vehicleId) {
      setForm((f) => ({ ...f, vehicleId: activeVehicleId }));
    } else if (!activeVehicleId && vehicles.length > 0 && !form.vehicleId) {
      setForm((f) => ({ ...f, vehicleId: vehicles[0].id }));
    }
  }, [activeVehicleId, vehicles, editingId, form.vehicleId]);

  // -------------------------------------------------------------------------
  // Look up the previous odometer reading for the warning hint
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (!form.vehicleId) {
      setPreviousOdometer(null);
      return;
    }
    db.fuelups
      .where('vehicleId')
      .equals(form.vehicleId)
      .toArray()
      .then((rows) => {
        const others = editingId ? rows.filter((r) => r.id !== editingId) : rows;
        const prev = others
          .filter((r) => r.date <= form.date)
          .sort((a, b) => (a.date < b.date ? -1 : 1));
        setPreviousOdometer(prev.length ? prev[prev.length - 1].odometer : null);
      });
  }, [form.vehicleId, form.date, editingId]);

  // -------------------------------------------------------------------------
  // Pre-fill the electricity unit price from the vehicle's own default (or
  // the global setting as fallback). EV uses `unitPrice` since the whole
  // entry is a charge event; PHEV uses `phevKwhPrice` (the dedicated since-
  // last-full field). We only overwrite when the field is empty so a user
  // who has typed a custom value isn't clobbered by a vehicle switch.
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (editingId) return; // editing flow has its own hydration below
    const v = vehicles.find((x) => x.id === form.vehicleId);
    if (!v) return;
    if (v.type !== 'ev' && v.type !== 'phev') return;
    const elecDefault = v.defaultElectricityCost ?? settings.defaultElectricityCost;
    setForm((f) => {
      if (v.type === 'ev' && f.unitPrice === '') {
        return { ...f, unitPrice: String(elecDefault) };
      }
      if (v.type === 'phev' && f.phevKwhPrice === '') {
        return { ...f, phevKwhPrice: String(elecDefault) };
      }
      return f;
    });
  }, [form.vehicleId, vehicles, settings.defaultElectricityCost, editingId]);

  // -------------------------------------------------------------------------
  // 2-of-3 cost reconciliation for non-EV vehicles
  // -------------------------------------------------------------------------
  const reconciled = useMemo<ReturnType<typeof reconcile>>(() => {
    if (isEv) return null;
    const values: DeriveValues = {
      amount: toNumOrNull(form.amount),
      unitPrice: toNumOrNull(form.unitPrice),
      totalCost: toNumOrNull(form.totalCost),
    };
    return reconcile(values, lastTouched);
  }, [form.amount, form.unitPrice, form.totalCost, lastTouched, isEv]);

  const derivedField = reconciled?.derivedField ?? null;

  const displayValue = (field: DeriveField): string => {
    if (reconciled && reconciled.derivedField === field) {
      const v = reconciled[field];
      return field === 'totalCost' ? v.toFixed(2) : v.toFixed(3);
    }
    if (field === 'amount') return form.amount;
    if (field === 'unitPrice') return form.unitPrice;
    return form.totalCost;
  };

  const onCostFieldChange = (field: DeriveField, value: string) => {
    setForm((f) => ({
      ...f,
      amount: field === 'amount' ? value : f.amount,
      unitPrice: field === 'unitPrice' ? value : f.unitPrice,
      totalCost: field === 'totalCost' ? value : f.totalCost,
    }));
    setLastTouched((lt) => [field, ...lt.filter((x) => x !== field)].slice(0, 3));
  };

  // -------------------------------------------------------------------------
  // EV: simple amount × unitPrice (no 2-of-3, just multiplication)
  // -------------------------------------------------------------------------
  const evAmount = toNumOrNull(form.amount);
  const evUnitPrice = toNumOrNull(form.unitPrice);
  const evTotalCost =
    evAmount != null && evUnitPrice != null ? evAmount * evUnitPrice : null;

  // -------------------------------------------------------------------------
  // Validation
  // -------------------------------------------------------------------------
  const odometerNum = toNumOrNull(form.odometer);
  const odometerOk = odometerNum != null && odometerNum >= 0;
  const odometerWarn =
    odometerNum != null && previousOdometer != null && odometerNum < previousOdometer;

  const costOk = isEv
    ? evAmount != null && evAmount > 0 && evUnitPrice != null && evUnitPrice > 0
    : !!reconciled;

  const canSave = !!form.vehicleId && odometerOk && costOk;

  const errors = {
    odometer: showErrors && !odometerOk,
    amount: showErrors && (isEv ? evAmount == null || evAmount <= 0 : !reconciled && !form.amount),
    unitPrice:
      showErrors &&
      (isEv
        ? evUnitPrice == null || evUnitPrice <= 0
        : !reconciled && !form.unitPrice),
    totalCost: showErrors && !isEv && !reconciled && !form.totalCost,
  };

  // -------------------------------------------------------------------------
  // Save
  // -------------------------------------------------------------------------
  const save = async () => {
    if (!canSave) {
      setShowErrors(true);
      return;
    }
    if (odometerWarn) {
      const ok = confirm(
        `Odometer ${odometerNum} is less than previous (${previousOdometer}). Save anyway?`,
      );
      if (!ok) return;
    }

    // Map vehicle-type-neutral form values to the right DB fields.
    const entry: FuelUp = {
      id: editingId ?? uid(),
      vehicleId: form.vehicleId,
      date: form.date,
      odometer: Math.round(odometerNum!),
      partial: form.partial,
      missed: form.missed,
      notes: form.notes.trim() || null,
      totalCost: isEv ? evTotalCost : reconciled!.totalCost,

      gasLiters: isEv ? null : reconciled!.amount,
      gasPricePerLiter: isEv ? null : reconciled!.unitPrice,

      kWhCharged: isEv ? evAmount : null,
      kWhPrice: isEv ? evUnitPrice : null,

      phevKwhPer100Km: isPhev ? toNumOrNull(form.phevKwhPer100Km) : null,
      phevKwhPrice: isPhev ? toNumOrNull(form.phevKwhPrice) : null,
    };
    await db.fuelups.put(entry);

    if (form.vehicleId && form.vehicleId !== activeVehicleId) {
      onActiveVehicleChange(form.vehicleId);
    }
    onSaved();
  };

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------
  if (vehicles.length === 0) {
    return (
      <div className="screen">
        <div className="empty">
          <div className="empty-title">Add a vehicle first</div>
          <p>You need to create a vehicle before logging fuel-ups.</p>
        </div>
      </div>
    );
  }

  const currency = settings.currency;
  const sym = currencySymbol(currency);

  return (
    <div className="screen">
      <h1 className="screen-title">
        {editingId ? 'Edit entry' : isEv ? 'New charge' : 'New fuel-up'}
      </h1>

      <div className="stack">
        <VehiclePicker
          vehicles={vehicles}
          value={form.vehicleId}
          onChange={(id) => setForm({ ...form, vehicleId: id })}
        />

        <DateTimePicker
          value={form.date}
          onChange={(d) => setForm({ ...form, date: d })}
        />

        <OdometerField
          value={form.odometer}
          onChange={(v) => setForm({ ...form, odometer: v })}
          previous={previousOdometer}
          showError={errors.odometer}
          showWarning={!!odometerWarn && !errors.odometer}
        />

        {isEv ? (
          <EvChargingSection
            form={form}
            onChange={setForm}
            sym={sym}
            currency={currency}
            evTotalCost={evTotalCost}
            errors={errors}
          />
        ) : (
          <GasCostSection
            displayValue={displayValue}
            onChange={onCostFieldChange}
            derivedField={derivedField}
            errors={errors}
            sym={sym}
          />
        )}

        {isPhev && (
          <PhevElectricitySection
            form={form}
            onChange={setForm}
            sym={sym}
          />
        )}

        <PartialAndMissedToggles
          partial={form.partial}
          missed={form.missed}
          onTogglePartial={() => setForm({ ...form, partial: !form.partial })}
          onToggleMissed={() => setForm({ ...form, missed: !form.missed })}
          isEv={isEv}
        />

        <div className="field">
          <label className="field-label">Notes (optional)</label>
          <textarea
            rows={2}
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
          />
        </div>

        <div className="form-actions">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={save}
          >
            {editingId ? 'Save changes' : isEv ? 'Save charge' : 'Save fuel-up'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Subcomponents
// ---------------------------------------------------------------------------

function VehiclePicker({
  vehicles,
  value,
  onChange,
}: {
  vehicles: Vehicle[];
  value: string;
  onChange: (id: string) => void;
}) {
  return (
    <div className="field">
      <label className="field-label">Vehicle</label>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {vehicles.map((v) => (
          <option key={v.id} value={v.id}>
            {v.name}
          </option>
        ))}
      </select>
    </div>
  );
}

function DateTimePicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (iso: string) => void;
}) {
  return (
    <div className="field">
      <label className="field-label">Date & time</label>
      <input
        type="datetime-local"
        value={toInputDateTime(value)}
        onChange={(e) => onChange(fromInputDateTime(e.target.value))}
      />
    </div>
  );
}

function OdometerField({
  value,
  onChange,
  previous,
  showError,
  showWarning,
}: {
  value: string;
  onChange: (v: string) => void;
  previous: number | null;
  showError: boolean;
  showWarning: boolean;
}) {
  return (
    <div className="field">
      <label className="field-label">Odometer (km)</label>
      <div className="field-row">
        <input
          type="text"
          inputMode="numeric"
          step="1"
          min="0"
          className={showError ? 'error' : ''}
          placeholder={previous != null ? `Previous: ${previous}` : '0'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
        <span className="field-suffix">km</span>
      </div>
      {showError && <div className="field-error">Enter the current odometer reading.</div>}
      {showWarning && (
        <div className="input-help" style={{ color: 'var(--danger)' }}>
          Less than the previous entry ({previous} km) — will warn on save.
        </div>
      )}
    </div>
  );
}

function EvChargingSection({
  form,
  onChange,
  sym,
  currency,
  evTotalCost,
  errors,
}: {
  form: FormState;
  onChange: (f: FormState) => void;
  sym: string;
  currency: string;
  evTotalCost: number | null;
  errors: { amount: boolean; unitPrice: boolean };
}) {
  return (
    <>
      <div className="section-title">Charging</div>
      <div className="field">
        <label className="field-label">Energy added</label>
        <div className="field-row">
          <input
            type="text"
            inputMode="decimal"
            step="0.1"
            className={errors.amount ? 'error' : ''}
            value={form.amount}
            onChange={(e) => onChange({ ...form, amount: e.target.value })}
          />
          <span className="field-suffix">kWh</span>
        </div>
        {errors.amount && <div className="field-error">Required.</div>}
      </div>
      <div className="field">
        <label className="field-label">Price per kWh</label>
        <div className="field-row">
          <input
            type="text"
            inputMode="decimal"
            step="0.001"
            className={errors.unitPrice ? 'error' : ''}
            value={form.unitPrice}
            onChange={(e) => onChange({ ...form, unitPrice: e.target.value })}
          />
          <span className="field-suffix">{sym}/kWh</span>
        </div>
        {errors.unitPrice && <div className="field-error">Required.</div>}
      </div>
      {evTotalCost != null && (
        <div className="input-help">
          Total cost: {fmtMoney(evTotalCost, currency, 2)}
        </div>
      )}
    </>
  );
}

function GasCostSection({
  displayValue,
  onChange,
  derivedField,
  errors,
  sym,
}: {
  displayValue: (f: DeriveField) => string;
  onChange: (f: DeriveField, v: string) => void;
  derivedField: DeriveField | null;
  errors: { amount: boolean; unitPrice: boolean; totalCost: boolean };
  sym: string;
}) {
  const showHelpRow = !(errors.amount || errors.unitPrice || errors.totalCost);
  return (
    <>
      <div className="section-title">Fuel cost · enter any two</div>
      <CostInput
        label="Total cost"
        suffix={sym}
        step="0.01"
        derived={derivedField === 'totalCost'}
        error={errors.totalCost}
        value={displayValue('totalCost')}
        onChange={(v) => onChange('totalCost', v)}
      />
      <CostInput
        label="Liters"
        suffix="l"
        step="0.01"
        derived={derivedField === 'amount'}
        error={errors.amount}
        value={displayValue('amount')}
        onChange={(v) => onChange('amount', v)}
      />
      <CostInput
        label="Price per liter"
        suffix={`${sym}/l`}
        step="0.001"
        derived={derivedField === 'unitPrice'}
        error={errors.unitPrice}
        value={displayValue('unitPrice')}
        onChange={(v) => onChange('unitPrice', v)}
      />
      {!showHelpRow && (
        <div className="field-error" style={{ marginLeft: 4 }}>
          Enter at least two of the three fields above.
        </div>
      )}
      {showHelpRow && (
        <div className="input-help">
          Clear any field to recalculate it; type into any field to override.
        </div>
      )}
    </>
  );
}

function CostInput({
  label,
  suffix,
  step,
  derived,
  error,
  value,
  onChange,
}: {
  label: string;
  suffix: string;
  step: string;
  derived: boolean;
  error: boolean;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="field">
      <label className="field-label">{label}</label>
      <div className="field-row">
        <input
          type="text"
          inputMode="decimal"
          step={step}
          className={`${derived ? 'derived' : ''} ${error ? 'error' : ''}`.trim()}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
        <span className="field-suffix">{suffix}</span>
      </div>
    </div>
  );
}

function PhevElectricitySection({
  form,
  onChange,
  sym,
}: {
  form: FormState;
  onChange: (f: FormState) => void;
  sym: string;
}) {
  return (
    <>
      <div className="section-title">Electricity since previous full fuel-up (optional)</div>
      <div className="field">
        <label className="field-label">Avg electricity consumption</label>
        <div className="field-row">
          <input
            type="text"
            inputMode="decimal"
            step="0.1"
            placeholder="from car display"
            value={form.phevKwhPer100Km}
            onChange={(e) => onChange({ ...form, phevKwhPer100Km: e.target.value })}
          />
          <span className="field-suffix">kWh/100 km</span>
        </div>
        <div className="field-hint">
          Reset the trip computer at each full fuel-up; this value covers the
          whole interval back to the previous full fill.
        </div>
      </div>
      <div className="field">
        <label className="field-label">Avg electricity cost</label>
        <div className="field-row">
          <input
            type="text"
            inputMode="decimal"
            step="0.001"
            value={form.phevKwhPrice}
            onChange={(e) => onChange({ ...form, phevKwhPrice: e.target.value })}
          />
          <span className="field-suffix">{sym}/kWh</span>
        </div>
      </div>
    </>
  );
}

function PartialAndMissedToggles({
  partial,
  missed,
  onTogglePartial,
  onToggleMissed,
  isEv,
}: {
  partial: boolean;
  missed: boolean;
  onTogglePartial: () => void;
  onToggleMissed: () => void;
  isEv: boolean;
}) {
  return (
    <div className="card" style={{ padding: '4px 16px' }}>
      <div className="toggle">
        <div>
          <div style={{ fontWeight: 500 }}>
            {isEv ? 'Partial charge' : 'Partial fill-up'}
          </div>
          <div className="field-hint">
            {isEv
              ? 'Battery not fully charged — rolls into the next full charge'
              : 'Tank not filled completely — rolls into the next full fill'}
          </div>
        </div>
        <button
          type="button"
          className={`toggle-switch ${partial ? 'on' : ''}`}
          onClick={onTogglePartial}
          aria-pressed={partial}
          aria-label="Partial"
        />
      </div>
      <div className="toggle">
        <div>
          <div style={{ fontWeight: 500 }}>Missed fuel-up</div>
          <div className="field-hint">Excludes this interval from stats</div>
        </div>
        <button
          type="button"
          className={`toggle-switch ${missed ? 'on' : ''}`}
          onClick={onToggleMissed}
          aria-pressed={missed}
          aria-label="Missed previous"
        />
      </div>
    </div>
  );
}
