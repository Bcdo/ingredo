// Canonical unit codes. Stored in the DB; labels are localized via i18n
// (keys `units.<code>`). 'ts'/'ss'/'stk' follow Norwegian kitchen convention
// but are codes, not display text.
export const UNITS = ['g', 'kg', 'ml', 'dl', 'l', 'ts', 'ss', 'stk'] as const;
export type UnitCode = (typeof UNITS)[number];
