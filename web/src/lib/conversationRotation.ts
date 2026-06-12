export interface RotationMessage {
  role: string;
}

/**
 * The transcript keeps growing across rotations, so the turn count must be
 * measured from the last rotation point, not from the start of the transcript.
 * Otherwise every send after the limit would rotate again.
 */
export function shouldRotateConversation(
  messages: RotationMessage[],
  rotationBase: number,
  maxTurns: number,
): boolean {
  if (maxTurns <= 0) return false;

  let userTurns = 0;
  for (let i = Math.max(0, rotationBase); i < messages.length; i++) {
    if (messages[i].role === 'user') userTurns += 1;
  }
  return userTurns >= maxTurns;
}
