import { createHash } from 'node:crypto';
import { ChatMessageDto } from '../dto/chat-completion.dto';

/**
 * Canonicalize messages into a single string for hashing/entropy/tokenization.
 * Trim + lowercase to maximize hash hit-rate for near-duplicate prompts.
 */
export function canonicalizePrompt(messages: ChatMessageDto[]): string {
  return messages
    .map((m) => `${m.role}:${m.content.trim()}`)
    .join('\n')
    .toLowerCase();
}

/** Stage 2 — SHA-256 hex. */
export function sha256Hex(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

/**
 * Shannon entropy in bits/byte (range ~0..8 for byte alphabet).
 * Used by Stage 3 (EntropyGuard).
 */
export function shannonEntropy(text: string): number {
  if (!text || text.length === 0) return 0;

  const freq = new Map<string, number>();
  for (const ch of text) {
    freq.set(ch, (freq.get(ch) ?? 0) + 1);
  }
  const len = text.length;
  let h = 0;
  for (const count of freq.values()) {
    const p = count / len;
    h -= p * Math.log2(p);
  }
  return h;
}
