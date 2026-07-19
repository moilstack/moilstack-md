const sharp    = require('sharp');
const pngToIco = require('png-to-ico');
const fs       = require('fs');
const path     = require('path');
const os       = require('os');

const PNG_SRC     = path.join(__dirname, '../src/assets/icon.png');
const ICO_DEST    = path.join(__dirname, '../src/assets/icon.ico');
const APPX_DIR    = path.join(__dirname, 'appx');
const LINUX_DIR   = path.join(__dirname, 'icons');
const SIZES       = [16, 32, 44, 48, 150, 256, 310];
// electron-builder's Linux icon set: named by size so its packager can read
// dimensions from the filename instead of decoding the PNG (see build/icons
// vs. a single flat icon.png — the latter trips app-builder's size sniffer).
const LINUX_SIZES = [16, 32, 48, 64, 128, 256, 512, 1024];

const APPX_ASSETS = [
  { name: 'Square44x44Logo.png',   size: 44  },
  { name: 'Square150x150Logo.png', size: 150 },
  { name: 'Square310x310Logo.png', size: 310 },
  { name: 'Wide310x150Logo.png',   w: 310, h: 150 },
  { name: 'StoreLogo.png',         size: 50  },
];

async function run() {
  const pngBuffer = fs.readFileSync(PNG_SRC);
  const tmpDir    = os.tmpdir();
  const tmpFiles  = [];

  console.log('Generating PNG sizes for ICO…');
  for (const size of SIZES) {
    const outPath = path.join(tmpDir, `icon-${size}.png`);
    await sharp(pngBuffer)
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

  console.log('Generating AppX visual assets…');
  if (!fs.existsSync(APPX_DIR)) fs.mkdirSync(APPX_DIR);
  for (const asset of APPX_ASSETS) {
    const w = asset.w || asset.size;
    const h = asset.h || asset.size;
    const outPath = path.join(APPX_DIR, asset.name);
    await sharp(pngBuffer)
      .resize(w, h, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toFile(outPath);
    console.log(`  ${asset.name} (${w}x${h}) ✓`);
  }
  console.log(`Done → ${APPX_DIR}`);

  console.log('Generating Linux icon set…');
  if (!fs.existsSync(LINUX_DIR)) fs.mkdirSync(LINUX_DIR);
  for (const size of LINUX_SIZES) {
    const outPath = path.join(LINUX_DIR, `${size}x${size}.png`);
    await sharp(pngBuffer)
      .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toFile(outPath);
    console.log(`  ${size}x${size} ✓`);
  }
  console.log(`Done → ${LINUX_DIR}`);
}

run().catch(err => {
  console.error('Failed:', err.message);
  process.exit(1);
});
