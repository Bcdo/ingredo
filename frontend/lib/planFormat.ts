import { dayLabel } from './dates';
import { t } from './i18n';

export function dayHeading(date: string, today: string): string {
  const label = dayLabel(date, today);
  if (label.key === 'today') return t('plan.today');
  if (label.key === 'tomorrow') return t('plan.tomorrow');
  return `${t(`days.${label.weekdayIndex}`)} ${label.dayOfMonth}`;
}
