"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");

let tracking = false;

function track(value) {
  tracking = value !== false;
  return module.exports;
}

function resolvePrefix(affixes, defaultPrefix) {
  if (!affixes) {
    return { prefix: defaultPrefix, dir: os.tmpdir() };
  }

  if (typeof affixes === "string") {
    return { prefix: affixes, dir: os.tmpdir() };
  }

  return {
    prefix: affixes.prefix || defaultPrefix,
    suffix: affixes.suffix || "",
    dir: affixes.dir || os.tmpdir(),
  };
}

function makePath(affixes, defaultPrefix) {
  const spec = resolvePrefix(affixes, defaultPrefix);
  const prefix = String(spec.prefix || defaultPrefix || "");
  const dir = spec.dir || os.tmpdir();
  const suffix = spec.suffix || "";
  return path.join(dir, `${prefix}${Date.now()}-${process.pid}-${Math.random().toString(16).slice(2)}${suffix}`);
}

function mkdir(affixes, callback) {
  const target = makePath(affixes, "d-");
  fs.mkdir(target, { recursive: true }, (err) => {
    if (callback) {
      callback(err || null, target);
    }
  });
  return target;
}

function mkdirSync(affixes) {
  const target = makePath(affixes, "d-");
  fs.mkdirSync(target, { recursive: true });
  return target;
}

function cleanup(callback) {
  if (callback) callback(null, { files: 0, dirs: 0 });
}

function cleanupSync() {
  return { files: 0, dirs: 0 };
}

module.exports = {
  track,
  mkdir,
  mkdirSync,
  cleanup,
  cleanupSync,
};
