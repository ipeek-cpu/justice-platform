export interface LawFirmTenant {
  id: string;
  name: string;
  displayName: string;
  phoneNumber: string;
  elevenlabsAgentId: string;
  documentPortalUrl: string;
  contactEmail: string;
  geography: string[];
  practiceAreas: string[];
  status: 'active' | 'inactive';
}
