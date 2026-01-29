import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { loadConfig } from './loader.js';
async function withTempDir(fn) {
    const dir = await mkdtemp(join(tmpdir(), 'config-test-'));
    try {
        await fn(dir);
    }
    finally {
        await rm(dir, { recursive: true });
    }
}
describe('loadConfig', () => {
    it('returns defaults when file is missing', async () => {
        const config = await loadConfig({
            configPath: '/tmp/nonexistent-config-path/server.json',
        });
        expect(config.server.port).toBe(8080);
        expect(config.gatewayUrl).toBe('https://rpc.vana.org');
        expect(config.logging.level).toBe('info');
        expect(config.logging.pretty).toBe(false);
        expect(config.storage.backend).toBe('local');
    });
    it('parses valid config', async () => {
        await withTempDir(async (dir) => {
            const configPath = join(dir, 'server.json');
            await writeFile(configPath, JSON.stringify({
                server: { port: 3000, address: '0xabc' },
                gatewayUrl: 'https://custom.rpc.org',
                logging: { level: 'debug', pretty: true },
                storage: { backend: 'vana' },
            }));
            const config = await loadConfig({ configPath });
            expect(config.server.port).toBe(3000);
            expect(config.server.address).toBe('0xabc');
            expect(config.gatewayUrl).toBe('https://custom.rpc.org');
            expect(config.logging.level).toBe('debug');
            expect(config.logging.pretty).toBe(true);
            expect(config.storage.backend).toBe('vana');
        });
    });
    it('merges partial config with defaults', async () => {
        await withTempDir(async (dir) => {
            const configPath = join(dir, 'server.json');
            await writeFile(configPath, JSON.stringify({
                server: { port: 9090 },
            }));
            const config = await loadConfig({ configPath });
            expect(config.server.port).toBe(9090);
            // Defaults fill in the rest
            expect(config.gatewayUrl).toBe('https://rpc.vana.org');
            expect(config.logging.level).toBe('info');
            expect(config.storage.backend).toBe('local');
        });
    });
    it('throws ZodError for invalid config', async () => {
        await withTempDir(async (dir) => {
            const configPath = join(dir, 'server.json');
            await writeFile(configPath, JSON.stringify({
                server: { port: -1 },
            }));
            await expect(loadConfig({ configPath })).rejects.toThrow();
        });
    });
    it('throws for malformed JSON', async () => {
        await withTempDir(async (dir) => {
            const configPath = join(dir, 'server.json');
            await writeFile(configPath, '{ invalid json }}}');
            await expect(loadConfig({ configPath })).rejects.toThrow(SyntaxError);
        });
    });
    it('accepts custom configPath', async () => {
        await withTempDir(async (dir) => {
            const customPath = join(dir, 'custom-config.json');
            await writeFile(customPath, JSON.stringify({
                logging: { level: 'warn' },
            }));
            const config = await loadConfig({ configPath: customPath });
            expect(config.logging.level).toBe('warn');
            expect(config.server.port).toBe(8080);
        });
    });
});
//# sourceMappingURL=loader.test.js.map