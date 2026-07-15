import { t } from './i18n';
import { isLocalizableUnit } from './units';

export function unitLabel(unit: string | null): string {
  if (unit === null) return '';
  return isLocalizableUnit(unit) ? t(`units.${unit}`) : unit;
}
