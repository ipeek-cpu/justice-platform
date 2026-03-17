import type { StatuteCategory, EmployerType, Geography, WorkerType, AgencyOption } from '@justice/shared-types';

export interface Statute {
  id: string;
  name: string;
  citation: string;
  category: StatuteCategory;
  triggerTags: string[];
  employerSizeMin: number;
  employerTypes: EmployerType[];
  geographies: Geography[];
  workerTypes: WorkerType[];
  protectedCharacteristics?: string[];
  feeShifting: boolean;
  solDays: number;
  agencyFiling?: AgencyOption;
  docBonus: number;
}
