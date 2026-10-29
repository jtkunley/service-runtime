import {
    copyFileSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    realpathSync,
    rmSync,
    writeFileSync,
} from 'fs';
import { createRequire } from 'module';
import { tmpdir } from 'os';
import { dirname, join, resolve } from 'path';
import { describe, expect, it } from 'vitest';
import * as rootEntry from '..';
import * as cronEntry from '../lib/cron/cron';
import * as tierEntry from '../lib/tier/tier';

const SRC = resolve(__dirname, '..');

function importGraph(entry: string): string[] {
    const seen = new Set<string>();
    const visit = (file: string): void => {
        if (seen.has(file)) return;
        seen.add(file);
        const source = readFileSync(file, 'utf8');
        for (const [, spec] of source.matchAll(/from '(\.[^']+)'/g)) {
            if (spec === undefined) continue;
            visit(join(dirname(file), `${spec.replace(/\.js$/, '')}.ts`));
        }
    };
    visit(join(SRC, entry));
    return [...seen].map((file) => file.slice(SRC.length + 1));
}

describe('what each entry loads', () => {
    // node-cron is the package's only runtime dependency; only ./cron may load it.
    it('the root loads nothing from lib/cron', () => {
        expect(
            importGraph('index.ts').some((file) => file.startsWith('lib/cron/')),
        ).toBe(false);
    });

    it('./tier loads nothing else of the package', () => {
        expect(importGraph('lib/tier/tier.ts')).toEqual(['lib/tier/tier.ts']);
    });
});

describe('what each entry exports', () => {
    it('the root exports the lifecycle, request context and tier pieces', () => {
        expect(Object.keys(rootEntry).sort()).toEqual(
            [
                'createShutdownState',
                'registerFatalHandlers',
                'setupGracefulShutdown',
                'CORRELATION_ID_HEADER',
                'MISSING_CORRELATION_WARN',
                'MISSING_ORG_ERROR',
                'ORGANIZATION_ID_HEADER',
                'createExpressMiddleware',
                'createFetchWrapper',
                'createKoaMiddleware',
                'getCorrelationId',
                'getOrganizationId',
                'getStore',
                'run',
                'NON_PROD_TIER_PATTERN',
                'PROD_TIER_PATTERN',
                'getTier',
                'isNonProdTier',
                'isProdTier',
            ].sort(),
        );
    });

    it('./cron exports createCron', () => {
        expect(Object.keys(cronEntry)).toEqual(['createCron']);
    });

    it('./tier exports the tier pieces', () => {
        expect(Object.keys(tierEntry).sort()).toEqual(
            [
                'NON_PROD_TIER_PATTERN',
                'PROD_TIER_PATTERN',
                'getTier',
                'isNonProdTier',
                'isProdTier',
            ].sort(),
        );
    });
});

describe('an installed copy of the package', () => {
    const SHIPPED = [
        'src/index.js',
        'src/lib/cron/cron.js',
        'src/lib/tier/tier.js',
        'src/lib/lifecycle/gracefulShutdown.js',
    ];

    function withInstalledPackage(
        test: (require: NodeJS.Require, pkg: string) => void,
    ): void {
        const root = mkdtempSync(join(tmpdir(), 'service-runtime-exports-'));
        try {
            const pkg = join(root, 'node_modules', 'service-runtime');
            for (const shipped of SHIPPED) {
                mkdirSync(dirname(join(pkg, shipped)), { recursive: true });
                writeFileSync(join(pkg, shipped), '');
            }
            copyFileSync(join(SRC, '..', 'package.json'), join(pkg, 'package.json'));
            test(createRequire(join(root, 'consumer.js')), pkg);
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    }

    it.each([
        ['', 'src/index.js'],
        ['/cron', 'src/lib/cron/cron.js'],
        ['/tier', 'src/lib/tier/tier.js'],
        ['/package.json', 'package.json'],
    ])('resolves service-runtime%s', (subpath, file) => {
        withInstalledPackage((require, pkg) => {
            expect(
                realpathSync(require.resolve(`service-runtime${subpath}`)),
            ).toBe(realpathSync(join(pkg, file)));
        });
    });

    it.each([
        '/lifecycle',
        '/context',
        '/server',
        '/src',
        '/src/index',
        '/src/lib/cron/cron',
        '/src/lib/lifecycle/gracefulShutdown.js',
    ])('does not expose service-runtime%s', (subpath) => {
        withInstalledPackage((require) => {
            expect(() => require.resolve(`service-runtime${subpath}`)).toThrow(
                expect.objectContaining({
                    code: 'ERR_PACKAGE_PATH_NOT_EXPORTED',
                }) as Error,
            );
        });
    });
});
