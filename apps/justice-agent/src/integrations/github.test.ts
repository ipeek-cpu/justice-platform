import { describe, it, expect } from 'vitest';
import { buildBatchPRDescription } from './github';

describe('buildBatchPRDescription', () => {
  it('renders per-bead sections with commits', () => {
    const result = buildBatchPRDescription({
      title: 'HLSTC — Batch batch-hlstc-123',
      branch: 'feature/batch-m1-auth-2026-03-17',
      beadSections: [
        { beadId: 'MIGR-AUTH-001', title: 'Configure Supabase Auth OTP', commits: ['033a319 feat(MIGR-AUTH-001): configure OTP'] },
        { beadId: 'MIGR-AUTH-002', title: 'Session persistence layer', commits: ['a1b2c3d feat(MIGR-AUTH-002): session persistence'] },
      ],
      testCoverage: 'Passing',
      reviewStatus: 'APPROVED',
      concerns: [],
    });

    expect(result).toContain('## HLSTC — Batch batch-hlstc-123');
    expect(result).toContain('**Branch:** `feature/batch-m1-auth-2026-03-17`');
    expect(result).toContain('**Beads:** MIGR-AUTH-001, MIGR-AUTH-002');
    expect(result).toContain('#### MIGR-AUTH-001: Configure Supabase Auth OTP');
    expect(result).toContain('- 033a319 feat(MIGR-AUTH-001): configure OTP');
    expect(result).toContain('#### MIGR-AUTH-002: Session persistence layer');
    expect(result).toContain('### Build');
    expect(result).toContain('Passing');
    expect(result).toContain('APPROVED — 0 concern(s)');
    expect(result).toContain('Pending Isaiah review and merge approval.');
  });

  it('renders concerns when present', () => {
    const result = buildBatchPRDescription({
      title: 'Test',
      branch: 'feature/test',
      beadSections: [
        { beadId: 'B-1', title: 'Fix thing', commits: ['abc fix'] },
      ],
      testCoverage: 'Build: passing',
      reviewStatus: 'NEEDS_CHANGES',
      concerns: ['Missing error handling in AuthManager', 'No unit tests for OTP flow'],
    });

    expect(result).toContain('NEEDS_CHANGES — 2 concern(s)');
    expect(result).toContain('- Missing error handling in AuthManager');
    expect(result).toContain('- No unit tests for OTP flow');
  });

  it('handles beads with no commits', () => {
    const result = buildBatchPRDescription({
      title: 'Test',
      branch: 'feature/test',
      beadSections: [
        { beadId: 'B-1', title: 'Empty bead', commits: [] },
      ],
      testCoverage: 'Build: passing',
    });

    expect(result).toContain('#### B-1: Empty bead');
    expect(result).toContain('- (no commits)');
  });

  it('omits review section when no reviewStatus', () => {
    const result = buildBatchPRDescription({
      title: 'Test',
      branch: 'feature/test',
      beadSections: [
        { beadId: 'B-1', title: 'Something', commits: ['abc feat'] },
      ],
      testCoverage: 'Build: passing',
    });

    expect(result).not.toContain('### Review agent');
  });

  it('renders multiple beads in order', () => {
    const result = buildBatchPRDescription({
      title: 'Batch',
      branch: 'feature/b',
      beadSections: [
        { beadId: 'A', title: 'First', commits: ['1 first'] },
        { beadId: 'B', title: 'Second', commits: ['2 second'] },
        { beadId: 'C', title: 'Third', commits: ['3 third'] },
      ],
      testCoverage: 'Build: passing',
    });

    const aIdx = result.indexOf('#### A: First');
    const bIdx = result.indexOf('#### B: Second');
    const cIdx = result.indexOf('#### C: Third');
    expect(aIdx).toBeLessThan(bIdx);
    expect(bIdx).toBeLessThan(cIdx);
    expect(result).toContain('**Beads:** A, B, C');
  });
});
