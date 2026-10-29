import { execFileSync } from 'child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import type { TestProject } from 'vitest/node';

declare module 'vitest' {
    export interface ProvidedContext {
        serviceEntry: string;
    }
}

const REPO = resolve(__dirname, '../..');
const FIXTURE_DEPS = ['express', 'node-cron'];

/**
 * Builds the package the way it is published and installs it next to the
 * fixture service, so the service loads it through the exports map.
 */
export default function setup({ provide }: TestProject): () => void {
    const root = mkdtempSync(join(tmpdir(), 'service-runtime-component-'));
    const packageDir = join(root, 'node_modules', '@jtkunley', 'service-runtime');
    const run = (...args: string[]) => execFileSync(process.execPath, args, { cwd: REPO });

    run(
        require.resolve('typescript/bin/tsc'),
        '-p',
        'tsconfig.build.json',
        '--outDir',
        join(packageDir, 'src'),
    );
    run('scripts/prepare-dist.mjs', packageDir);
    for (const dep of FIXTURE_DEPS) {
        symlinkSync(join(REPO, 'node_modules', dep), join(root, 'node_modules', dep), 'dir');
    }
    mkdirSync(join(root, 'app'));
    const serviceEntry = join(root, 'app', 'service.mts');
    copyFileSync(join(__dirname, 'fixtures', 'service.mts'), serviceEntry);

    provide('serviceEntry', serviceEntry);
    return () => rmSync(root, { recursive: true, force: true });
}
