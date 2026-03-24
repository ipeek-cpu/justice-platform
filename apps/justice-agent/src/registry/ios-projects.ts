import { loadProjectRegistry } from './project-registry';

export interface iOSProject {
  id: string;
  name: string;
  repoOrg: string;
  repoName: string;
  githubUrl: string;
  localPath: string;
  defaultBranch: string;
  stack: 'SwiftUI' | 'UIKit' | 'TypeScript' | 'mixed';
  xcodeSchemeName: string;
  xcodeRoot?: string;
  notionHubUrl?: string;
  batchLogsPageId: string;
  phaseSequence: string[];
  description: string;
}

let _registry: Map<string, iOSProject> | null = null;

function getRegistry(): Map<string, iOSProject> {
  if (!_registry) _registry = loadProjectRegistry();
  return _registry;
}

export function getProject(id: string): iOSProject | undefined {
  return getRegistry().get(id.toLowerCase());
}

export function listProjects(): iOSProject[] {
  return Array.from(getRegistry().values());
}

/** Force reload from env vars (used after justice_register adds a new project). */
export function reloadRegistry(): void {
  _registry = null;
}
