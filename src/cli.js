#!/usr/bin/env node

import { ArgumentParser } from "argparse";
import fs from "fs";
import getPackageVersion from "@jsbits/get-package-version";
import { parse } from "./index.js";
import path from "path";
import winston from "winston";

const { createLogger, format, transports } = winston;
const { combine, timestamp, label, printf } = format;
const version = getPackageVersion();

const parser = new ArgumentParser({
  description: "Utility package for reading .nsipro files",
});
parser.add_argument("-V", "--version", {
  action: "version",
  version,
});
parser.add_argument("-v", "--verbose", {
  help: "increase verbosity",
  action: "store_true",
});
parser.add_argument("-r", "--recursive", {
  action: "store_true",
});
parser.add_argument("path", {
  metavar: "PATH",
  type: "str",
  nargs: "+",
  help: "file input (folder or individual file",
});

let args = parser.parse_args();

const loggerFormat = printf(({ level, message, label, timestamp }) => {
  return `${timestamp} [${label}] ${level.toUpperCase()}: ${message}`;
});

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
logger.info(args);

const getFilesByExtension = (filepath, extension) => {
  // return collectFiles(filepath, extension);

  logger.debug(`${filepath}`);
  let cwd = fs.realpathSync(filepath); // current working directory
  logger.debug(`${cwd}`);
  let contents = fs.readdirSync(cwd);
  logger.debug(`${contents}`);
  let files = contents
    .map((fp) => path.join(filepath, fp))
    .filter((fp) => fs.statSync(fp).isFile())
    .filter((fp) => path.extname(fp) === extension);
  logger.debug(`${files}`);
  let directories = contents
    .map((fp) => path.join(filepath, fp))
    .filter((fp) => fs.statSync(fp).isDirectory());
  logger.debug(`${directories}`);

  // Base case: no more children directories
  if (directories.length === 0) {
    console.log(`Leaf node: ${filepath}`);
    return files;
  }

  return [
    ...files,
    ...directories.map((dname) => getFilesByExtension(dname, extension)).flat(),
  ];
};

// TODO
// 1. Determine if PATH is individual file or folder (recursive search?)
if (args.path) {
  logger.info(`Processing ${args.path}`);
  let files = [];
  for (let p of args.path) {
    // Resolve filepath
    let fpath = fs.realpathSync(p);
    logger.info(`fpath='${fpath}'`);
    let fstats = fs.statSync(fpath);
    //    a) If a single file, continue
    if (fstats.isFile()) {
      files.push(fpath);
      //    b) If a folder, find all nsipro files
    } else if (fstats.isDirectory()) {
      let paths = getFilesByExtension(p, ".nsipro");
      // logger.info(paths);
      files = [...files, ...paths];
    }
  }

  // 2. Standardize and clean up file list
  //    a) remove duplicate entries
  files = [...new Set(files)];
  try {
    //    b) check permissions
    files.map((fp) => fs.accessSync(fp, fs.constants.R_OK));
  } catch (error) {
    logger.error(error);
    throw error;
  }

  // 3. Iterate over each file
  for (let fp of files) {
    try {
      //    a) open (maybe many at once to parallel)
      const nsipro_contents = fs.readFileSync(fp, "utf8");
      // console.log(nsipro_contents);
      //    b) parse file contents
      let res = await parse(fp, nsipro_contents);
      console.log(JSON.stringify(res, null, 2));
    } catch (error) {
      throw error;
    }
  }
}
