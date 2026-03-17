# Pattern Library

## Read Patterns at Session Start
```
bd list --label pattern --limit 5
```
Review the top patterns before starting work to apply learned optimizations.

## Apply Patterns Before Writing Code
Before implementing, check if a similar task type has been completed before:
- What complexity signals were present?
- What estimation accuracy was achieved?
- What worked and what failed?

## Record Pattern After Completion
```typescript
await notionLogger.logPattern({
  taskType: 'ios',                    // ios, report, data, linkedin, law-firm, git
  estimatedComplexity: 'medium',
  estimatedDuration: '2h',
  actualDuration: '3.5h',
  estimationAccuracy: 0.57,           // estimated / actual ratio
  phasesCompleted: 4,
  phasesRetried: 1,
  toolsUsed: ['xcodebuild', 'swift'],
  whatWorked: 'Reading all files before modifying',
  whatFailed: 'Assumed API was available without checking docs',
  reusablePattern: 'Always verify API availability before implementation phase',
  complexitySignals: ['unfamiliar framework', 'no existing tests'],
  projectContext: 'Wolf Law iOS app',
});
```

## Estimation Improvement
- If `estimationAccuracy` ratio is consistently > 1.5, increase future estimates for that task type
- If ratio is consistently < 0.7, decrease estimates
- Track trends per task type over time

## Pattern Types
- `ios` — iOS/Swift development tasks
- `report` — Data reporting and analytics
- `data` — Database and data pipeline work
- `linkedin` — LinkedIn outreach drafting
- `law-firm` — Law firm onboarding and config
- `git` — Git workflow and CI/CD tasks
