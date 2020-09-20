const { DateTime } = require("luxon");
const keysInObject = require("keys-in-object");
const path = require("path");

const datetime_format = "dd-LLL-yy hh:mm:ss a";
const datetime_format_alt = "LL/dd/kkkk hh:mm:ss a";

/**
 *
 * @param {String} key Name of key
 * @param {Object} obj Search space
 * @returns {} value
 */
const lookup = (key, obj) => {
  if (!(obj instanceof Object || typeof obj === "object")) return;

  // Get values of all instances in object
  values = keysInObject(obj, key);

  // DEBUG
  console.log(`Searching for '${key}'`);
  console.log(values);

  // If the key is found...
  if (values.length > 0) {
    const unique_values = Array.from(new Set(values));
    if (unique_values.length === 1) return unique_values[0];

    return values;
  }

  // todo: remove duplicates and merge similar values
  return null;
};

/**
 *
 * @param {Object} obj
 * @returns {String[]}
 */
const get_all_keys_helper = (obj) => {
  // Edge case: DateTime dtype is consider an object, so ignore it
  if (obj instanceof DateTime) return [];

  // If it's not an object, there's nothing left to traverse, so just return
  // an empty array
  if (
    !(typeof obj === "object" || obj instanceof Object) ||
    obj instanceof Array
  )
    return [];

  keys = [];
  for (let key of Object.keys(obj)) {
    // Add the current key
    keys = keys.concat([key]);
    // Check to see if the value is an object
    keys = keys.concat(get_all_keys(obj[key]));
  }

  return keys;
};

/**
 * Extract all unique keys from all levels of an object
 * @param {Object} obj
 */
const get_all_keys = (obj) => {
  return Array.from(new Set(get_all_keys_helper(obj)));
};

/**
 * Iterates over all keys in object (nested), and extracts any arrays with a
 * single value to just the value in place
 * @param {Object} obj
 */
const convertShortArraysToSingleValues = (obj) => {
  const keys = Object.keys(obj);
  for (const key of keys) {
    value = obj[key];
    if (value instanceof Array && value.length === 1) {
      obj[key] = value[0];
    }
    if (obj[key] instanceof Object) {
      convertShortArraysToSingleValues(obj[key]);
    }
  }
};

/**
 * Extract session name
 * @param {Object} json
 * @returns {String}
 */
exports.__get_session_name = (data) => {
  const keys = get_all_keys(data);
  let Project_name = "";
  if ("Project_Folder" in keys) {
    Project_name = lookup("Project_Folder", data);
  } else {
    Project_name = lookup("Project_folder", data);
  }
  Project_name = Project_name.replace(/\\/g, "/"); // b/c Windows
  return path.basename(Project_name);
};

/**
 * Extracts the acquisition begin value
 * @param {Object} json Contents of .NSIPRO in JSON format
 * @returns {DateTime} start time of acquisition
 */
exports.__get_acquisition_begin = (data) => {
  // Start time for scan
  if (
    "acquisition_begin" in
    Object.keys(data["NSI_Reconstruction_Project"]["CT_Project_Configuration"])
  ) {
    acquisition_begin =
      data["NSI_Reconstruction_Project"]["CT_Project_Configuration"][
        "acquisition_begin"
      ];

    // Edge case: Very rarely, the NSI software may record the
    //   acquisition time more than once
    if (acquisition_begin instanceof Array) {
      unique_timestamps = Array.from(new Set(acquisition_begin));
      if (unique_timestamps.length == 1) {
        acquisition_begin = unique_timestamps[0];
      }
    }
  } else {
    acquisition_begin = data["NSI_Reconstruction_Project"]["Creation_Date"];
  }
  return new DateTime(acquisition_begin);
};

exports.__get_acquisition_end = (data) => {
  // End time for scan
  return keysInObject(data, "acquisition_end")[0];
};

exports.__get_type = (data) => {
  // There's a chance that this returns an empty list, so make sure to
  // check for truthy values before returning. Reminder: an empty list is
  // falsy
  let category = null;
  const categories = ["MosaiX", "VorteX"];
  const subcategories = ["step", "continuous"];
  let value = lookup("Scan_Type", data);
  if (value) {
    // Determine the category (i.e., VorTeX continuous -> VorteX)
    for (let c of categories) {
      if (value.includes(c)) {
        category = c;
        break;
      }
    }

    if (!category)
      // likely a standard scan
      category = "Standard";

    return [value, category];
  } else {
    // For older versions, the type was only stored in <Comments>
    let comments = lookup("Comments", data);
    if (comments) {
      categories.push("Helical");
      pattern = /^(?<scan_type>.*) scan completed .*$/;
      // Since more than one comment could be returned, just assume
      // that it should be a list. So create a list of a single value
      // if just a string is found
      if (comments instanceof String || typeof comments === "string") {
        comments = [comments];
      }
      for (comment of comments) {
        let m = comment.match(pattern);
        if (m) {
          if ("scan_type" in m.groups()) {
            value = m.group("scan_type");
            for (let c of categories) {
              if (value.includes(c)) {
                category = c;
                break;
              }
            }
          }
        }
      }

      if (!category)
        // likely a standard scan
        category = "Standard";

      return [value, category];
    }
  }

  // IF we reach here, no scan type could be found
  return [null, null];
};

exports.lookup = lookup;
exports.get_all_keys = get_all_keys;
exports.convertShortArraysToSingleValues = convertShortArraysToSingleValues;