import { addDays, dayLabel, rollingWeek, todayLocal } from '../lib/dates';

describe('todayLocal', () => {
  it('formats a local date as YYYY-MM-DD', () => {
    expect(todayLocal(new Date(2026, 6, 7))).toBe('2026-07-07');
  });

  it('pads single-digit month and day', () => {
    expect(todayLocal(new Date(2026, 0, 3))).toBe('2026-01-03');
  });
});

describe('addDays', () => {
  it('adds within a month', () => {
    expect(addDays('2026-07-07', 3)).toBe('2026-07-10');
  });

  it('rolls over month ends', () => {
    expect(addDays('2026-07-29', 4)).toBe('2026-08-02');
  });

  it('rolls over year ends', () => {
    expect(addDays('2026-12-30', 3)).toBe('2027-01-02');
  });

  it('handles leap-year February', () => {
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
  });

  it('supports negative offsets', () => {
    expect(addDays('2026-08-02', -4)).toBe('2026-07-29');
  });
});

describe('rollingWeek', () => {
  it('returns seven consecutive dates starting at start', () => {
    expect(rollingWeek('2026-07-29')).toEqual([
      '2026-07-29',
      '2026-07-30',
      '2026-07-31',
      '2026-08-01',
      '2026-08-02',
      '2026-08-03',
      '2026-08-04',
    ]);
  });
});

describe('dayLabel', () => {
  const today = '2026-07-07'; // a Tuesday

  it('labels today', () => {
    expect(dayLabel('2026-07-07', today)).toEqual({
      key: 'today',
      weekdayIndex: 1,
      dayOfMonth: 7,
    });
  });

  it('labels tomorrow', () => {
    expect(dayLabel('2026-07-08', today)).toEqual({
      key: 'tomorrow',
      weekdayIndex: 2,
      dayOfMonth: 8,
    });
  });

  it('labels other days with ISO weekday index (0 = Monday)', () => {
    expect(dayLabel('2026-07-12', today)).toEqual({
      key: 'weekday',
      weekdayIndex: 6,
      dayOfMonth: 12,
    });
    expect(dayLabel('2026-07-13', today)).toEqual({
      key: 'weekday',
      weekdayIndex: 0,
      dayOfMonth: 13,
    });
  });
});
