/**
 * Tourism report options for the existing POST /reports feedback contract.
 * Reuses closed_or_removed + duplicate_item; adds tourism-specific codes.
 */
export const TOURISM_REPORT_TYPE_OPTIONS = [
  { code: 'tourism_incorrect_type', label: 'Incorrect tourism type' },
  { code: 'tourism_incorrect_description', label: 'Incorrect description' },
  { code: 'tourism_incorrect_price', label: 'Incorrect price level' },
  { code: 'closed_or_removed', label: 'Place is closed' },
  { code: 'duplicate_item', label: 'Duplicate tourism place' },
  { code: 'tourism_incorrect_review', label: 'Incorrect rating or review' },
  { code: 'tourism_other', label: 'Other tourism information' },
] as const;

export type TourismReportTypeCode = (typeof TOURISM_REPORT_TYPE_OPTIONS)[number]['code'];
