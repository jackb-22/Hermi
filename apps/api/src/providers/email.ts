import type { Config } from '../config.ts';

export interface EmailProvider {
  readonly name: string;
  send(to: string, subject: string, text: string): Promise<void>;
}

/** Logs instead of sending; dev responses also echo the code. */
export class ConsoleEmail implements EmailProvider {
  readonly name = 'console';
  sent: { to: string; subject: string; text: string }[] = [];
  async send(to: string, subject: string, text: string) {
    this.sent.push({ to, subject, text });
    console.log(`[email:console] to=${to} subject=${subject} :: ${text}`);
  }
}

export class ResendEmail implements EmailProvider {
  readonly name = 'resend';
  constructor(
    private key: string,
    private from: string,
  ) {}
  async send(to: string, subject: string, text: string) {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: this.from, to, subject, text }),
    });
    if (!res.ok) throw new Error(`resend ${res.status}: ${await res.text()}`);
  }
}

export function createEmail(c: Config): EmailProvider {
  return c.RESEND_API_KEY && c.EMAIL_FROM ? new ResendEmail(c.RESEND_API_KEY, c.EMAIL_FROM) : new ConsoleEmail();
}
