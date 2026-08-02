import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const assets = join(__dirname, '../assets');

function pngSize(file: string): { width: number; height: number } {
  const buf = readFileSync(join(assets, file));
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

describe('icon assets', () => {
  it.each(['icon.png', 'adaptive-icon.png', 'splash.png'])('%s is 1024×1024', (file) => {
    expect(pngSize(file)).toEqual({ width: 1024, height: 1024 });
  });

  it('the unused favicon is gone', () => {
    expect(existsSync(join(assets, 'favicon.png'))).toBe(false);
  });
});
