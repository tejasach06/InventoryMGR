const Module = require('module');
const path = require('path');

// Add frontend node_modules to module search paths
const frontendNodeModules = path.join(__dirname, 'frontend', 'node_modules');
Module.globalPaths.push(frontendNodeModules);
process.env.NODE_PATH = frontendNodeModules;

// Now require and run the evaluation
import('./evaluate-inventory-final.js').catch(err => {
  console.error('Failed to run evaluation:', err);
  process.exit(1);
});
