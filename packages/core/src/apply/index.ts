/**
 * `@agentix-e/microglia-apply` — what reaches the prompt.
 *
 * Kept separate from memory because retrieval policy and rendering policy fail
 * differently: one is about which evidence is relevant, the other about what a
 * model can safely be shown.
 */
export {
  CLOSE_TAG,
  OPEN_TAG,
  appliedIds,
  emptyPack,
  makePack,
  packFingerprint,
  renderPack,
  type RenderOptions,
  type RenderedPack,
} from './render.js';

export { buildPack, type BuildPackOptions } from './pack.js';
