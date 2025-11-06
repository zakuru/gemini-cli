#!/usr/bin/env node

/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { WebSocketServer } from 'ws';

const wss = new WebSocketServer({ port: 8080 });

wss.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error(
      'Error: Port 8080 is already in use. Please close the other process.\n' +
        'On macOS/Linux, you can run: kill $(lsof -t -i:8080)',
    );
  } else {
    console.error('Failed to start dev state server:', error);
  }
  process.exit(1);
});

let state = {
  history: [],
  inputText: '',
};

wss.on('connection', (ws) => {
  console.log('Client connected');
  ws.send(JSON.stringify({ type: 'state', payload: state }));

  ws.on('message', (message) => {
    const { type, payload } = JSON.parse(message);
    if (type === 'state') {
      state = payload;
    } else if (type === 'state-saved') {
      if (process.send) {
        process.send('state-saved');
      }
    }
  });

  ws.on('close', () => {
    console.log('Client disconnected');
  });
});

wss.on('listening', () => {
  console.log('Dev state server listening on port 8080');
  if (process.send) {
    process.send('ready');
  }
});
