import { spawn, type ChildProcess } from 'child_process';
import { createInterface } from 'readline';
import { inject } from 'vitest';

export interface LogLine {
    level: string;
    module: string;
    action: string;
    message: string;
    error?: string;
    [key: string]: unknown;
}

export interface FixtureEnv {
    DEFAULT_TENANT_ID?: string;
    CRON_RUN_MS?: string;
    CRON_FAIL?: string;
    FAIL_CLEANUP?: string;
    FORCE_EXIT_MS?: string;
    SHUTDOWN_DELAY_MS?: string;
    TIER?: string;
}

export interface RunningService {
    url: string;
    logs: LogLine[];
    /** Resolves with the exit code once the process has exited. */
    exited: Promise<number | null>;
    messages(): string[];
    waitForLog(message: string): Promise<LogLine>;
    signal(signal: NodeJS.Signals): void;
}

const LOG_TIMEOUT_MS = 5_000;
const running = new Set<ChildProcess>();

export async function startService(fixtureEnv: FixtureEnv = {}): Promise<RunningService> {
    const child = spawn(process.execPath, [inject('serviceEntry')], {
        env: { PATH: process.env['PATH'], ...fixtureEnv },
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    running.add(child);

    const logs: LogLine[] = [];
    const listeners = new Set<() => void>();
    let stderr = '';
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
    createInterface({ input: child.stdout }).on('line', (line) => {
        logs.push(JSON.parse(line) as LogLine);
        for (const listener of listeners) listener();
    });

    let exitCode: number | null | undefined;
    const exited = new Promise<number | null>((resolve) => {
        child.on('exit', (code) => {
            running.delete(child);
            exitCode = code;
            for (const listener of listeners) listener();
            resolve(code);
        });
    });

    const waitForLog = (message: string): Promise<LogLine> =>
        new Promise((resolve, reject) => {
            const timer = setTimeout(
                () => fail(`Timed out waiting for log "${message}"`),
                LOG_TIMEOUT_MS,
            );
            const check = () => {
                const found = logs.find((log) => log.message === message);
                if (found) done(() => resolve(found));
                else if (exitCode !== undefined) {
                    fail(`Exited ${String(exitCode)} before logging "${message}"`);
                }
            };
            const done = (settle: () => void) => {
                clearTimeout(timer);
                listeners.delete(check);
                settle();
            };
            const fail = (reason: string) =>
                done(() => reject(new Error(`${reason}\nstderr:\n${stderr}`)));
            listeners.add(check);
            check();
        });

    const listening = await waitForLog('Listening');
    return {
        url: `http://127.0.0.1:${String(listening['port'])}`,
        logs,
        exited,
        messages: () => logs.map((log) => log.message),
        waitForLog,
        signal: (signal) => child.kill(signal),
    };
}

export function stopServices(): void {
    for (const child of running) child.kill('SIGKILL');
    running.clear();
}
