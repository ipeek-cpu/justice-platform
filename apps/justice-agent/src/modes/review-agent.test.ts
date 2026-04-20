import { describe, it, expect, beforeAll } from 'vitest';
import { parseReviewConcerns, type ParsedConcern } from './review-agent';

const sampleOutput = `STATUS: NEEDS_CHANGES
CONCERNS:
- SECURITY: API key exposed in \`src/config.ts:12\` — must use env var
- BUG: Null dereference when user object is undefined in \`src/handlers/auth.swift:45\`
- HARDCODED base URL committed in \`src/api/client.ts\`
- Consider adding a docstring to the helper function
- CRASH when network is unavailable — missing try/catch in \`src/network.ts:88\`
SUGGESTIONS:
- Add unit tests for the new helper
READY_FOR_HUMAN_REVIEW: NO
SUMMARY: Added auth flow with some issues`;

describe('parseReviewConcerns', () => {
  let concerns: ParsedConcern[];

  beforeAll(() => {
    concerns = parseReviewConcerns(sampleOutput);
  });

  it('extracts all concern bullets', () => {
    expect(concerns).toHaveLength(5);
  });

  it('classifies BLOCKER for security keywords', () => {
    const security = concerns.find(c => c.detail.includes('API key'));
    expect(security).toBeDefined();
    expect(security!.severity).toBe('blocker');
  });

  it('classifies HIGH for bug keywords', () => {
    const bug = concerns.find(c => c.detail.includes('Null dereference'));
    expect(bug).toBeDefined();
    expect(bug!.severity).toBe('high');
  });

  it('classifies HIGH for crash keywords', () => {
    const crash = concerns.find(c => c.detail.includes('CRASH'));
    expect(crash).toBeDefined();
    expect(crash!.severity).toBe('high');
  });

  it('classifies MEDIUM for hardcoded keywords', () => {
    const hardcoded = concerns.find(c => c.detail.includes('HARDCODED'));
    expect(hardcoded).toBeDefined();
    expect(hardcoded!.severity).toBe('medium');
  });

  it('classifies LOW for style/suggestion concerns', () => {
    const style = concerns.find(c => c.detail.includes('docstring'));
    expect(style).toBeDefined();
    expect(style!.severity).toBe('low');
  });

  it('extracts file path and line number', () => {
    const security = concerns.find(c => c.detail.includes('API key'))!;
    expect(security.file).toBe('src/config.ts');
    expect(security.line).toBe(12);
  });

  it('extracts file path without line number', () => {
    const hardcoded = concerns.find(c => c.detail.includes('HARDCODED'))!;
    expect(hardcoded.file).toBe('src/api/client.ts');
    expect(hardcoded.line).toBeUndefined();
  });

  it('extracts .swift file paths', () => {
    const bug = concerns.find(c => c.detail.includes('Null dereference'))!;
    expect(bug.file).toBe('src/handlers/auth.swift');
    expect(bug.line).toBe(45);
  });

  it('builds fixInstruction with file reference', () => {
    const security = concerns.find(c => c.detail.includes('API key'))!;
    expect(security.fixInstruction).toContain('src/config.ts:12');
    expect(security.fixInstruction.startsWith('Fix: ')).toBe(true);
  });

  it('builds fixInstruction without file when none present', () => {
    const style = concerns.find(c => c.detail.includes('docstring'))!;
    expect(style.fixInstruction.startsWith('Fix: ')).toBe(true);
    expect(style.fixInstruction).not.toContain('File:');
  });

  it('returns empty array for output with no concerns', () => {
    const approved = `STATUS: APPROVED
CONCERNS:
- none
SUGGESTIONS:
- none
READY_FOR_HUMAN_REVIEW: YES
SUMMARY: All good`;
    expect(parseReviewConcerns(approved)).toEqual([]);
  });

  it('returns empty array when CONCERNS section is missing', () => {
    expect(parseReviewConcerns('STATUS: APPROVED\nSUMMARY: ok')).toEqual([]);
  });

  it('truncates title to 80 chars', () => {
    const longOutput = `STATUS: NEEDS_CHANGES
CONCERNS:
- ${'A'.repeat(120)}
SUGGESTIONS:
- none`;
    const result = parseReviewConcerns(longOutput);
    expect(result[0].title.length).toBe(80);
    expect(result[0].detail.length).toBe(120);
  });
});
