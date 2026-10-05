import type { WebContents } from 'electron';

/** Stuurt een event naar de renderer, tenzij het venster intussen dicht is. */
export function safeSend(sender: WebContents, channel: string, payload: unknown): void {
  if (sender.isDestroyed()) return;
  sender.send(channel, payload);
}
