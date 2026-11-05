import type { ProductModule } from '../core/tools.js';
import { readTools } from './tools/read.js';
import { writeTools } from './tools/write.js';

/** Jira tools: read, search, transition, comment, create, update and delete. */
export const jiraModule: ProductModule = {
  name: 'jira',
  tools: [...readTools, ...writeTools],
};
