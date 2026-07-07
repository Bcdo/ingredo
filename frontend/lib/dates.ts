// Plan dates are local calendar facts stored as 'YYYY-MM-DD' strings.
// All arithmetic goes through local Date at noon, which is immune to DST
// transitions shifting the calendar day.

export function todayLocal(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number);
  return todayLocal(new Date(y, m - 1, d + n, 12));
}

export function rollingWeek(start: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

export type DayLabel = {
  key: 'today' | 'tomorrow' | 'weekday';
  weekdayIndex: number; // ISO: 0 = Monday … 6 = Sunday
  dayOfMonth: number;
};

export function dayLabel(date: string, today: string): DayLabel {
  const [y, m, d] = date.split('-').map(Number);
  const weekdayIndex = (new Date(y, m - 1, d, 12).getDay() + 6) % 7;
  const key = date === today ? 'today' : date === addDays(today, 1) ? 'tomorrow' : 'weekday';
  return { key, weekdayIndex, dayOfMonth: d };
}
