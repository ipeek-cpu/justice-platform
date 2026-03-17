import * as path from 'path';

export interface iOSProject {
  id: string;
  name: string;
  githubUrl: string;
  localPath: string;
  defaultBranch: string;
  stack: 'SwiftUI' | 'UIKit' | 'TypeScript' | 'mixed';
  deploymentTarget: string;
  notionHubUrl?: string;
  xcodeSchemeName: string;
  description: string;
}

export const IOS_PROJECTS: iOSProject[] = [
  {
    id: 'hlstc',
    name: 'HLSTC',
    githubUrl: 'https://github.com/theaionlab/hlstc-app',
    localPath: path.join(process.env.HOME!, 'Developer/ios/hlstc-app'),
    defaultBranch: 'main',
    stack: 'SwiftUI',
    deploymentTarget: 'latest',
    notionHubUrl: 'https://www.notion.so/326967f4607e8185b726c61b3856ae14',
    xcodeSchemeName: 'HLSTC',
    description: 'AI-powered fitness and nutrition app — personal trainer in your pocket',
  },
  {
    id: 'flaggd',
    name: 'Flaggd',
    githubUrl: 'https://github.com/theaionlab/flaggd',
    localPath: path.join(process.env.HOME!, 'Developer/ios/flaggd'),
    defaultBranch: 'main',
    stack: 'TypeScript',
    deploymentTarget: 'latest',
    notionHubUrl: '',
    xcodeSchemeName: 'flaggd',
    description: 'Privacy-first iOS app analyzing dating/relationship message threads',
  },
];

export function getProject(id: string): iOSProject | undefined {
  return IOS_PROJECTS.find(p => p.id === id);
}

export function listProjects(): iOSProject[] {
  return IOS_PROJECTS;
}
