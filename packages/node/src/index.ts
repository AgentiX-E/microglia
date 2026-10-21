/**
 * `@agentix-e/microglia-node` — the server half of the library.
 *
 * Two ways in: mount `createApp` on an existing Hono deployment, or run
 * `createServer` for the whole process. Both take an open facade, because a
 * server that owns its store should also own its lifecycle.
 */
export { createApp, statusFor, type AppOptions } from './app.js';
export { createServer, listen, type Server, type ServerOptions } from './server.js';
export { deepseekProvider, deepseekFactory, DEEPSEEK_BASE, type DeepSeekOptions } from './providers/deepseek.js';
export { zhipuEmbeddings, zhipuFactory, ZHIPU_BASE, type ZhipuOptions } from './providers/zhipu.js';
