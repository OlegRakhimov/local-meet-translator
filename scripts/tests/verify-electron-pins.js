const fs = require("fs");
const path = require("path");

const pkgPath = path.resolve(__dirname, "..", "..", "desktop-app", "package.json");
const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));

const expected = {
  electron: "42.5.0",
  "electron-builder": "26.15.3",
};

for (const [name, version] of Object.entries(expected)) {
  if (!pkg.devDependencies || pkg.devDependencies[name] !== version) {
    throw new Error(
      `${name} must stay pinned to ${version}, found ${pkg.devDependencies && pkg.devDependencies[name]}`,
    );
  }
}

console.log("Electron pins are locked.");
