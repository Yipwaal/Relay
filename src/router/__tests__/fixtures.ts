import { resolveRoles } from '../catalog';
import type { InstalledModel, ResolvedRoles, RoleModels } from '../types';

export const CONFIGURED: RoleModels = {
  fast: 'gemma4:12b',
  reasoning: 'gpt-oss:20b',
  max: 'qwen3.8:27b',
  background: 'qwen3.5:9b',
  embedding: 'qwen3-embedding:0.6b',
};

export const ALL_INSTALLED: InstalledModel[] = [
  { name: 'gemma4:12b', sizeBytes: 7.1e9, capabilities: ['completion', 'vision', 'tools'] },
  { name: 'gpt-oss:20b', sizeBytes: 13e9, capabilities: ['completion', 'tools', 'thinking'] },
  { name: 'qwen3.8:27b', sizeBytes: 17e9, capabilities: ['completion', 'tools'] },
  { name: 'qwen3.5:9b', sizeBytes: 6e9, capabilities: ['completion', 'tools'] },
  { name: 'qwen3-embedding:0.6b', sizeBytes: 0.6e9, capabilities: ['embedding'] },
];

export function allRoles(): ResolvedRoles {
  return resolveRoles(CONFIGURED, ALL_INSTALLED);
}
