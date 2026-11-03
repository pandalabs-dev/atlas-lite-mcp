import type { ProductModule } from '../core/tools.js';
import { pageTools } from './tools/pages.js';
import { publishTools } from './tools/publish.js';
import { tableTools } from './tools/tables.js';

/** Confluence tools: pages, publishing and tables. */
export const confluenceModule: ProductModule = {
  name: 'confluence',
  tools: [...pageTools, ...publishTools, ...tableTools],
};
