import { startAgentOSServer } from '../dist/index.js';
try {
  await startAgentOSServer({ dataDir: process.argv[2], port: 0, adapters: [], scan: async () => [] });
  process.send?.({ ready: true });
} catch (error) {
  process.send?.({ error: error.message });
  process.exitCode = 1;
  process.disconnect?.();
}
