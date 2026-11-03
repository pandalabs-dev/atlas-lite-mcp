import type { ProductModule } from '../core/tools.js';
import { pageTools } from './tools/pages.js';

/** Confluence tools; Tasks 12 and 13 add publish and table tools here. */
export const confluenceModule: ProductModule = {
  name: 'confluence',
  tools: [...pageTools],
};
