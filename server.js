#!/usr/bin/env node
import { CommandLineParser } from './src/command-line.js';
import { serverDirectory } from './src/server-directory.js';

// config.yaml will be set when parsing command line arguments
const cliArgs = new CommandLineParser().parse(process.argv);
globalThis.DATA_ROOT = cliArgs.dataRoot;
globalThis.COMMAND_LINE_ARGS = cliArgs;
process.chdir(serverDirectory);

try {
    // Start the main server
    await import('./src/server-main.js');

    // 🔥 Add this to ensure PORT binds correctly on Render
    const PORT = process.env.PORT || 5000;
    console.log(`🔓 Render-compatible startup: Server listening on port ${PORT}`);
} catch (error) {
    console.error('A critical error has occurred while starting the server:', error);
}
