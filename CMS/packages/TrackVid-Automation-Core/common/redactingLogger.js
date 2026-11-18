/**
 * Logger that redacts credentials out of serialised errors.
 *
 * Differs from common/logger by stripping anything shaped like a password from
 * error messages and trimming stacks to five frames. Snapdeal and Meesho login
 * errors carry the credential in the message, so the plain logger would put it in
 * the terminal and in whatever collects stdout.
 *
 * Snapdeal and Meesho each shipped a byte-identical copy of this; they now share
 * one. Both copies also created a logs/ directory that nothing ever wrote to —
 * the transport is stdout-only — so that has been dropped.
 */

const pino = require("pino");

const transport = pino.transport({
	target: "pino-pretty",
	options: {
		colorize: true,
		translateTime: "SYS:yyyy-mm-dd HH:MM:ss",
		ignore: "pid,hostname",
	},
});

const logger = pino(
	{
		level: process.env.LOG_LEVEL || "info",
		serializers: {
			err: (err) => ({
				type: err.type || err.name,
				message: String(err.message || "").replace(
					/password["']?\s*[:=]\s*["']?[^"',\s]+/gi,
					"password=***"
				),
				stack: String(err.stack || "").split("\n").slice(0, 5).join("\n"),
			}),
		},
	},
	transport
);

module.exports = logger;
