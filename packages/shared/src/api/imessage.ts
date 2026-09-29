import { z } from 'zod';

/** Texting Hermi (the Photon iMessage agent): which of your phones/emails it knows, and how to add one. */
export const ImessageStatus = z.object({
  linked: z.boolean(),
  handles: z.array(z.string()).describe('Linked handles, masked (e.g. "+1•••••1234")'),
  agentAddress: z
    .string()
    .nullable()
    .describe('The number to text; null when the agent is not configured'),
});

export const ImessageLinkCode = z.object({
  code: z.string().describe('Six characters; text "link <code>" to the agent within 10 minutes'),
  expiresAt: z.string(),
  agentAddress: z.string().nullable(),
  smsUrl: z
    .string()
    .nullable()
    .describe('sms: URL that opens Messages to the agent with "link <code>" typed in'),
});

export const DevImessageLinkBody = z.object({
  username: z.string(),
  handle: z
    .string()
    .min(3)
    .describe('Phone (any format; US numbers may omit +1) or iMessage email'),
});
