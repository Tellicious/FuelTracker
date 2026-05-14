export type Tab = 'dashboard' | 'records' | 'add' | 'vehicles' | 'settings';

interface Props {
  active: Tab;
  onChange: (t: Tab) => void;
}

function IconDashboard() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      {}
      <path d="M3.5 15 A8.5 8.5 0 0 1 20.5 15" />
      {}
      <path d="M12 15 L16 9" />
      {}
      <circle cx="12" cy="15" r="1.4" fill="currentColor" stroke="none" />
      {}
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
      <path d="
        M4 16
        L2.5 16
        Q2 16 2 15.5
        L2 13
        Q2 12 3 12
        L4.5 12
        L7 6.8
        Q7.5 6 8.5 6
        L15.5 6
        Q16.5 6 17 6.8
        L19.5 12
        L21 12
        Q22 12 22 13
        L22 15.5
        Q22 16 21.5 16
        L20 16
        M16 16 L8 16
      " />
      <circle cx="6" cy="16.5" r="2" />
      <circle cx="18" cy="16.5" r="2" />
    </svg>
  );
}

function IconSettings() {





  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M 12 3 L 14.49 5.99 L 18.36 5.64 L 18.01 9.51 L 21 12 L 18.01 14.49 L 18.36 18.36 L 14.49 18.01 L 12 21 L 9.51 18.01 L 5.64 18.36 L 5.99 14.49 L 3 12 L 5.99 9.51 L 5.64 5.64 L 9.51 5.99 Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

// Bottom navigation bar — five icon buttons (Dashboard / Records / Add /
// Vehicles / Settings) with the centre Add button raised and tinted in
// the brand accent colour. Pinned to the bottom of the viewport with
// safe-area-inset padding so it sits above the home-bar gesture area on
// iPhones without notch-less display.
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
