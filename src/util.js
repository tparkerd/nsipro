import { DateTime } from "luxon";
import { basename } from "path";
import keysInObject from "keys-in-object";

const datetime_format = "dd-LLL-yy h:mm:ss a";
const datetime_format_alt = "LL/dd/yyyy h:mm:ss a";

/**
 *
 * @param {String} key Name of key
 * @param {Object} obj Search space
 * @returns {} value
 */
const lookup = (key, obj) => {
  if (!(obj instanceof Object || typeof obj === "object")) return;

  // Get values of all instances in object
  let values = keysInObject(obj, key);

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

  let keys = [];
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
    let value = obj[key];
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
export function __get_session_name(data) {
  const keys = get_all_keys(data);
  let Project_name = "";
  if ("Project_Folder" in keys) {
    Project_name = lookup("Project_Folder", data);
  } else {
    Project_name = lookup("Project_folder", data);
  }
  Project_name = Project_name.replace(/\\/g, "/"); // b/c Windows
  return basename(Project_name);
}

/**
 * Extracts the acquisition begin value
 * @param {Object} json Contents of .NSIPRO in JSON format
 * @returns {DateTime} start time of acquisition
 */
export function __get_acquisition_start(data) {
  // Start time for scan
  let acquisition_start;

  if (
    Object.keys(data["NSI_Reconstruction_Project"]).includes("Creation_Date")
  ) {
    acquisition_start = data["NSI_Reconstruction_Project"]["Creation_Date"];
  } else {
    console.error("Creation date could not be located.");
  }

  // If the earlier steps were able to convert into a datatime object,
  // just return that.
  if (acquisition_start instanceof DateTime) return acquisition_start;

  let dt;
  let str = acquisition_start;
  // There are two possible formats used, depending on the NSI software version
  dt = DateTime.fromFormat(str, datetime_format);
  if (dt.isValid) return dt;

  // Example: 12/14/2016 10:59:24 AM
  // month/day/year hour:minute:second meridiem
  dt = DateTime.fromFormat(str, datetime_format_alt);
  if (dt.isValid) return dt;

  return dt;
}

export function __get_acquisition_finish(data) {
  // End time for scan
  let dt;
  let pattern = /(^.*scan.*completed.*)(?<timestamp>\d{2}\-\w{3}\-\d+\s+\d+\:\d+\:\d+\s+[AP]M)/i;
  if (Object.keys(data["NSI_Reconstruction_Project"]).includes("Comments")) {
    let comments = keysInObject(data["NSI_Reconstruction_Project"], "Comments");
    if (comments instanceof String || typeof comments === "string") {
      comments = [comments];
    }
    for (let comment of comments) {
      if (typeof comment === "undefined") continue;
      let match = comment.match(pattern);
      let str = match.groups.timestamp;
      // There are two possible formats used, depending on the NSI software version
      dt = DateTime.fromFormat(str, datetime_format);
      if (dt.isValid) return dt;

      // Example: 12/14/2016 10:59:24 AM
      // month/day/year hour:minute:second meridiem
      dt = DateTime.fromFormat(str, datetime_format_alt);
      if (dt.isValid) return dt;

      return dt;
    }
  }
}

export function __get_type(data) {
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
      let pattern = /^(?<scan_type>.*) scan completed .*$/;
      // Since more than one comment could be returned, just assume
      // that it should be a list. So create a list of a single value
      // if just a string is found
      if (comments instanceof String || typeof comments === "string") {
        comments = [comments];
      }
      for (let comment of comments) {
        let m = comment.match(pattern);
        if (m) {
          if ("scan_type" in m.groups) {
            value = m.groups.scan_type;
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
}

export function __get_source_to_detector_distance(data) {
  const tag =
    data["NSI_Reconstruction_Project"]["CT_Project_Configuration"][
      "Technique_Configuration"
    ]["Setup"];

  if (Object.keys(tag).includes("source_to_detector_distance")) {
    return tag["source_to_detector_distance"];
  } else {
    console.error("Couldn't find the source to detector distance");
  }
}

export function __get_source_to_table_distance(data) {
  const tag =
    data["NSI_Reconstruction_Project"]["CT_Project_Configuration"][
      "Technique_Configuration"
    ]["Setup"];
  if (Object.keys(tag).includes("source_to_table_distance"))
    return tag["source_to_table_distance"];
}

export function __get_pitch(data) {
  const tag =
    data["NSI_Reconstruction_Project"]["CT_Project_Configuration"][
      "Technique_Configuration"
    ];
  if (Object.keys(tag).includes("Ug")) {
    let value = lookup("det_pitch", tag["Ug"]);
    if (value) return value;
  }
}

export function __estimate_slicethickness(
  pitch,
  source_to_detector_distance,
  source_to_table_distance
) {
  if (pitch && source_to_detector_distance && source_to_table_distance) {
    return (pitch / source_to_detector_distance) * source_to_table_distance;
  }
  console.warn("Could not estimate slice thickness");
}

export function __get_resolution(data) {
  const tag = data["NSI_Reconstruction_Project"];
  // When a recon has been done
  if (Object.keys(tag).includes("Volume")) {
    let dimensions = lookup("resolution", tag["Volume"]);
    let dimentions = dimensions.split(/\s+/);
    let [w, d, h] = dimentions;
    return [w, h, d];
  }
}

// def __get_voltage():
// reported_voltage = lookup("kV",  data["NSI_Reconstruction_Project"]["CT_Project_Configuration"]["Technique_Configuration"])
// actual_voltage = lookup("actual_kV",  data["NSI_Reconstruction_Project"]["CT_Project_Configuration"]["Technique_Configuration"])
// # Edge case: sometimes an actual voltage is not recorded, so use the reported one instead
// if not actual_voltage:
//     actual_voltage = None
// return reported_voltage, actual_voltage

export function __get_voltage(data) {
  const tag =
    data["NSI_Reconstruction_Project"]["CT_Project_Configuration"][
      "Technique_Configuration"
    ];
  let reported_voltage = lookup("kV", tag);
  let actual_voltage = lookup("actual_kV", tag);

  // Edge case: sometimes an actual voltage is not recorded, so use the reported one instead
  if (!actual_voltage) actual_voltage = null;
  return [reported_voltage, actual_voltage];
}

export function __get_current(data) {
  const tag =
    data["NSI_Reconstruction_Project"]["CT_Project_Configuration"][
      "Technique_Configuration"
    ];

  let reported_current = lookup("uA", tag);
  let actual_current = lookup("actual_uA", tag);

  if (!actual_current) actual_current = null;
  return [reported_current, actual_current];
}

// NOTE(tparker): I'm not 100% sure that this is the actual filter that the technicians report
export function __get_filter(data) {
  const tag =
    data["NSI_Reconstruction_Project"]["CT_Project_Configuration"][
      "Technique_Configuration"
    ];
  return lookup("phys_filter", tag);
}

export function __get_framerate(data) {
  return lookup(
    "fps",
    data["NSI_Reconstruction_Project"]["CT_Project_Configuration"][
      "Technique_Configuration"
    ]["Detector"]
  );
}
export function __get_calcuated_Ug(data) {
  const tag =
    data["NSI_Reconstruction_Project"]["CT_Project_Configuration"][
      "Technique_Configuration"
    ];
  if (Object.keys(tag).includes("Ug")) {
    let value = lookup("#text", tag["Ug"]);
    if (value) {
      return parseFloat(value); // todo: remove surrounding parenthese and units
    }
  }

  let value = lookup("ug_text", tag["Ug"]);
  if (value) {
    let pattern = /^.*\((?<value>\S+)\s+pixels\)$/;
    let m = value.match(pattern);
    if (m) {
      if (value in m.groups) {
        return parseFloat(m.group.value);
      }
    }
  }
}
export function __get_zoom_factor(data) {
  const tag =
    data["NSI_Reconstruction_Project"]["CT_Project_Configuration"][
      "Technique_Configuration"
    ];
  if (Object.keys(tag).includes("Ug")) {
    let value = lookup("zoom_factor_text", tag["Ug"]);
    if (value) return parseFloat(value.slice(1)); // remove surrounding parentheses and units (in pixels)
  }
}
export function __get_projection_count(data) {
  return lookup("Number_of_projections");
}
export function __get_rotation_count(data) {
  // only applies to VorteX scans
  let vortex_metadata;
  const tag = data["NSI_Reconstruction_Project"]["CT_Project_Configuration"];
  if (Object.keys(tag).includes("VorteX")) {
    vortex_metadata = tag["VorteX"];
    if (vortex_metadata && Object.keys(vortex_metadata).includes("Revs"))
      return vortex_metadata["Revs"];
  }
}
export function __get_frames_averaged(data) {
  return lookup("Frame_averaging", data);
}
export function __get_helical_pitch(data) {
  const tag = data["NSI_Reconstruction_Project"]["CT_Project_Configuration"];
  if (Object.keys(tag).includes("VorteX")) {
    let vortex_metadata = tag["VorteX"];
    if (vortex_metadata && Object.keys(vortex_metadata).includes("Pitch")) {
      return vortex_metadata["Pitch"];
    }
  }
}
export function __get_defective_pixels(data) {
  let statuses = lookup("status", data);
  if (!Array.isArray(statuses)) {
    statuses = [statuses];
  }
  for (let status of statuses) {
    // Edge case: no status or defective pixels were reported/recorded
    if (!status) {
      continue;
    }
    let pattern = /(?<pixel_count>\d+)\s+defective .*$/i;
    let m = status.match(pattern);
    if (m && "pixel_count" in m.groups) {
      return parseInt(m.groups.pixel_count);
    }
  }
  return null;
}

const _lookup = lookup;
export { _lookup as lookup };
const _get_all_keys = get_all_keys;
export { _get_all_keys as get_all_keys };
const _convertShortArraysToSingleValues = convertShortArraysToSingleValues;
export { _convertShortArraysToSingleValues as convertShortArraysToSingleValues };
