import Constants from 'expo-constants';

import { getApiBaseUrl, getApiUrlOverride, setApiUrlOverride } from '../lib/api/config';
import { makeTestDb } from './helpers/testDb';

describe('api config', () => {
  it('defaults to the app config apiUrl with trailing slash stripped', () => {
    const db = makeTestDb();
    const expoConfig = Constants.expoConfig as { extra?: Record<string, unknown> } | null;
    const previous = expoConfig?.extra?.apiUrl;
    if (expoConfig) expoConfig.extra = { ...expoConfig.extra, apiUrl: 'http://example.test:8080/' };
    expect(getApiBaseUrl(db)).toBe('http://example.test:8080');
    if (expoConfig) expoConfig.extra = { ...expoConfig.extra, apiUrl: previous };
  });

  it('prefers a stored override over the app config', () => {
    const db = makeTestDb();
    setApiUrlOverride(db, 'http://192.168.1.50:8080/');
    expect(getApiUrlOverride(db)).toBe('http://192.168.1.50:8080/');
    expect(getApiBaseUrl(db)).toBe('http://192.168.1.50:8080');
  });

  it('clearing the override falls back again', () => {
    const db = makeTestDb();
    setApiUrlOverride(db, 'http://192.168.1.50:8080');
    setApiUrlOverride(db, null);
    expect(getApiUrlOverride(db)).toBeNull();
  });

  it('treats blank input as clearing', () => {
    const db = makeTestDb();
    setApiUrlOverride(db, 'http://192.168.1.50:8080');
    setApiUrlOverride(db, '   ');
    expect(getApiUrlOverride(db)).toBeNull();
  });
});
