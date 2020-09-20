const xml2js = require("xml2js");
const { parseNumbers, parseBooleans } = require("xml2js/lib/processors");
const { DateTime } = require("luxon");
const {
  get_acquisition_begin,
  get_all_keys,
  convertShortArraysToSingleValues,
  lookup,
  __get_session_name,
  __get_acquisition_begin,
  __get_acquisition_end,
  __get_type,
} = require("./util.js");

/**
 * Converts .NSIPRO file's xml-like structure into standard XML format
 * @param {string} text
 * @returns {string} XML representation of NSIPRO file format
 */
const standardize = (text) => {
  tag_pattern = /<(?<content>[^<>]+)>/g;

  // Edge case: <ug text> can have the pixel value on the following line
  ug_text_pattern = /\s+(?<ug_text>\(\S+\s+pixels\))$/gm;
  ug_text_fixed = " $1";
  text = text.replace(ug_text_pattern, ug_text_fixed);

  // Split the text into individual lines
  lines = text.split(/\r?\n\s*/);

  // Remove spaces within tags
  lines = lines.map((line) => {
    return line.replace(tag_pattern, (match, content, str) => {
      return match.replace(/\s+/g, "_");
    });
  });

  // Close single-line tags
  open_tag_pattern = /^<(?<tag>[^>]+)>(?<value>[^<]+)$/;
  close_tags = "<$<tag>>$<value></$<tag>>";
  lines = lines.map((line) => {
    return line.replace(open_tag_pattern, close_tags);
  });

  // Edge case: <fixturing> can have a null value
  lines = lines.map((line) => {
    return line.replace(/^<fixturing>$/, "<fixturing></fixturing>");
  });

  // Edge case: <phys_filter> can have a null value
  lines = lines.map((line) => {
    return line.replace(/^<phys_filter>$/, "<phys_filter></phys_filter>");
  });

  // Edge case: <Software> can have a null value
  lines = lines.map((line) => {
    return line.replace(/^<Software>$/, "<Software></Software>");
  });
  // Edge case: <radio dir> and <radio series> can have a null value
  lines = lines.map((line) => {
    return line.replace(/^<radio_dir>$/, "<radio_dir></radio_dir>");
  });

  lines = lines.map((line) => {
    return line.replace(/^<radio_series>$/, "<radio_series></radio_series>");
  });

  text = lines.join("\n");
  return text;
};

/**
 * Converts XML to dictionary and casts Boolean and numeric values from string when possible
 * @param {string} xml
 * @returns XML representation of NSIPRO file format with numeric value casts to inferred types
 */
const cast_dtypes = async (xml) => {
  /**
   *
   * @param {String} str value
   * @returns {DateTime} timestamp
   */
  const parseTimestamp = (str) => {
    if (!(typeof str === "string" || str instanceof String)) {
      return str; // return unaltered value if not a string
    }
    let dt;

    // There are two possible formats used, depending on the NSI software version
    const datetime_format = "dd-LLL-yy hh:mm:ss a";
    dt = DateTime.fromFormat(str, datetime_format);
    if (dt.isValid) return dt;

    const datetime_format_alt = "LL/dd/kkkk hh:mm:ss a";
    dt = DateTime.fromFormat(str, datetime_format_alt);
    if (dt.isValid) return dt;

    return str;
  };

  const json = await xml2js.parseStringPromise(xml, {
    mergeAttrs: true,
    valueProcessors: [parseNumbers, parseBooleans, parseTimestamp],
  });

  // console.debug(xml);
  return json;
};

/**
 * Converts XML-like structure of the NSIPRO file format to JSON
 * @param {string} text Contents of NSIPRO file
 * @returns {Object} JSON object representation of text
 */
const parse = async (text) => {
  try {
    let xml = standardize(text);
    let json = await cast_dtypes(xml);
    convertShortArraysToSingleValues(json);

    const keys = Array.from(new Set(get_all_keys(json)));
    const acquisition_software_version = lookup("Acquisition_Software", json);

    // Collate key-value pairs of interest
    let session_name = __get_session_name(json);
    let acquisition_begin = __get_acquisition_begin(json);
    let acquisition_end = __get_acquisition_end(json);
    let acquisition_duration = acquisition_end.diff(
      acquisition_begin,
      "seconds"
    ); // duration as datetime object
    let uid = lookup("Part_name", json); // the 'part name' entered by technician
    if (!uid) {
      // alternative key sometimes stores the part name
      uid = lookup("Part_Name", json);
    }
    let [_type, type_category] = __get_type(json);
    // source_to_detector_distance = __get_source_to_detector_distance()
    // source_to_table_distance = __get_source_to_table_distance()
    // pitch = __get_pitch() // todo

    // // Dimensions
    // dimensions = __get_resolution()
    // if (dimensions) {
    //   width, height, depth = dimensions
    // }

    // reported_voltage, actual_voltage = __get_voltage()
    // reported_current, actual_current = __get_current()
    // _filter = __get_filter()
    // framerate = __get_framerate()
    // calculated_Ug = __get_calcuated_Ug()
    // zoom_factor = __get_zoom_factor()
    // projection_count = __get_projection_count()
    // rotation_count = __get_rotation_count() // only applies to VorteX scans
    // frames_averaged = __get_frames_averaged()
    // helical_pitch = __get_helical_pitch() // only applies to VorteX scans
    // defective_pixels = __get_defective_pixels()

    json["derived_fields"] = {};
    dfields = json["derived_fields"];
    // dfields["nsipro_filepath"] = fname

    // Scan Duration (acquisition)
    // ISO format: YYYY-MM-DDThh:mm:ssTZD
    dfields["acquisition_begin"] = acquisition_begin;
    dfields["acquisition_end"] = acquisition_end;
    dfields["acquisition_duration"] = acquisition_duration.seconds;

    // Identifiers
    // NSI Project folder (i.e., session name)
    dfields["session_name"] = session_name;
    dfields["uid"] = uid;

    // High-level scan details
    dfields["scan_type"] = _type;
    dfields["scan_type_category"] = type_category;
    dfields["acquisition_software_version"] = acquisition_software_version;
    // dfields["source_to_detector_distance"] = source_to_detector_distance
    // dfields["source_to_table_distance"] = source_to_table_distance

    // dfields["pitch"] = pitch
    // if pitch:
    //     dfields["estimated_slicethickness"] = __estimate_slicethickness(pitch, source_to_detector_distance, source_to_table_distance)
    // else:
    //     dfields["estimated_slicethickness"] = None

    // if dimensions:
    //     dfields["dimensions"] = {}
    //     dfields["dimensions"]["width"] = width
    //     dfields["dimensions"]["height"] = height
    //     dfields["dimensions"]["depth"] = depth
    //     dfields["dimensions"]["xyz"] = dimensions

    // dfields["source"] = {}
    // dfields["source"]["voltage"] = {}
    // dfields["source"]["voltage"]["reported_voltage"] = reported_voltage
    // dfields["source"]["voltage"]["actual_voltage"] = actual_voltage
    // dfields["source"]["current"] = {}
    // dfields["source"]["current"]["reported_current"] = reported_current
    // dfields["source"]["current"]["actual_current"] = actual_current
    // dfields["filter"] = _filter
    // dfields["detector"] = {}
    // dfields["detector"]["framerate"] = framerate
    // dfields["calculated_Ug"] = calculated_Ug
    // dfields["zoom_factor"] = zoom_factor
    // dfields["projections"] = projection_count
    // dfields["rotations"] = rotation_count
    // dfields["frames_averaged"] = frames_averaged
    // dfields["helical_pitch"] = helical_pitch
    // dfields["defective_pixels"] = defective_pixels

    // console.log(json);
    return json;
  } catch (error) {
    console.error(error);
  }
};

exports.parse = parse;
