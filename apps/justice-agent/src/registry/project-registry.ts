import type { iOSProject } from './ios-projects';

export function loadProjectRegistry(): Map<string, iOSProject> {
  const registry = new Map<string, iOSProject>();
  const registered = (process.env.JUSTICE_REGISTERED_PROJECTS ?? '')
    .split(',').map(s => s.trim()).filter(Boolean);

  for (const id of registered) {
    const prefix = id.toUpperCase().replace(/-/g, '_');
    const localPath = process.env[`${prefix}_LOCAL_PATH`];
    const repoName = process.env[`${prefix}_REPO_NAME`];
    if (!localPath || !repoName) {
      console.warn(`[registry] Skipping ${id} — missing ${prefix}_LOCAL_PATH or ${prefix}_REPO_NAME`);
      continue;
    }
    const repoOrg = process.env[`${prefix}_REPO_ORG`] ?? 'theaionlab';
    registry.set(id, {
      id,
      name: process.env[`${prefix}_DISPLAY_NAME`] ?? id.toUpperCase(),
      localPath,
      repoOrg,
      repoName,
      githubUrl: `https://github.com/${repoOrg}/${repoName}`,
      defaultBranch: process.env[`${prefix}_DEFAULT_BRANCH`] ?? 'main',
      stack: (process.env[`${prefix}_STACK`] ?? 'SwiftUI') as iOSProject['stack'],
      xcodeSchemeName: process.env[`${prefix}_XCODE_SCHEME`] ?? id,
      xcodeRoot: process.env[`${prefix}_XCODE_ROOT`],
      notionHubUrl: process.env[`${prefix}_NOTION_HUB_URL`] ?? '',
      batchLogsPageId: process.env[`${prefix}_BATCH_LOGS_PAGE_ID`] ?? '',
      phaseSequence: (process.env[`${prefix}_PHASE_SEQUENCE`] ?? '').split(',').map(s => s.trim()).filter(Boolean),
      description: process.env[`${prefix}_DESCRIPTION`] ?? '',
    });
  }
  return registry;
}
