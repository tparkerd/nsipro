#!/usr/bin/env node

import { ArgumentParser } from "argparse";
import cliProgress from "cli-progress";
import fs from "fs";
import getPackageVersion from "@jsbits/get-package-version";
import { initializeLog } from "./log.js";
import json_2_csv from "json-2-csv";
import { parse } from "./index.js";
import path from "path";
import { tabulateJson } from "./util.js";
const { json2csv } = json_2_csv;

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
const logger = initializeLog(args);
logger.debug(args);

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
    logger.debug(`fpath='${fpath}'`);
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

  let ofp = `${path.basename(args.path[0])}.csv`;

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
  // Define progress bar
  const df = [];
  const pbarOpts = {
    format: "progress [{bar}] {percentage}% | ETA: {eta}s | {value}/{total}",
  };
  const pbar = new cliProgress.SingleBar(
    {},
    cliProgress.Presets.shades_classic
  );
  pbar.start(files.length, 0, { speed: "N/A" });
  for (let fp of files) {
    try {
      //    a) open (maybe many at once to parallel)
      const nsipro_contents = fs.readFileSync(fp, "utf8");
      // console.log(nsipro_contents);
      //    b) parse file contents
      let nsipro_json = await parse(fp, nsipro_contents);
      // Add to all results
      // df.push(nsipro_json);
      let simplified_nsipro = tabulateJson(nsipro_json);
      df.push(simplified_nsipro);
      logger.debug(simplified_nsipro);
      pbar.increment();
    } catch (error) {
      console.error(error);
    }
  }
  pbar.stop();

  // Convert to CSV
  json2csv(df, (err, csv) => {
    if (err) throw err;

    // Success! Write to file!
    fs.writeFileSync(ofp, csv, "utf8", (err) => {
      if (err) throw err;
    });
    logger.info(`Saved '${ofp}'`);
  });
  // console.log(df);
}
