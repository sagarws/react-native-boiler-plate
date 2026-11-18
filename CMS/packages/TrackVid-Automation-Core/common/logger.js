const pino = require("pino");
const dayjs = require("dayjs");
const utc = require("dayjs/plugin/utc");
const timezone = require("dayjs/plugin/timezone");

dayjs.extend(utc);
dayjs.extend(timezone);

const logger = pino({
  level: process.env.LOG_LEVEL || "info",
  timestamp: () => {
    const istTime = dayjs().tz("Asia/Kolkata").format("DD/MM/YYYY hh:mm:ss a");
    return `,"time":"${istTime}"`;
  },
  transport: {
    target: "pino-pretty",
    options: {
      colorize: true,
      translateTime: false,
      ignore: "pid,hostname",
    },
  },
});

module.exports = logger;
