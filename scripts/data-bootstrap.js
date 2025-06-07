import { mkdirSync, existsSync } from 'fs';
import { dirname } from 'path';
import { fileURLToPath } from 'url';

// __dirname workaround for ESM
const __dirname = dirname(fileURLToPath(import.meta.url));

const dataDir = `${__dirname}/../data`;

if (!existsSync(dataDir)) {
  console.log('📁 Creating /data directory...');
  mkdirSync(dataDir);
} else {
  console.log('✅ /data already exists');
}
