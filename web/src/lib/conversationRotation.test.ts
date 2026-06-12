import { describe, expect, it } from 'vitest';
import {
  shouldRotateConversation,
  type RotationMessage,
} from './conversationRotation';

function transcript(userTurns: number): RotationMessage[] {
  const messages: RotationMessage[] = [];
  for (let i = 0; i < userTurns; i++) {
    messages.push({ role: 'user' }, { role: 'assistant' });
  }
  return messages;
}

describe('shouldRotateConversation', () => {
  it('does not rotate below the turn limit', () => {
    expect(shouldRotateConversation(transcript(39), 0, 40)).toBe(false);
  });

  it('rotates once the limit is reached', () => {
    expect(shouldRotateConversation(transcript(40), 0, 40)).toBe(true);
  });

  it('counts only turns after the rotation base, not the whole transcript', () => {
    const messages = transcript(45);
    const rotationBase = transcript(40).length;

    // 45 total user turns, but only 5 since the last rotation.
    expect(shouldRotateConversation(messages, rotationBase, 40)).toBe(false);
  });

  it('rotates again after another full window of turns', () => {
    const messages = transcript(80);
    const rotationBase = transcript(40).length;

    expect(shouldRotateConversation(messages, rotationBase, 40)).toBe(true);
  });

  it('never rotates when the limit is disabled', () => {
    expect(shouldRotateConversation(transcript(100), 0, 0)).toBe(false);
  });

  it('tolerates a stale base beyond the transcript length', () => {
    expect(shouldRotateConversation(transcript(3), 9999, 40)).toBe(false);
  });
});
