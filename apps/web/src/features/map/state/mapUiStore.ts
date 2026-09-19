import { create } from 'zustand';
import type { PlaceLanguageMode } from '@/features/poi/api/publicMapApi';
import type { MapMode } from '@/features/map/config';
import { persistMapMode, readPersistedMapMode } from '@/features/map/config/mapModeStorage';

export type MapUtilityAction = 'zoomIn' | 'zoomOut' | 'centerKyauktan';
export type TransportBrowseMode = 'bus' | 'train' | 'express';

export type TransportVisibility = {
  readonly points: boolean;
  readonly paths: boolean;
};

export const TRANSPORT_MODE_DEFAULTS: Readonly<Record<TransportBrowseMode, TransportVisibility>> = {
  bus: { points: true, paths: true },
  train: { points: true, paths: true },
  express: { points: true, paths: true },
};

type MapUtilityCommand = {
  readonly id: number;
  readonly action: MapUtilityAction;
};

type MapUiState = {
  readonly languageMode: PlaceLanguageMode;
  readonly mapMode: MapMode;
  readonly basemapModeError: string | null;
  readonly utilityCommand: MapUtilityCommand | null;
  readonly transportMode: TransportBrowseMode | null;
  readonly transportPointsVisible: boolean;
  readonly transportPathsVisible: boolean;
  readonly transportVisibilityByMode: Readonly<Record<TransportBrowseMode, TransportVisibility>>;
  setLanguageMode: (mode: PlaceLanguageMode) => void;
  setMapMode: (mode: MapMode) => void;
  setBasemapModeError: (message: string | null) => void;
  dispatchUtilityAction: (action: MapUtilityAction) => void;
  setTransportMode: (mode: TransportBrowseMode | null) => void;
  setTransportPointsVisible: (visible: boolean) => void;
  setTransportPathsVisible: (visible: boolean) => void;
};

const initialMapMode = readPersistedMapMode() ?? 'normal';
const LANGUAGE_STORAGE_KEY = 'coremap:map-language';

function readPersistedLanguageMode(): PlaceLanguageMode {
  if (typeof localStorage === 'undefined') return 'my';
  try {
    const value = localStorage.getItem(LANGUAGE_STORAGE_KEY);
    return value === 'en' || value === 'both' || value === 'my' ? value : 'my';
  } catch {
    return 'my';
  }
}

function persistLanguageMode(mode: PlaceLanguageMode): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, mode);
  } catch {
    /* Storage can be unavailable in private browsing. */
  }
}

/** Global map UI: language mode drives MapLibre `text-field` + React labels (API returns bilingual fields). */
export const useMapUiStore = create<MapUiState>((set) => ({
  languageMode: readPersistedLanguageMode(),
  mapMode: initialMapMode,
  basemapModeError: null,
  utilityCommand: null,
  transportMode: null,
  transportPointsVisible: false,
  transportPathsVisible: false,
  transportVisibilityByMode: TRANSPORT_MODE_DEFAULTS,
  setLanguageMode: (mode) => {
    persistLanguageMode(mode);
    set({ languageMode: mode });
  },
  setMapMode: (mode) => {
    persistMapMode(mode);
    set({ mapMode: mode, basemapModeError: null });
  },
  setBasemapModeError: (message) => set({ basemapModeError: message }),
  dispatchUtilityAction: (action) =>
    set((state) => ({
      utilityCommand: {
        id: (state.utilityCommand?.id ?? 0) + 1,
        action,
      },
    })),
  setTransportMode: (mode) =>
    set((state) =>
      mode === null
        ? { transportMode: null, transportPointsVisible: false, transportPathsVisible: false }
        : {
            transportMode: mode,
            transportPointsVisible: state.transportVisibilityByMode[mode].points,
            transportPathsVisible: state.transportVisibilityByMode[mode].paths,
          },
    ),
  setTransportPointsVisible: (visible) =>
    set((state) => ({
      transportPointsVisible: visible,
      transportVisibilityByMode: state.transportMode
        ? {
            ...state.transportVisibilityByMode,
            [state.transportMode]: {
              ...state.transportVisibilityByMode[state.transportMode],
              points: visible,
            },
          }
        : state.transportVisibilityByMode,
    })),
  setTransportPathsVisible: (visible) =>
    set((state) => ({
      transportPathsVisible: visible,
      transportVisibilityByMode: state.transportMode
        ? {
            ...state.transportVisibilityByMode,
            [state.transportMode]: {
              ...state.transportVisibilityByMode[state.transportMode],
              paths: visible,
            },
          }
        : state.transportVisibilityByMode,
    })),
}));
