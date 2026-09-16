/**
 * DEV-only badge for local PMTiles QA mode. Never rendered in production builds.
 */
import { useEffect, useState } from 'react';
import {
  getLocalPmtilesQaActivePackageCount,
  getLocalPmtilesQaAvailablePackageKeys,
  getLastLoadedLocalPmtilesQaManifest,
  getLocalPmtilesQaCompositionMode,
  getLocalPmtilesQaPackageFilter,
  isLoadAllLocalRegionPmtilesQaEnabled,
  LOCAL_PMTILES_QA_REGIONAL_NATIVE_MAX_ZOOM,
  LOCAL_PMTILES_QA_REGIONAL_NATIVE_MIN_ZOOM,
  type LocalPmtilesQaCompositionMode,
  type LocalPmtilesQaManifest,
} from '../lib/maplibre/localRegionPmtilesQa';

type Props = {
  readonly cameraZoom?: number | null;
  readonly errorCount?: number;
  readonly loadError?: string | null;
  /** Full manifest package keys (for the tiny DEV selector). */
  readonly availablePackageKeys?: readonly string[];
};

function applyQaPackageQuery(packageKey: string): void {
  const url = new URL(window.location.href);
  url.searchParams.delete('qaStress');
  if (!packageKey || packageKey === 'parity') {
    url.searchParams.delete('qaPackage');
  } else if (packageKey === 'stress' || packageKey === 'all') {
    url.searchParams.set('qaPackage', 'all');
  } else {
    url.searchParams.set('qaPackage', packageKey);
  }
  window.location.assign(url.toString());
}

export function LocalPmtilesQaBadge({
  cameraZoom = null,
  errorCount = 0,
  loadError = null,
  availablePackageKeys = [],
}: Props) {
  const [manifest, setManifest] = useState<LocalPmtilesQaManifest | null>(null);
  const [packageFilter, setPackageFilter] = useState<string | null>(null);
  const [availableKeys, setAvailableKeys] = useState<string[]>([]);
  const [mode, setMode] = useState<LocalPmtilesQaCompositionMode>('parity');
  const [activeCount, setActiveCount] = useState(0);

  useEffect(() => {
    if (!isLoadAllLocalRegionPmtilesQaEnabled()) return;
    const tick = () => {
      setManifest(getLastLoadedLocalPmtilesQaManifest());
      setPackageFilter(getLocalPmtilesQaPackageFilter());
      setAvailableKeys([...getLocalPmtilesQaAvailablePackageKeys()]);
      setMode(getLocalPmtilesQaCompositionMode());
      setActiveCount(getLocalPmtilesQaActivePackageCount());
    };
    tick();
    const id = window.setInterval(tick, 400);
    return () => window.clearInterval(id);
  }, []);

  if (!import.meta.env.DEV || !isLoadAllLocalRegionPmtilesQaEnabled()) {
    return null;
  }

  const zoomText =
    typeof cameraZoom === 'number' && Number.isFinite(cameraZoom)
      ? `z${cameraZoom.toFixed(1)}`
      : 'z…';
  const selectorKeys =
    availablePackageKeys.length > 0
      ? availablePackageKeys
      : availableKeys.length > 0
        ? availableKeys
        : (manifest?.packages ?? []).map((pkg) => pkg.key);

  const selectValue =
    mode === 'stress' ? 'stress' : packageFilter ? packageFilter : 'parity';

  return (
    <div
      role="status"
      style={{
        position: 'absolute',
        top: 10,
        left: 10,
        zIndex: 20,
        maxWidth: 'min(320px, 92vw)',
        padding: '8px 10px',
        borderRadius: 6,
        background: errorCount > 0 || loadError ? 'rgba(120, 20, 20, 0.9)' : 'rgba(20, 40, 30, 0.9)',
        color: '#f4f7f5',
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        fontSize: 11,
        lineHeight: 1.35,
        pointerEvents: 'none',
        boxShadow: '0 1px 4px rgba(0,0,0,0.35)',
      }}
    >
      <div style={{ fontWeight: 700, letterSpacing: '0.04em' }}>LOCAL PMTILES QA</div>
      <div>camera {zoomText}</div>
      <div>
        native z{LOCAL_PMTILES_QA_REGIONAL_NATIVE_MIN_ZOOM}-z
        {LOCAL_PMTILES_QA_REGIONAL_NATIVE_MAX_ZOOM}
      </div>
      <div>
        active packages {activeCount}
        {mode === 'parity' ? ' · viewport' : ' · stress'}
      </div>
      <div>errors {errorCount}</div>
      {loadError ? <div style={{ marginTop: 2 }}>{loadError}</div> : null}
      {selectorKeys.length > 0 ? (
        <label
          style={{
            display: 'flex',
            gap: 6,
            alignItems: 'center',
            marginTop: 6,
            pointerEvents: 'auto',
          }}
        >
          <span>mode</span>
          <select
            aria-label="QA package mode"
            value={selectValue}
            onChange={(event) => applyQaPackageQuery(event.target.value)}
            style={{
              flex: 1,
              minWidth: 0,
              font: 'inherit',
              color: '#111',
              background: '#f4f7f5',
              border: 'none',
              borderRadius: 3,
              padding: '2px 4px',
            }}
          >
            <option value="parity">viewport (parity)</option>
            <option value="stress">all packages (stress)</option>
            {selectorKeys.map((key) => (
              <option key={key} value={key}>
                {key} only
              </option>
            ))}
          </select>
        </label>
      ) : null}
    </div>
  );
}
