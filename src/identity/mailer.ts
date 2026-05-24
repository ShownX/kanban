/**
 * Mailer abstraction. Used by the magic-link flow to deliver one-time
 * login URLs. Two implementations ship in this branch:
 *
 *   - `ConsoleMailer` — logs the rendered email to stdout so a self-hoster
 *     can run a multi-user instance without configuring SMTP. Default in
 *     dev / single-user.
 *   - `NoopMailer` — for tests; records every send so assertions can read
 *     the link the user "would have" gotten without touching stdout.
 *
 * Production deployments will plug a real provider (Resend, SES, SMTP)
 * behind the same interface in a follow-on branch.
 */

export interface MailerSendInput {
	to: string;
	subject: string;
	body: string;
}

export interface Mailer {
	send(input: MailerSendInput): Promise<void>;
}

/**
 * Default mailer: writes the email to stdout as a banner. Used when the
 * server has no real mail provider configured. Kanban's existing CLI
 * spinners go to stderr, so this won't interleave with them.
 */
export class ConsoleMailer implements Mailer {
	async send(input: MailerSendInput): Promise<void> {
		const banner = "─".repeat(72);
		const lines = [
			banner,
			`📧 Magic-link email (console mailer)`,
			`To:      ${input.to}`,
			`Subject: ${input.subject}`,
			"",
			input.body.trim(),
			banner,
		];
		process.stdout.write(`${lines.join("\n")}\n`);
	}
}

/**
 * Test mailer: collects every send into an array. Tests assert against
 * `mailer.outbox` instead of capturing stdout.
 */
export class NoopMailer implements Mailer {
	readonly outbox: MailerSendInput[] = [];

	async send(input: MailerSendInput): Promise<void> {
		this.outbox.push(input);
	}
}
