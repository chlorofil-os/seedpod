// Lets `node --test` load modules that import 'vscode' by resolving it to a small stub.
const Module = require('module');
const path = require('path');
const stub = path.join(__dirname, 'vscode-stub.js');
const orig = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  return request === 'vscode' ? stub : orig.call(this, request, ...rest);
};
