import type { ProductModule } from '../core/tools.js';
import { pageTools } from './tools/pages.js';
import { publishTools } from './tools/publish.js';

/** Confluence tools; Task 13 adds table tools here. */
export const confluenceModule: ProductModule = {
  name: 'confluence',
  tools: [...pageTools, ...publishTools],
};
