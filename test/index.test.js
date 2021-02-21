const { parse } = require("../src/index.js");

console.log("Starting tests");

const resOne = parse("<NSI Project>Hello</NSI Project>");

console.log(resOne);
