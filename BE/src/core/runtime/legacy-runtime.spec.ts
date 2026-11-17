import path from 'path';
import { legacyFilesUploadsDir, legacyRoot } from './legacy-runtime';

describe('legacy runtime root', () => {
  it.each([
    ['compiled', '/srv/BE/dist/src/core/runtime', '/srv/BE/dist/legacy'],
    ['ts-node', '/srv/BE/src/core/runtime', '/srv/BE/legacy'],
  ])('%s: cwd/uploads (multer) == utils/files.ts uploads dir', (_n, dir, root) => {
    expect(legacyRoot(dir)).toBe(root);
    expect(legacyFilesUploadsDir(legacyRoot(dir))).toBe(path.join(root, 'uploads'));
  });
});
