import type { ExpressionSpecification, LineLayerSpecification } from 'maplibre-gl';
import { transportModeColorExpression } from './transportModeStyle';

export const TRANSPORT_PATH_DEFAULT_OPACITY: ExpressionSpecification = [
  'interpolate',
  ['linear'],
  ['zoom'],
  7,
  ['case', ['boolean', ['feature-state', 'hover'], false], 0.96, 0.5],
  11,
  ['case', ['boolean', ['feature-state', 'hover'], false], 0.96, 0.64],
  14,
  ['case', ['boolean', ['feature-state', 'hover'], false], 0.96, 0.74],
  18,
  ['case', ['boolean', ['feature-state', 'hover'], false], 0.96, 0.82],
];

/** Valid MapLibre expressions: zoom interpolation must remain at the expression root. */
export function transportRouteLinePaint(): LineLayerSpecification['paint'] {
  return {
    'line-color': transportModeColorExpression(),
    'line-width': [
      'interpolate',
      ['linear'],
      ['zoom'],
      7,
      ['case', ['boolean', ['feature-state', 'hover'], false], 2.2, 1.1],
      11,
      ['case', ['boolean', ['feature-state', 'hover'], false], 2.8, 1.6],
      14,
      ['case', ['boolean', ['feature-state', 'hover'], false], 3.7, 2.4],
      18,
      ['case', ['boolean', ['feature-state', 'hover'], false], 5, 3.6],
    ],
    'line-opacity': TRANSPORT_PATH_DEFAULT_OPACITY,
  };
}
