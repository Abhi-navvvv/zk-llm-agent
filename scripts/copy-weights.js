const fs = require('fs');
const path = require('path');

const srcDir = path.join(__dirname, '../model/weights');
const webDestDir = path.join(__dirname, '../apps/web/public/weights');
const programDestDir = path.join(__dirname, '../program');

const filesToCopy = ['weights.bin', 'config.json', 'test_case.json'];

console.log('Copying weights, config, and test_case files...');

// Ensure destination directories exist
fs.mkdirSync(webDestDir, { recursive: true });
fs.mkdirSync(programDestDir, { recursive: true });

filesToCopy.forEach(file => {
  const src = path.join(srcDir, file);
  if (fs.existsSync(src)) {
    // Copy to web public directory
    const webDest = path.join(webDestDir, file);
    fs.copyFileSync(src, webDest);
    console.log(`  -> Copied to web: ${webDest}`);
    
    // Copy to program root
    const programDest = path.join(programDestDir, file);
    fs.copyFileSync(src, programDest);
    console.log(`  -> Copied to program: ${programDest}`);
  } else {
    console.warn(`  [WARNING] Source file not found: ${src}`);
  }
});

console.log('Files copied successfully.');
