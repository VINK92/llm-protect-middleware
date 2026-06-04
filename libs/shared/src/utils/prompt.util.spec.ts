import { canonicalizePrompt, sha256Hex, shannonEntropy } from './prompt.util';

describe('canonicalizePrompt', () => {
  it('joins role+content with newline and lowercases', () => {
    const out = canonicalizePrompt([
      { role: 'system', content: 'You are a Helpful Assistant.  ' },
      { role: 'user', content: '  Hello  ' },
    ]);
    expect(out).toBe('system:you are a helpful assistant.\nuser:hello');
  });
});

describe('sha256Hex', () => {
  it('is deterministic and 64 hex chars', () => {
    const h = sha256Hex('hello');
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(sha256Hex('hello')).toBe(h);
  });
});

describe('shannonEntropy', () => {
  it('returns 0 for empty input', () => {
    expect(shannonEntropy('')).toBe(0);
  });

  it('returns 0 for single repeated char', () => {
    expect(shannonEntropy('aaaaa')).toBe(0);
  });

  it('returns ~1 bit/char for balanced binary alphabet', () => {
    expect(shannonEntropy('abababab')).toBeCloseTo(1, 5);
  });

  it('is higher for more diverse text', () => {
    const low = shannonEntropy('aaaaaaaaaaab');
    const high = shannonEntropy('abcdefghijkl');
    expect(high).toBeGreaterThan(low);
  });
});
