# Resume Engine

## Purpose
Generate tailored resume YAML variants from Isaiah's master resume data.
Claude reorders and filters content to match specific job descriptions.
Never invents skills, titles, dates, or accomplishments.

## Import
```typescript
import { generateTailoredResume, generateBatch } from '../modes/resume-engine';
import type { ResumeTarget, ResumeResult } from '../modes/resume-engine';
```

## Single Resume
```typescript
const result = await generateTailoredResume({
  companyName: 'Stripe',
  roleTitle: 'Senior Data Engineer',
  jobDescription: 'Full JD text here...',
});
// result.variantYamlPath — tailored YAML file
// result.diffSummary — what changed from master
```

## Batch Resume
```typescript
const pageId = await notionLogger.createTaskPage('Resume Batch', 'specs...');
const results = await generateBatch(targets, pageId);
// Each result logged to Notion page automatically
```

## Strict Rules
- NEVER add content not in master YAML
- NEVER invent skills, titles, dates, or accomplishments
- NEVER add new bullet points — only reorder or remove
- Keep at least 3 bullets per role
- Output must be valid YAML matching master schema
- Master YAML is NEVER modified

## Data Source
- Master YAML: `RESUME_MASTER_YAML` env var (Doppler)
- Output dir: `RESUME_OUTPUT_DIR` env var
- Variants written to `/tmp/` and output dir

## Tailoring Operations Allowed
- Reorder bullet points to surface most relevant first
- Remove irrelevant bullets (min 3 per role)
- Adjust role_targeting section
- Reorder skills lists to lead with JD priorities

## Output
- Tailored YAML file (primary output)
- Diff summary (what changed from master)
- Notion log with details per resume
- iMessage ping to Isaiah when batch completes
