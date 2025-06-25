#!/usr/bin/env node
import { CommandLineParser } from './src/command-line.js';
import { serverDirectory } from './src/server-directory.js';

const cliArgs = new CommandLineParser().parse(process.argv);
globalThis.DATA_ROOT = cliArgs.dataRoot;
globalThis.COMMAND_LINE_ARGS = cliArgs;
process.chdir(serverDirectory);

try {
    await import('./src/server-main.js');

    const PORT = process.env.PORT || cliArgs.port || 5000;
    console.log(`✅ Render-compatible startup: Server listening on port ${PORT}`);
} catch (error) {
    console.error('❌ A critical error has occurred while starting the server:', error);
    process.exit(1);
}
