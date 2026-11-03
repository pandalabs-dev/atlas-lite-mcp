import type { ProductModule } from '../core/tools.js';
import { readTools } from './tools/read.js';

/** Jira tools: read, search, transition and comment. */
export const jiraModule: ProductModule = {
  name: 'jira',
  tools: [...readTools],
};
