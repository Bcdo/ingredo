import type { ConfigContext } from 'expo/config';

import appConfig from '../app.config';

const ctx = { config: {} } as ConfigContext;

describe('app.config', () => {
  const saved = process.env.INGREDO_API_URL;
  afterEach(() => {
    if (saved === undefined) delete process.env.INGREDO_API_URL;
    else process.env.INGREDO_API_URL = saved;
  });

  it('falls back to the emulator URL when INGREDO_API_URL is unset', () => {
    delete process.env.INGREDO_API_URL;
    expect(appConfig(ctx).extra?.apiUrl).toBe('http://10.0.2.2:8080');
  });

  it('uses INGREDO_API_URL when set', () => {
    process.env.INGREDO_API_URL = 'https://api.kodesmien.no';
    expect(appConfig(ctx).extra?.apiUrl).toBe('https://api.kodesmien.no');
  });

  it('carries the app identity', () => {
    const cfg = appConfig(ctx);
    expect(cfg.name).toBe('Ingredo');
    expect(cfg.slug).toBe('ingredo');
    expect(cfg.android?.package).toBe('no.kodesmien.ingredo');
    expect(cfg.android?.versionCode).toBe(1);
    expect(cfg.ios?.bundleIdentifier).toBe('no.kodesmien.ingredo');
    expect(cfg.runtimeVersion).toEqual({ policy: 'sdkVersion' });
  });
});
