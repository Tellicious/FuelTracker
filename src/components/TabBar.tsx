export type Tab = 'dashboard' | 'records' | 'add' | 'vehicles' | 'settings';

interface Props {
  active: Tab;
  onChange: (t: Tab) => void;
}

/*
 * Tab-bar icons. All five share the same visual language: 24×24 viewBox,
 * stroke-only (no fills), uniform stroke-width via CSS. This replaces the
 * earlier unicode glyphs, where the gear ⚙ was rendered as a color emoji by
 * iOS while the others (◐ ≡ ◇) stayed as monochrome geometric symbols —
 * which is what made Settings visually stick out.
 *
 * Icon choices:
 *   - Dashboard → speedometer / gauge (semicircle + needle)
 *       on-theme for a fuel-tracking app; reads as "instrument panel"
 *   - Records   → bullet list (dots + lines)
 *       reads as "entries" / "history" without colliding with a hamburger nav
 *   - Add       → plus, kept as the centerpiece pill
 *   - Vehicles  → side-profile car silhouette with two wheels
 *   - Settings  → gear/cogwheel as line art (NOT the ⚙ emoji)
 */

function IconDashboard() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      {/* Semicircular gauge */}
      <path d="M3.5 15 A8.5 8.5 0 0 1 20.5 15" />
      {/* Needle from pivot, pointing up-right */}
      <path d="M12 15 L16 9" />
      {/* Pivot — filled so it reads as the dial center */}
      <circle cx="12" cy="15" r="1.4" fill="currentColor" stroke="none" />
      {/* Two minor tick marks for "speedometer" feel */}
      <path d="M5.5 11.5 L6.5 12" />
      <path d="M18.5 11.5 L17.5 12" />
    </svg>
  );
}

function IconRecords() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="5.5" cy="6.5" r="1.2" fill="currentColor" stroke="none" />
      <path d="M9 6.5 L20 6.5" />
      <circle cx="5.5" cy="12" r="1.2" fill="currentColor" stroke="none" />
      <path d="M9 12 L20 12" />
      <circle cx="5.5" cy="17.5" r="1.2" fill="currentColor" stroke="none" />
      <path d="M9 17.5 L20 17.5" />
    </svg>
  );
}

function IconAdd() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 6 L12 18" />
      <path d="M6 12 L18 12" />
    </svg>
  );
}

function IconVehicles() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      {/* Cabin / roof line */}
      <path d="M6 12 L7.5 7.5 Q8 6.5 9 6.5 L15 6.5 Q16 6.5 16.5 7.5 L18 12" />
      {/* Body */}
      <path d="M3 16 L3 13 Q3 12 4 12 L20 12 Q21 12 21 13 L21 16" />
      {/* Underbody */}
      <path d="M3 16 L21 16" />
      {/* Wheels */}
      <circle cx="7.5" cy="16" r="1.7" />
      <circle cx="16.5" cy="16" r="1.7" />
    </svg>
  );
}

function IconSettings() {
  // Toothed cog. 16 vertices around (12,12), alternating between an outer
  // radius (tooth tip, r=9) and an inner radius (gap between teeth, r=6.5),
  // every 22.5°. Combined with the inner axle-hole circle, this reads as a
  // gear (not a sun, which was the problem with the previous radial-lines
  // version). Coordinates pre-computed from r·cos(θ), r·sin(θ).
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M 12 3 L 14.49 5.99 L 18.36 5.64 L 18.01 9.51 L 21 12 L 18.01 14.49 L 18.36 18.36 L 14.49 18.01 L 12 21 L 9.51 18.01 L 5.64 18.36 L 5.99 14.49 L 3 12 L 5.99 9.51 L 5.64 5.64 L 9.51 5.99 Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

export function TabBar({ active, onChange }: Props) {
  return (
    <nav className="tabbar" role="navigation">
      <button
        className={active === 'dashboard' ? 'active' : ''}
        onClick={() => onChange('dashboard')}
        aria-label="Dashboard"
      >
        <span className="tab-icon"><IconDashboard /></span>
        <span>Dashboard</span>
      </button>
      <button
        className={active === 'records' ? 'active' : ''}
        onClick={() => onChange('records')}
        aria-label="Records"
      >
        <span className="tab-icon"><IconRecords /></span>
        <span>Records</span>
      </button>
      <button
        className="tab-add"
        onClick={() => onChange('add')}
        aria-label="Add entry"
      >
        <span className="tab-icon"><IconAdd /></span>
        <span>Add</span>
      </button>
      <button
        className={active === 'vehicles' ? 'active' : ''}
        onClick={() => onChange('vehicles')}
        aria-label="Vehicles"
      >
        <span className="tab-icon"><IconVehicles /></span>
        <span>Vehicles</span>
      </button>
      <button
        className={active === 'settings' ? 'active' : ''}
        onClick={() => onChange('settings')}
        aria-label="Settings"
      >
        <span className="tab-icon"><IconSettings /></span>
        <span>Settings</span>
      </button>
    </nav>
  );
}
