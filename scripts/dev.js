#!/usr/bin/env node

/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { spawn } from 'node:child_process';
import { context } from 'esbuild';
import { mkdir } from 'node:fs/promises';
import { getBuildOptions } from '../esbuild.config.js';

let childProcess;
let isRestarting = false;

function startApp() {
  if (isRestarting) {
    return; // Don't stack up restarts
  }

  if (childProcess) {
    isRestarting = true;
    // Listen for the 'exit' event to know when it's safe to start the new process.
    childProcess.once('exit', () => {
      childProcess = null;
      isRestarting = false;
      startApp(); // Re-call startApp to spawn the new process.
    });

    try {
      // Kill the entire process group with SIGKILL for a more forceful termination.
      process.kill(-childProcess.pid, 'SIGKILL');
    } catch (_e) {
      // If killing fails (e.g., process already gone), just proceed with the restart.
      isRestarting = false;
      startApp();
    }
  } else {
    // This is the case where we actually spawn the process.
    // Clear the console to prevent UI ghosting from the previous run.
    process.stdout.write('\x1Bc');
    console.log('Starting the app...');
    childProcess = spawn('node', ['bundle/gemini.js'], {
      stdio: 'inherit',
      detached: true, // Create a new process group.
    });
    childProcess.on('error', (err) => {
      console.error('Failed to start subprocess.', err);
      childProcess = null; // Ensure we can restart if the process fails to start.
    });
  }
}

function cleanup() {
  if (childProcess) {
    try {
      process.kill(-childProcess.pid);
    } catch (_e) {
      // Ignore
    }
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

  const buildOptions = getBuildOptions(true, startApp);

  const contexts = await Promise.all(
    buildOptions.map((options) => context(options)),
  );
  contexts.forEach((context) => {
    context.watch();
  });
  console.log('watching for changes...');
})();
