import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer, optionsFromEnv } from '../src/mcp/server';

const root = path.join(__dirname, '..', '..', 'test');

async function connect(env: Record<string, string>) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'fake-lxc-srv-'));
  writeFileSync(path.join(dir, 'list.json'), readFileSync(path.join(root, 'fixtures', 'list.json')));
  process.env.FAKE_DIR = dir;
  process.env.SEEDPOD_CLI = path.join(root, 'support', 'fake-lxc.sh');
  const server = createServer(optionsFromEnv(env));
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test', version: '0' });
  await Promise.all([server.connect(a), client.connect(b)]);
  return client;
}

test('optionsFromEnv', () => {
  assert.deepEqual(optionsFromEnv({ SEEDPOD_READONLY: '1', SEEDPOD_PROTECT: ' a, b ,,' }), { readOnly: true, protect: ['a', 'b'] });
  assert.deepEqual(optionsFromEnv({}), { readOnly: false, protect: [] });
});

test('tools are listed with annotations and called over MCP', async () => {
  const client = await connect({ SEEDPOD_PROTECT: 'alpha' });
  const { tools } = await client.listTools();
  const names = tools.map((t) => t.name);
  assert.ok(names.includes('list_machines') && names.includes('exec'));
  assert.equal(tools.find((t) => t.name === 'exec')!.annotations?.destructiveHint, true);
  const r: any = await client.callTool({ name: 'list_machines', arguments: {} });
  const data = JSON.parse(r.content[0].text);
  assert.ok(data.machines.some((m: any) => m.name === 'alpha' && m.protected));
  await client.close();
});

test('tool errors come back as isError results, not protocol failures', async () => {
  const client = await connect({ SEEDPOD_PROTECT: 'alpha' });
  const r: any = await client.callTool({ name: 'machine_action', arguments: { machine: 'alpha', action: 'stop' } });
  assert.equal(r.isError, true);
  assert.match(r.content[0].text, /protected/);
  await client.close();
});

test('read-only server exposes no write tools', async () => {
  const client = await connect({ SEEDPOD_READONLY: '1' });
  const { tools } = await client.listTools();
  assert.ok(tools.every((t) => t.annotations?.readOnlyHint === true));
  await client.close();
});
