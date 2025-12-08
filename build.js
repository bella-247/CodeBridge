const esbuild = require("esbuild");
const JavaScriptObfuscator = require("javascript-obfuscator");
const fs = require("fs");

// Files to process
const files = [
  { in: "src/background.js", out: "build/background.js" },
  { in: "src/content.js", out: "build/content.js" },
  { in: "src/popup.js", out: "build/popup.js" },
];

async function processFile(input, output) {
  const bundle = await esbuild.build({
    entryPoints: [input],
    bundle: false,
    minify: true,
    write: false,
  });

  const code = bundle.outputFiles[0].text;
  const obfuscated = JavaScriptObfuscator.obfuscate(code, {
    compact: true,
    controlFlowFlattening: true,
    stringArray: true,
    rotateStringArray: true,
    deadCodeInjection: true,
  }).getObfuscatedCode();

  fs.writeFileSync(output, obfuscated, "utf-8");
}

(async () => {
  for (const file of files) {
    await processFile(file.in, file.out);
  }
  console.log("Build completed: minified + obfuscated");
})();
