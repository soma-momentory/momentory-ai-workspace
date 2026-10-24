import test from 'node:test';
import assert from 'node:assert/strict';
import { greeting } from './index.mjs';
test('greeting',()=>assert.equal(greeting('Workspace'),'Hello, Workspace!'));
