import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useMemo, useState } from 'react';
import { db, uid } from '../db/db';
import type { FuelUp, Settings, Vehicle, VehicleType } from '../db/types';
import { reconcile, type DeriveField, type DeriveValues } from '../lib/derive';
import { runAllChecks, type CheckContext, type Warning } from '../lib/checks';
import { currencySymbol, fmtMoney, fromInputDateTime, parseDecimalInput, toInputDateTime } from '../lib/format';

interface Props {
  settings: Settings;
  vehicles: Vehicle[];
  activeVehicleId: string | null;
  onActiveVehicleChange: (id: string | null) => void;
  editingId?: string | null;
  onSaved: () => void;
  onCancel: () => void;
}

interface FormState {
  vehicleId: string;
  date: string;
  odometer: string;
  amount: string;
  unitPrice: string;
  totalCost: string;
  partial: boolean;

  missed: boolean;

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

// The "new fuel-up / edit existing entry" form. Vehicle-type-aware: shows
// gas cost fields for ICE/HEV/PHEV, kWh fields for EVs, plus an optional
// PHEV electricity-since-last-full section for PHEVs. The cost triplet
// (amount × unitPrice = totalCost) auto-derives via lib/derive whenever
// two of the three are filled in. Form state is held as strings so users
// can type partial / comma-decimal values without the input being clobbered
// on every keystroke. On save, the entry is persisted via Dexie and the
// user is sent back to the Records screen.
//
// In addition to the original hard-error validation (missing odometer,
// missing cost values) and the legacy odometer-less-than-previous soft
// warning, this form runs five consistency checks (defined in lib/checks)
// against the candidate entry vs the rest of the vehicle's history:
//   A — Avg consumption ±N% vs running average
//   B — Unit price ±N% vs recent median
//   D — New-interval distance > N× avg interval distance
//   E — Entry date earlier than the latest existing entry
//   H — Another entry within ±N min and ±N km (duplicate)
// All thresholds are user-configurable in Settings. Warnings render as
// inline help text near the relevant field; on save, any that fired get
// gathered into a single confirm() dialog the user can review and
// dismiss.
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
  const [suppressDerivation, setSuppressDerivation] = useState(false);
  const [previousOdometer, setPreviousOdometer] = useState<number | null>(null);
  const [showErrors, setShowErrors] = useState(false);

  const currentVehicle: Vehicle | undefined = vehicles.find((v) => v.id === form.vehicleId);
  const vehicleType: VehicleType = currentVehicle?.type ?? 'ice';
  const isEv = vehicleType === 'ev';
  const isPhev = vehicleType === 'phev';




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
    setSuppressDerivation(false);
  }, [editingEntry, vehicles, settings.defaultElectricityCost]);




  useEffect(() => {
    if (editingId) return;
    setForm((f) => {
      if (f.vehicleId) return f;
      if (activeVehicleId) return { ...f, vehicleId: activeVehicleId };
      if (vehicles.length > 0) return { ...f, vehicleId: vehicles[0].id };
      return f;
    });
  }, [activeVehicleId, vehicles, editingId]);




  // Load the full history for this vehicle. We need it not only to derive
  // previousOdometer (already used by the legacy check) but also to feed
  // runAllChecks for the new consistency warnings.
  const vehicleHistory =
    useLiveQuery<FuelUp[]>(
      async () =>
        form.vehicleId
          ? await db.fuelups.where('vehicleId').equals(form.vehicleId).toArray()
          : [],
      [form.vehicleId],
    ) ?? [];

  useEffect(() => {
    if (!form.vehicleId) {
      setPreviousOdometer(null);
      return;
    }
    const others = editingId ? vehicleHistory.filter((r) => r.id !== editingId) : vehicleHistory;
    const prev = others
      .filter((r) => r.date <= form.date)
      .sort((a, b) => (a.date < b.date ? -1 : 1));
    setPreviousOdometer(prev.length ? prev[prev.length - 1].odometer : null);
  }, [form.vehicleId, form.date, editingId, vehicleHistory]);








  useEffect(() => {
    if (editingId) return;
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




  const reconciled = useMemo<ReturnType<typeof reconcile>>(() => {
    if (isEv) return null;
    if (suppressDerivation) return null;
    const values: DeriveValues = {
      amount: toNumOrNull(form.amount),
      unitPrice: toNumOrNull(form.unitPrice),
      totalCost: toNumOrNull(form.totalCost),
    };
    return reconcile(values, lastTouched);
  }, [form.amount, form.unitPrice, form.totalCost, lastTouched, isEv, suppressDerivation]);

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
    setSuppressDerivation(value === '');
  };




  const evAmount = toNumOrNull(form.amount);
  const evUnitPrice = toNumOrNull(form.unitPrice);
  const evTotalCost =
    evAmount != null && evUnitPrice != null ? evAmount * evUnitPrice : null;




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




  // Build the consistency-check input only when the form has enough
  // information to bother. Bails out early if the cost values aren't
  // even close to ready — no point showing scary warnings while the user
  // is still typing the first digit of the price.
  const warnings: Warning[] = useMemo(() => {
    if (!form.vehicleId || !odometerOk) return [];
    if (!costOk) return [];
    const candidateAmount = isEv
      ? evAmount
      : reconciled?.amount ?? null;
    const candidateUnitPrice = isEv
      ? evUnitPrice
      : reconciled?.unitPrice ?? null;
    const candidateTotal = isEv
      ? evTotalCost
      : reconciled?.totalCost ?? null;
    const ctx: CheckContext = {
      candidate: {
        id: editingId ?? null,
        date: form.date,
        odometer: Math.round(odometerNum!),
        vehicleType,
        partial: form.partial,
        missed: form.missed,
        gasLiters: isEv ? null : candidateAmount,
        gasPricePerLiter: isEv ? null : candidateUnitPrice,
        kWhCharged: isEv ? candidateAmount : null,
        kWhPrice: isEv ? candidateUnitPrice : null,
        totalCost: candidateTotal,
        phevKwhPer100Km: isPhev ? toNumOrNull(form.phevKwhPer100Km) : null,
        phevKwhPrice: isPhev ? toNumOrNull(form.phevKwhPrice) : null,
      },
      otherEntries: vehicleHistory,
      thresholds: {
        consumptionPercent: settings.warnConsumptionPercent,
        pricePercent: settings.warnPricePercent,
        distanceMultiplier: settings.warnDistanceMultiplier,
        duplicateMinutes: settings.warnDuplicateMinutes,
        duplicateKm: settings.warnDuplicateKm,
      },
    };
    return runAllChecks(ctx);
  }, [
    form.vehicleId,
    form.date,
    form.partial,
    form.missed,
    form.phevKwhPer100Km,
    form.phevKwhPrice,
    odometerOk,
    odometerNum,
    costOk,
    isEv,
    isPhev,
    evAmount,
    evUnitPrice,
    evTotalCost,
    reconciled,
    editingId,
    vehicleType,
    vehicleHistory,
    settings.warnConsumptionPercent,
    settings.warnPricePercent,
    settings.warnDistanceMultiplier,
    settings.warnDuplicateMinutes,
    settings.warnDuplicateKm,
  ]);

  // Index warnings by field so each input can render its own inline help.
  const warningsByField = useMemo(() => {
    const map: Partial<Record<Warning['field'], Warning>> = {};
    for (const w of warnings) {
      // First warning per field wins (only one displayed inline anyway).
      if (!map[w.field]) map[w.field] = w;
    }
    return map;
  }, [warnings]);




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
    // Surface all consistency warnings in one dialog so the user can
    // review them before committing. Never blocks the save — "Cancel" in
    // the dialog aborts, "OK" proceeds. If nothing fired, this is a no-op.
    if (warnings.length > 0) {
      const lines = warnings.map((w) => '• ' + w.message).join('\n');
      const ok = confirm(
        `Heads up — the following looks unusual:\n\n${lines}\n\nSave anyway?`,
      );
      if (!ok) return;
    }


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
        {warningsByField.date && (
          <WarningHint message={warningsByField.date.message} />
        )}
        {warningsByField.duplicate && (
          <WarningHint message={warningsByField.duplicate.message} />
        )}

        <OdometerField
          value={form.odometer}
          onChange={(v) => setForm({ ...form, odometer: v })}
          previous={previousOdometer}
          showError={errors.odometer}
          showWarning={!!odometerWarn && !errors.odometer}
        />
        {warningsByField.odometer && (
          <WarningHint message={warningsByField.odometer.message} />
        )}

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
        {warningsByField.unitPrice && (
          <WarningHint message={warningsByField.unitPrice.message} />
        )}
        {warningsByField.consumption && (
          <WarningHint message={warningsByField.consumption.message} />
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

// Inline soft-warning shown under whichever field a Warning is attached
// to. Styled like the existing odometer warning (input-help in danger
// color) so it slots into the form aesthetic naturally.
function WarningHint({ message }: { message: string }) {
  return (
    <div
      className="input-help"
      style={{ color: 'var(--danger)', marginTop: -8, marginLeft: 4 }}
    >
      ⚠ {message}
    </div>
  );
}

// Vehicle selector for the form's top row. Single-select segmented
// control rendered as a horizontal scroll if there are many vehicles.
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

// Native datetime-local input wrapper. The "-webkit-appearance: none" in
// styles.css stops iOS from sizing the input wider than its parent.
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

// Odometer reading row. Shows the current input next to a read-only
// reference field with the previous fill-up's odometer for that vehicle.
// Surfaces both a hard error (empty) and a soft warning (lower than the
// previous reading, which probably means a typo).
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
    <div>
      <div className="field-grid field-grid-2">
        <div className="field">
          <label className="field-label">Odometer (km)</label>
          <div className="field-row">
            <input
              type="text"
              inputMode="numeric"
              className={showError ? 'error' : ''}
              placeholder="0"
              value={value}
              onChange={(e) => onChange(e.target.value)}
            />
            <span className="field-suffix">km</span>
          </div>
        </div>
        <div className="field">
          <label className="field-label">Last odometer</label>
          <div className="field-readonly">
            {previous != null ? `${previous.toLocaleString()} km` : '—'}
          </div>
        </div>
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

// EV-only cost section: kWh charged + price-per-kWh, with the total cost
// computed on the fly for display. Vehicle's defaultElectricityCost (or
// the global fallback) seeds the price-per-kWh field on a fresh entry.
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

// Gas cost section: total / liters / price-per-liter in a 3-column grid.
// 2-of-3 auto-derivation: whenever any two are filled the third is
// computed and shown with a dashed border to indicate it was derived.
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
      <div className="field-grid field-grid-3">
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
          label="Price / l"
          suffix={`${sym}/l`}
          step="0.001"
          derived={derivedField === 'unitPrice'}
          error={errors.unitPrice}
          value={displayValue('unitPrice')}
          onChange={(v) => onChange('unitPrice', v)}
        />
      </div>
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

// One labeled decimal input with a suffix tag for the unit. Visually
// marks "derived" fields with a dashed border so the user can tell at
// a glance which value is being computed for them.
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

// PHEV-only optional section for entering electricity usage SINCE the
// previous full fill-up (read off the car's trip computer that's reset at
// every full). Lets the dashboard treat electricity costs as part of the
// total cost per km even though the user doesn't log charging events
// individually for PHEVs.
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

// Two boolean switches that affect how the entry is treated in stats:
// `partial` means the tank wasn't filled to full (this fuel-up rolls
// into the next full one's interval), `missed` excludes this entry's
// entire interval from stats (use it for the entry AFTER a missed
// fill-up so the suspect distance isn't counted).
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
