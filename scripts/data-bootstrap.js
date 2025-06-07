const fs = require('fs');
const path = require('path');

const dataDir = path.join(__dirname, '../data');

if (!fs.existsSync(dataDir)) {
  console.log('📁 Creating /data directory...');
  fs.mkdirSync(dataDir);
} else {
  console.log('✅ /data already exists');
}
