import { realpathSync } from 'fs';
import { createRequire } from 'module';
import { dirname, join } from 'path';
import { describe, expect, inject, it } from 'vitest';

const appDir = dirname(inject('serviceEntry'));
const packageDir = join(appDir, '..', 'node_modules', '@jtkunley', 'service-runtime');
const consumerRequire = createRequire(join(appDir, 'consumer.js'));

describe('the installed package', () => {
    // Every service installs this package, so it pulls in nothing else.
    it('has no runtime dependencies', () => {
        const manifest = consumerRequire('@jtkunley/service-runtime/package.json') as {
            dependencies?: object;
        };

        expect(manifest.dependencies ?? {}).toEqual({});
    });

    it.each([
        ['', 'src/index.js'],
        ['/tier', 'src/lib/tier/tier.js'],
        ['/package.json', 'package.json'],
    ])('resolves @jtkunley/service-runtime%s', (subpath, file) => {
        expect(realpathSync(consumerRequire.resolve(`@jtkunley/service-runtime${subpath}`))).toBe(
            realpathSync(join(packageDir, file)),
        );
    });

    it.each([
        '/lifecycle',
        '/context',
        '/src',
        '/src/index',
        '/cron',
        '/src/lib/lifecycle/gracefulShutdown.js',
    ])('does not expose @jtkunley/service-runtime%s', (subpath) => {
        expect(() => consumerRequire.resolve(`@jtkunley/service-runtime${subpath}`)).toThrow(
            expect.objectContaining({ code: 'ERR_PACKAGE_PATH_NOT_EXPORTED' }) as Error,
        );
    });
});
