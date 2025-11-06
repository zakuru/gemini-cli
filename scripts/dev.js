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

serverProcess.on('message', (message) => {
  if (message === 'ready') {
    serverReady = true;
    startApp();
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
    childProcess.once('exit', () => {
      childProcess = null;
      isRestarting = false;
      startApp();
    });

    try {
      process.kill(-childProcess.pid, 'SIGKILL');
    } catch (_e) {
      // Ignore if process is already gone
      childProcess = null;
      isRestarting = false;
      startApp();
    }
  } else {
    // No process running, so let's start one.
    process.stdout.write('\x1Bc'); // Clear console
    console.log('Starting the app...');
    childProcess = spawn('node', ['--enable-source-maps', 'bundle/gemini.js'], {
      stdio: 'inherit',
      detached: true,
      env: { ...process.env, GEMINI_DEV_MODE: 'true' },
    });

    childProcess.on('error', (err) => {
      console.error('Failed to start subprocess.', err);
      childProcess = null;
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

  const buildOptions = getBuildOptions(true, startApp);

  const contexts = await Promise.all(
    buildOptions.map((options) => context(options)),
  );
  contexts.forEach((context) => {
    context.watch();
  });
  console.log('watching for changes...');
})();
