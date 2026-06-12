import type { HudFrameStatusMessage } from '../lib/hudFrameProtocol';

/**
 * Report frame status to the hosting app. The frame runs in an opaque
 * origin, so '*' is the only addressable targetOrigin; status messages
 * carry no secrets.
 */
export function post(message: HudFrameStatusMessage) {
  window.parent.postMessage(message, '*');
}
