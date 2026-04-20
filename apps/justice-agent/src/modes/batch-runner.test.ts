import { describe, it, expect } from 'vitest';
import { resolveBatchOrder } from './batch-runner';

describe('resolveBatchOrder', () => {
  it('returns beads in original order when no deps', () => {
    const beads = [
      { id: 'A' },
      { id: 'B' },
      { id: 'C' },
    ];
    expect(resolveBatchOrder(beads)).toEqual(['A', 'B', 'C']);
  });

  it('sorts a linear dependency chain', () => {
    const beads = [
      { id: 'C', deps: ['B'] },
      { id: 'B', deps: ['A'] },
      { id: 'A' },
    ];
    expect(resolveBatchOrder(beads)).toEqual(['A', 'B', 'C']);
  });

  it('handles diamond dependency', () => {
    // A -> B, A -> C, B -> D, C -> D
    const beads = [
      { id: 'D', deps: ['B', 'C'] },
      { id: 'B', deps: ['A'] },
      { id: 'C', deps: ['A'] },
      { id: 'A' },
    ];
    const result = resolveBatchOrder(beads);
    expect(result.indexOf('A')).toBeLessThan(result.indexOf('B'));
    expect(result.indexOf('A')).toBeLessThan(result.indexOf('C'));
    expect(result.indexOf('B')).toBeLessThan(result.indexOf('D'));
    expect(result.indexOf('C')).toBeLessThan(result.indexOf('D'));
    expect(result).toHaveLength(4);
  });

  it('ignores deps referencing beads not in the batch', () => {
    const beads = [
      { id: 'B', deps: ['EXTERNAL'] },
      { id: 'A' },
    ];
    // EXTERNAL is not in the set, so B has 0 in-degree
    const result = resolveBatchOrder(beads);
    expect(result).toEqual(['B', 'A']);
  });

  it('handles a single bead', () => {
    expect(resolveBatchOrder([{ id: 'SOLO' }])).toEqual(['SOLO']);
  });

  it('handles empty input', () => {
    expect(resolveBatchOrder([])).toEqual([]);
  });

  it('appends beads caught in a cycle rather than losing them', () => {
    // A -> B -> A (cycle)
    const beads = [
      { id: 'A', deps: ['B'] },
      { id: 'B', deps: ['A'] },
      { id: 'C' },
    ];
    const result = resolveBatchOrder(beads);
    // C has no deps, should come first. A and B are in a cycle but still appear.
    expect(result).toContain('A');
    expect(result).toContain('B');
    expect(result).toContain('C');
    expect(result).toHaveLength(3);
    expect(result[0]).toBe('C');
  });

  it('handles beads with undefined deps', () => {
    const beads = [
      { id: 'A', deps: undefined },
      { id: 'B', deps: ['A'] },
    ];
    expect(resolveBatchOrder(beads)).toEqual(['A', 'B']);
  });
});
