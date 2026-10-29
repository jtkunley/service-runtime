import { execFileSync } from 'child_process';
import { realpathSync } from 'fs';
import { createRequire } from 'module';
import { dirname, join } from 'path';
import { describe, expect, inject, it } from 'vitest';

const appDir = dirname(inject('serviceEntry'));
const packageDir = join(appDir, '..', 'node_modules', 'service-runtime');
const consumerRequire = createRequire(join(appDir, 'consumer.js'));

function loadsNodeCron(entry: string): boolean {
    const script = `require('${entry}'); process.stdout.write(String(Object.keys(require.cache).some((file) => file.includes('/node-cron/'))));`;
    return execFileSync(process.execPath, ['-e', script], { cwd: appDir }).toString() === 'true';
}

describe('the installed package', () => {
    // node-cron is the package's only runtime dependency; only ./cron may load it.
    it('loads node-cron only through ./cron', () => {
        expect(loadsNodeCron('service-runtime')).toBe(false);
        expect(loadsNodeCron('service-runtime/cron')).toBe(true);
    });

    it.each([
        ['', 'src/index.js'],
        ['/cron', 'src/lib/cron/cron.js'],
        ['/tier', 'src/lib/tier/tier.js'],
        ['/package.json', 'package.json'],
    ])('resolves service-runtime%s', (subpath, file) => {
        expect(realpathSync(consumerRequire.resolve(`service-runtime${subpath}`))).toBe(
            realpathSync(join(packageDir, file)),
        );
    });

    it.each([
        '/lifecycle',
        '/context',
        '/src',
        '/src/index',
        '/src/lib/cron/cron',
        '/src/lib/lifecycle/gracefulShutdown.js',
    ])('does not expose service-runtime%s', (subpath) => {
        expect(() => consumerRequire.resolve(`service-runtime${subpath}`)).toThrow(
            expect.objectContaining({ code: 'ERR_PACKAGE_PATH_NOT_EXPORTED' }) as Error,
        );
    });
});
