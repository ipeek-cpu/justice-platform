import * as path from 'path';

export interface iOSProject {
  id: string;
  name: string;
  githubUrl: string;
  localPath: string;
  defaultBranch: string;
  stack: 'SwiftUI' | 'UIKit' | 'mixed';
  deploymentTarget: string;
  notionPageUrl?: string;
  description: string;
}

// Isaiah's iOS projects — update as repos are added
// Justice reads this registry before starting any iOS task
export const IOS_PROJECTS: iOSProject[] = [
  // Add projects here as they're onboarded
  // Example:
  // {
  //   id: 'intake-app',
  //   name: 'Wolf Law Intake App',
  //   githubUrl: 'https://github.com/ipeek-cpu/intake-app',
  //   localPath: path.join(process.env.HOME!, 'Developer/ios/intake-app'),
  //   defaultBranch: 'main',
  //   stack: 'SwiftUI',
  //   deploymentTarget: '16.0',
  //   description: 'Plaintiff intake app for Wolf Law callers',
  // },
];

export function getProject(id: string): iOSProject | undefined {
  return IOS_PROJECTS.find(p => p.id === id);
}

export function listProjects(): iOSProject[] {
  return IOS_PROJECTS;
}
