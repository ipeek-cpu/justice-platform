export interface Attorney {
  id: string;
  name: string;
  email: string;
  phone: string;
  firmName: string;
  barNumber: string;
  practiceAreas: string[];
  geography: string[];
  acceptanceRate: number;
  avgResponseTimeMinutes: number;
  capacity: number;
  currentCaseLoad: number;
  status: 'active' | 'inactive' | 'paused';
  subscriptionTier: 'basic' | 'premium';
  createdAt: string;
}

export interface RoutingResult {
  notified: Attorney[];
  status: 'sent' | 'no_eligible' | 'error';
  routedAt?: string;
  errorMessage?: string;
}

export interface RoutingEvent {
  sessionId: string;
  attorneysNotified: number;
  topStatute: string;
  economicScore: number;
  timestamp: string;
}
