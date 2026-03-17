# HLSTC Pre-flight Audit — 2026-03-17

## Checklist
| # | Item | Status |
|---|------|--------|
| 1 | Clone hlstc-app to ~/Developer/ios/hlstc-app | PASS |
| 2 | Supabase wiring audit (iOS: 5 Swift files, 0 AWS; Backend: 6 Lambda dirs) | PASS |
| 3 | Notion task page created (326967f4-607e-81a2-915b-e156725f4f08) | PASS |
| 4 | bd init --stealth in hlstc-app | PASS |
| 5 | 22 beads created with correct labels and dependencies | PASS |
| 6 | GitHub milestone "Supabase Migration" created (#1) | PASS |
| 7 | 9 GitHub labels created (migration, supabase, m1-m7 phases) | PASS |
| 8 | 22 GitHub issues created (#144-165) with acceptance criteria | PASS |
| 9 | Feature branch `feature/supabase-migration-plan` created | PASS |
| 10 | `docs/supabase-migration-plan.md` written and committed | PASS |
| 11 | Branch NOT pushed (awaiting approval) | PASS |
| 12 | Notion task page updated with full summary | PASS |
| 13 | iMessage sent to Isaiah with YES/NO prompt | PASS |
| 14 | M1 code NOT started (STOP gate respected) | PASS |

## Bead ID → GitHub Issue Mapping
| Bead ID | Title | GitHub Issue |
|---------|-------|-------------|
| hlstc-app-4en | MIGR-AUTH-001: Configure Supabase Auth OTP | #144 |
| hlstc-app-c9o | MIGR-AUTH-002: Update iOS Auth Client to Supabase Auth | #145 |
| hlstc-app-369 | MIGR-AUTH-003: Implement Web Auth Client with Supabase | #146 |
| hlstc-app-948 | MIGR-AUTH-004: Migrate Existing Cognito Users to Supabase Auth | #147 |
| hlstc-app-5s5 | MIGR-PROF-001: Replace Profile Lambda Handlers with Supabase Client Queries | #148 |
| hlstc-app-kc2 | MIGR-PROF-002: Equipment Catalog Direct Supabase Query | #149 |
| hlstc-app-hre | MIGR-SESS-001: Create session-start Edge Function | #150 |
| hlstc-app-6hm | MIGR-SESS-002: Migrate Set Logging + Progress to Supabase | #151 |
| hlstc-app-lbh | MIGR-SESS-003: Create Progress Summary Postgres Function | #152 |
| hlstc-app-850 | MIGR-NUTR-001: Create Nutrition Table Migrations | #153 |
| hlstc-app-49e | MIGR-NUTR-002: Create Meal Plan Generate Edge Function | #154 |
| hlstc-app-4od | MIGR-NUTR-003: Migrate Plate Suggest + Meal Log + Grocery Optimize | #155 |
| hlstc-app-akg | MIGR-HEALTH-001: Create Health + OAuth Table Migrations | #156 |
| hlstc-app-1v6 | MIGR-HEALTH-002: Create Health Sync Edge Function | #157 |
| hlstc-app-7pg | MIGR-HEALTH-003: Create Webhook Verify Edge Function | #158 |
| hlstc-app-fsp | MIGR-OAUTH-001: Create OAuth Edge Functions | #159 |
| hlstc-app-5p2 | MIGR-PROG-001: Expand Progression Table Schema | #160 |
| hlstc-app-okk | MIGR-PROG-002: Port Autoregulation Algorithm to Edge Function | #161 |
| hlstc-app-i1r | MIGR-PROG-003: Progression Integration Tests | #162 |
| hlstc-app-9m8 | MIGR-CLEAN-001: Delete AWS Code Directories | #163 |
| hlstc-app-txk | MIGR-CLEAN-002: Tear Down AWS Console Resources | #164 |
| hlstc-app-t7o | MIGR-CLEAN-003: Update Documentation Post-Migration | #165 |

## CLAUDE.md Update
- "When Justice Gets Stuck" section appended after Atomic Task Checkout section
