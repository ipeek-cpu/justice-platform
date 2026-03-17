import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import Anthropic from '@anthropic-ai/sdk';
import { getClient } from '../integrations/notion-client';
import { notionLogger } from '../integrations/notion-logger';
import { sendIMessage } from '@justice/messaging';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const ISAIAH = process.env.APPROVED_NUMBER_ISAIAH!;

const MASTER_YAML = process.env.RESUME_MASTER_YAML!;
const OUTPUT_DIR = process.env.RESUME_OUTPUT_DIR!;

export interface ResumeTarget {
  companyName: string;
  roleTitle: string;
  jobDescription: string;
}

export interface ResumeResult {
  target: ResumeTarget;
  variantYamlPath: string;
  pdfPath: string;
  diffSummary: string;
}

// Generate a single tailored resume variant
export async function generateTailoredResume(target: ResumeTarget): Promise<ResumeResult> {
  // 1. Read master YAML
  const masterContent = fs.readFileSync(MASTER_YAML, 'utf8');

  // 2. Build tailoring slug
  const slug = target.companyName.toLowerCase().replace(/[^a-z0-9]/g, '-').slice(0, 20);
  const date = new Date().toISOString().split('T')[0].replace(/-/g, '');

  // 3. Call Claude API to produce tailored YAML
  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 4096,
    system: `You are tailoring a resume YAML for a specific job description.

WHAT YOU MUST DO:
- Rephrase bullet points to mirror the JD's language, keywords, and terminology
- Reframe accomplishments to emphasize the aspects most relevant to this role
- Reorder bullets within each role to lead with the strongest JD-aligned points
- Reorder skills lists to lead with what the JD prioritizes
- Remove bullets that are irrelevant to this JD (keep at least 3 per role)
- Adjust the role_targeting section to match the JD

WHAT YOU MUST NEVER DO:
- NEVER invent experiences, projects, metrics, or accomplishments that aren't in the master
- NEVER fabricate skills, certifications, titles, dates, or companies
- NEVER add entirely new bullet points — only rephrase or remove existing ones
- NEVER change job titles, company names, dates, or education details
- NEVER inflate metrics (e.g. "10%" cannot become "50%")

REPHRASING GUIDELINES:
- Match the JD's vocabulary: if the JD says "data pipelines" and the bullet says "ETL workflows", rephrase to "data pipelines"
- Emphasize relevant impact: if the JD prioritizes scale, lead with scale metrics from the bullet
- Tighten language: remove filler, make every word count
- The core truth of each bullet must remain intact — same work, same impact, better framing

Output must be valid YAML matching the exact schema of the input.
Output ONLY the YAML — no explanation, no markdown fences.`,
    messages: [{
      role: 'user',
      content: `Master YAML:\n${masterContent}\n\nJob Description for ${target.roleTitle} at ${target.companyName}:\n${target.jobDescription}\n\nProduce a tailored YAML variant.`
    }]
  });

  const tailoredContent = response.content[0].type === 'text' ? response.content[0].text : '';

  // 4. Validate YAML parses correctly
  yaml.load(tailoredContent); // throws if invalid

  // 5. Write variant YAML
  const filename = `resume_ipeek_${slug}_${date}`;
  const variantPath = path.join('/tmp', `${filename}.yaml`);
  fs.writeFileSync(variantPath, tailoredContent, 'utf8');

  // 6. Write tailored YAML to output dir as well
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const outputYamlPath = path.join(OUTPUT_DIR, `${filename}.yaml`);
  fs.writeFileSync(outputYamlPath, tailoredContent, 'utf8');

  // 6b. Generate PDF via resume-generator-webapp API
  const pdfPath = path.join(OUTPUT_DIR, `${filename}.pdf`);
  const generatorUrl = process.env.RESUME_GENERATOR_URL;
  if (generatorUrl) {
    try {
      const exportRes = await fetch(`${generatorUrl}/api/generate/export`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          yaml_content: tailoredContent,
          format: 'pdf',
          filename,
        }),
      });
      if (exportRes.ok) {
        const exportData = await exportRes.json() as { resume_id: string; pdf_path: string | null };
        // Download the PDF via the download endpoint
        if (exportData.resume_id) {
          const dlRes = await fetch(`${generatorUrl}/api/generate/download/${exportData.resume_id}/pdf`);
          if (dlRes.ok) {
            const pdfBuffer = Buffer.from(await dlRes.arrayBuffer());
            fs.writeFileSync(pdfPath, pdfBuffer);
            console.log(`[resume-engine] PDF written to ${pdfPath}`);
          } else {
            // Fallback: copy from server-side path if accessible
            if (exportData.pdf_path && fs.existsSync(exportData.pdf_path)) {
              fs.copyFileSync(exportData.pdf_path, pdfPath);
              console.log(`[resume-engine] PDF copied from ${exportData.pdf_path}`);
            }
          }
        }
      } else {
        const errText = await exportRes.text();
        console.error(`[resume-engine] PDF export failed (${exportRes.status}): ${errText}`);
      }
    } catch (err) {
      console.error('[resume-engine] PDF generation failed:', err);
    }
  }

  // 7. Build diff summary (what changed from master)
  const masterData = yaml.load(masterContent) as any;
  const tailoredData = yaml.load(tailoredContent) as any;
  const diffSummary = buildDiffSummary(masterData, tailoredData, target);

  return { target, variantYamlPath: variantPath, pdfPath, diffSummary };
}

// Generate multiple resumes and log all to one Notion page
export async function generateBatch(
  targets: ResumeTarget[],
  notionPageId: string
): Promise<ResumeResult[]> {
  const results: ResumeResult[] = [];

  for (const target of targets) {
    try {
      const result = await generateTailoredResume(target);
      results.push(result);
      await logResumeToNotion(notionPageId, result);
    } catch (err) {
      await notionLogger.logQuestion(
        notionPageId,
        `Resume generation failed for ${target.companyName}: ${err}`
      );
    }
  }

  return results;
}

async function logResumeToNotion(pageId: string, result: ResumeResult): Promise<void> {
  try {
    const notion = getClient();

    await notion.blocks.children.append({
      block_id: pageId,
      children: [
        {
          object: 'block' as const,
          type: 'heading_3' as const,
          heading_3: {
            rich_text: [{
              type: 'text' as const,
              text: {
                content: `Resume — ${result.target.roleTitle} at ${result.target.companyName}`
              }
            }]
          }
        },
        {
          object: 'block' as const,
          type: 'callout' as const,
          callout: {
            rich_text: [{ type: 'text' as const, text: { content: `YAML: ${result.variantYamlPath}` } }],
            icon: { type: 'emoji' as const, emoji: '\uD83D\uDCC4' },
            color: 'green_background' as const
          }
        },
        {
          object: 'block' as const,
          type: 'callout' as const,
          callout: {
            rich_text: [{ type: 'text' as const, text: { content: result.diffSummary } }],
            icon: { type: 'emoji' as const, emoji: '\uD83D\uDD0D' },
            color: 'gray_background' as const
          }
        },
        { object: 'block' as const, type: 'divider' as const, divider: {} }
      ]
    });
  } catch (err) {
    console.error('[resume-engine] logResumeToNotion failed:', err);
  }
}

function buildDiffSummary(master: any, tailored: any, target: ResumeTarget): string {
  const lines: string[] = [`Tailored for: ${target.roleTitle} at ${target.companyName}`];

  // Check role targeting changes
  if (tailored.role_targeting?.title !== master.role_targeting?.title) {
    lines.push(`Role title: "${master.role_targeting?.title}" → "${tailored.role_targeting?.title}"`);
  }

  // Count bullets removed per experience
  const masterExp = master.experience ?? [];
  const tailoredExp = tailored.experience ?? [];
  masterExp.forEach((role: any, i: number) => {
    const masterCount = role.responsibilities?.length ?? 0;
    const tailoredCount = tailoredExp[i]?.responsibilities?.length ?? 0;
    if (tailoredCount < masterCount) {
      lines.push(`${role.company}: removed ${masterCount - tailoredCount} bullet(s)`);
    }
  });

  // Check skills reordering
  const masterSkills = Object.keys(master.skills ?? {});
  const tailoredSkills = Object.keys(tailored.skills ?? {});
  if (JSON.stringify(masterSkills) !== JSON.stringify(tailoredSkills)) {
    lines.push('Skills sections reordered');
  }

  return lines.join('\n');
}
