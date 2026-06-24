/**
 * build/make-file-icon.js
 * Converts src/assets/file-icon-md.svg → src/assets/file-icon-md.ico
 * with sizes 16, 32, 48, 256 all embedded in one ICO file.
 *
 * Run:  npm run make-file-icon
 * Deps: sharp, png-to-ico  (devDependencies)
 */

const sharp     = require('sharp');
const pngToIco  = require('png-to-ico');
const fs        = require('fs');
const path      = require('path');
const os        = require('os');

const SVG_SRC  = path.join(__dirname, '../src/assets/file-icon-md.svg');
const ICO_DEST = path.join(__dirname, '../src/assets/file-icon-md.ico');
const SIZES    = [16, 32, 48, 256];

async function run() {
  const svgBuffer = fs.readFileSync(SVG_SRC);
  const tmpDir    = os.tmpdir();
  const tmpFiles  = [];

  console.log('Generating PNG sizes…');
  for (const size of SIZES) {
    const outPath = path.join(tmpDir, `file-icon-md-${size}.png`);
    await sharp(svgBuffer)
      .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toFile(outPath);
    tmpFiles.push(outPath);
    console.log(`  ${size}x${size} ✓`);
  }

  console.log('Packaging into ICO…');
  const icoBuffer = await pngToIco(tmpFiles);
  fs.writeFileSync(ICO_DEST, icoBuffer);

  tmpFiles.forEach(f => fs.unlinkSync(f));

  console.log(`Done → ${ICO_DEST}`);
}

run().catch(err => {
  console.error('Failed:', err.message);
  process.exit(1);
});
