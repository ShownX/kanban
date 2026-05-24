import { describe, expect, it, vi } from "vitest";

import { ConsoleMailer, NoopMailer } from "../../../src/identity/mailer";

describe("NoopMailer", () => {
	it("collects every send into outbox", async () => {
		const mailer = new NoopMailer();
		await mailer.send({ to: "a@example.com", subject: "Hello", body: "World" });
		await mailer.send({ to: "b@example.com", subject: "Hi", body: "There" });
		expect(mailer.outbox).toHaveLength(2);
		expect(mailer.outbox[0]?.to).toBe("a@example.com");
		expect(mailer.outbox[1]?.subject).toBe("Hi");
	});
});

describe("ConsoleMailer", () => {
	it("writes a banner to stdout", async () => {
		const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
		const mailer = new ConsoleMailer();
		await mailer.send({ to: "alice@example.com", subject: "Login link", body: "Click me" });
		expect(writeSpy).toHaveBeenCalled();
		const written = writeSpy.mock.calls.map((call) => String(call[0])).join("");
		expect(written).toContain("alice@example.com");
		expect(written).toContain("Login link");
		expect(written).toContain("Click me");
		writeSpy.mockRestore();
	});
});
