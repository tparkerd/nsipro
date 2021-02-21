import winston from "winston";
const { createLogger, format, transports } = winston;
const { combine, timestamp, label, printf } = format;

const loggerFormat = printf(({ level, message, label, timestamp }) => {
  return `${timestamp} [${label}] ${level.toUpperCase()}: ${message}`;
});

const initializeLog = (args) => {
  const logger = createLogger({
    level: "info",
    format: combine(label({ label: "cli.js" }), timestamp(), loggerFormat),
    transports: [
      new transports.Console({
        level: args.verbose ? "debug" : "info",
      }),
      new transports.File({
        filename: "nsipro-parser.err.log",
        level: "error",
      }),
      new transports.File({
        filename: "nsipro-parser.log",
        level: "info",
      }),
    ],
  });

  return logger;
};

export { initializeLog };
