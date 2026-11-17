import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer, optionsFromEnv } from './server';

createServer(optionsFromEnv(process.env))
  .connect(new StdioServerTransport())
  .catch((e) => {
    process.stderr.write(`seedpod-mcp: ${(e as Error).message}\n`);
    process.exit(1);
  });
