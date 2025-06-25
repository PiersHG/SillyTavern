#!/usr/bin/env node
import { CommandLineParser } from './src/command-line.js';
import { serverDirectory } from './src/server-directory.js';

// Parse CLI args and set global data root
const cliArgs = new CommandLineParser().parse(process.argv);
globalThis.DATA_ROOT = cliArgs.dataRoot;
globalThis.COMMAND_LINE_ARGS = cliArgs;

// Change working directory
process.chdir(serverDirectory);

try {
    // Start the main server
    const serverModule = await import('./src/server-main.js');

    // If the server exposes a way to override port, do it here
    if (serverModule?.default?.setPort) {
        const port = process.env.PORT || 5000;
        serverModule.default.setPort(port);
        console.log(`🔓 Applied Render PORT override: ${port}`);
    }

    console.log('✅ Server module loaded successfully');
} catch (error) {
    console.error('❌ A critical error has occurred while starting the server:', error);
}
