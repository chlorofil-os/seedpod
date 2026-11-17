import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createTools, ToolDef, ToolOptions } from './tools';

export const VERSION = '0.1.0';

export function optionsFromEnv(env: Record<string, string | undefined>): ToolOptions {
  return {
    readOnly: /^(1|true|yes)$/i.test(env.SEEDPOD_READONLY ?? ''),
    protect: (env.SEEDPOD_PROTECT ?? '').split(',').map((s) => s.trim()).filter(Boolean),
  };
}

export function createServer(opts: ToolOptions): McpServer {
  const server = new McpServer(
    { name: 'seedpod', version: VERSION },
    {
      instructions:
        'Local LXD machines and the Docker containers inside them. Start with list_machines, then list_docker for a running machine. ' +
        'Write tools refuse protected machines; there are no delete or restore tools.' +
        (opts.readOnly ? ' This server is read-only.' : ''),
    },
  );
  // registerTool's generic inference over zod shapes recurses past tsc's limit; pin the shape we use.
  const register = server.registerTool.bind(server) as unknown as (
    name: string,
    config: { title: string; description: string; inputSchema: ToolDef['input']; annotations: ToolDef['annotations'] },
    cb: (args: Record<string, unknown>) => Promise<{ content: { type: 'text'; text: string }[]; isError?: boolean }>,
  ) => void;
  for (const t of createTools(opts)) {
    register(t.name, { title: t.title, description: t.description, inputSchema: t.input, annotations: t.annotations }, async (args) => {
      try {
        const result = await t.run(args ?? {});
        return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
      } catch (e) {
        return { isError: true, content: [{ type: 'text' as const, text: (e as Error).message }] };
      }
    });
  }
  return server;
}
