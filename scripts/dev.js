#!/usr/bin/env node

/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { context } from 'esbuild';
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { getBuildOptions } from '../esbuild.config.js';

let childProcess = null;

// Start the dev server in a separate process.
const serverProcess = spawn('node', ['scripts/dev-server.js'], {
  stdio: ['inherit', 'inherit', 'inherit', 'ipc'],
  detached: true,
});

let serverReady = false;

serverProcess.on('message', async (message) => {
  if (message === 'ready') {
    serverReady = true;
    // Now that the server is ready, the build process will start.
  }
});

serverProcess.on('close', (code) => {
  if (!serverReady) {
    console.error(`Dev server exited with code ${code}`);
    process.exit(1);
  }
});

serverProcess.on('error', (err) => {
  console.error('Failed to start dev server.', err);
  process.exit(1);
});

// Timeout if the server doesn't start in a reasonable time.
setTimeout(() => {
  if (!serverReady) {
    console.error('Dev server timed out.');
    process.exit(1);
  }
}, 5000);

let isRestarting = false;

function startApp() {
  if (isRestarting) {
    return;
  }

  if (childProcess) {
    isRestarting = true;

    // Remove the listener that would shut down the whole dev environment,
    // since this is an intentional restart, not a user-initiated quit.
    childProcess.removeAllListeners('close');

    const exitTimeout = setTimeout(() => {
      console.log('App did not exit gracefully, forcing kill.');
      try {
        // Use process group killing to ensure all children are terminated.
        process.kill(-childProcess.pid, 'SIGKILL');
      } catch (_e) {
        // Ignore if process is already gone
      }
    }, 1000);

    childProcess.once('exit', () => {
      clearTimeout(exitTimeout);
      childProcess = null;
      isRestarting = false;
      startApp();
    });

    // Send graceful shutdown signal to the entire process group
    try {
      process.kill(-childProcess.pid, 'SIGUSR2');
    } catch (_e) {
      // Process might have already exited, clear timeout and restart
      clearTimeout(exitTimeout);
      childProcess = null;
      isRestarting = false;
      startApp();
    }
  } else {
    // No process running, so let's start one.
    process.stdout.write('\x1Bc'); // Clear console
    console.log('Starting the app...');
    childProcess = spawn('node', ['--enable-source-maps', 'bundle/gemini.js'], {
      stdio: ['inherit', 'inherit', 'inherit', 'ipc'],
      detached: true,
      env: {
        ...process.env,
        GEMINI_DEV_MODE: 'true',
        GEMINI_CHILD_PROCESS: 'true',
      },
    });

    childProcess.on('error', (err) => {
      console.error('Failed to start subprocess.', err);
      childProcess = null;
    });

    // This listener is for when the user quits the app from within (e.g. /quit)
    childProcess.on('close', (code) => {
      // Only exit the dev script if the app wasn't in the process of restarting
      if (!isRestarting) {
        console.log(`App exited with code ${code}. Shutting down dev server.`);
        cleanup();
        //process.exit(0);
      }
    });
  }
}

function cleanup() {
  if (childProcess) {
    childProcess.kill();
  }
  if (serverProcess) {
    serverProcess.kill();
  }
}

process.on('SIGINT', () => {
  cleanup();
  process.exit();
});
process.on('SIGTERM', () => {
  cleanup();
  process.exit();
});
process.on('exit', cleanup);

(async () => {
  await Promise.all([
    mkdir('dist', { recursive: true }),
    mkdir('bundle', { recursive: true }),
  ]);

  serverProcess.on('message', async (message) => {
    if (message === 'ready') {
      serverReady = true;
      // Now that the server is ready, start the build and watch process.
      const buildOptions = getBuildOptions(
        true,
        () => startApp(), // onRebuild
        () => startApp(), // onInitialBuildEnd
      );
      const contexts = await Promise.all(
        buildOptions.map((options) => context(options)),
      );
      contexts.forEach((context) => {
        context.watch();
      });
      console.log('watching for changes...');
    }
  });
})();
