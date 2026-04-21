const fs = require('fs');
const path = require('path');

const filePaths = [
  path.join(__dirname, '../node_modules/@nillion/nuc/dist/lib.mjs'),
  path.join(__dirname, '../node_modules/@nillion/nuc/dist/chunk-DQk6qfdC.mjs')
];

for (const filePath of filePaths) {
  if (fs.existsSync(filePath)) {
    let content = fs.readFileSync(filePath, 'utf8');
    
    // Replace FOUR_WEEKS_MS limit from 672 to 1000 hours (approx 41 days)
    if (content.includes('672 * ONE_HOUR_MS')) {
      content = content.replace(/672 \* ONE_HOUR_MS/g, '1000 * ONE_HOUR_MS');
      fs.writeFileSync(filePath, content, 'utf8');
      console.log(`Patched ${filePath}`);
    } else {
      console.log(`Skipped ${filePath} - pattern not found.`);
    }
  } else {
    console.log(`Skipped ${filePath} - file not found.`);
  }
}
