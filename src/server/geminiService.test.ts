import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_GEMINI_MODEL,
  PRIMARY_FALLBACK_MODEL,
  SECONDARY_FALLBACK_MODEL,
  formatGeminiError,
  callGeminiWithRetryAndFallback,
  GeminiServerError,
} from './geminiService';

test('formatGeminiError preserves HTTP 403 status code and raw Google message', () => {
  const err = {
    status: 403,
    message: JSON.stringify({
      error: {
        code: 403,
        message: 'Permission denied for models/gemini-4-hydrogen',
        status: 'PERMISSION_DENIED',
      },
    }),
  };
  const formatted = formatGeminiError(err);
  assert.equal(formatted.statusCode, 403);
  assert.equal(formatted.statusText, 'PERMISSION_DENIED');
  assert.ok(formatted.message.includes('HTTP 403'));
  assert.ok(formatted.message.includes('Permission denied'));
});

test('formatGeminiError preserves HTTP 404 status code and NOT_FOUND reason', () => {
  const err = {
    status: 404,
    message: JSON.stringify({
      error: {
        code: 404,
        message: 'models/gemini-4-argon is not found',
        status: 'NOT_FOUND',
      },
    }),
  };
  const formatted = formatGeminiError(err);
  assert.equal(formatted.statusCode, 404);
  assert.equal(formatted.statusText, 'NOT_FOUND');
  assert.ok(formatted.message.includes('HTTP 404'));
  assert.ok(formatted.message.includes('not found'));
});

test('formatGeminiError preserves HTTP 429 status code and RESOURCE_EXHAUSTED', () => {
  const err = {
    status: 429,
    message: JSON.stringify({
      error: {
        code: 429,
        message: 'Resource has been exhausted',
        status: 'RESOURCE_EXHAUSTED',
      },
    }),
  };
  const formatted = formatGeminiError(err);
  assert.equal(formatted.statusCode, 429);
  assert.equal(formatted.statusText, 'RESOURCE_EXHAUSTED');
  assert.ok(formatted.message.includes('HTTP 429'));
});

test('formatGeminiError preserves HTTP 503 status code and UNAVAILABLE', () => {
  const err = {
    status: 503,
    message: 'The model is experiencing high demand (503 UNAVAILABLE)',
  };
  const formatted = formatGeminiError(err);
  assert.equal(formatted.statusCode, 503);
  assert.ok(formatted.message.includes('HTTP 503'));
});

test('DEFAULT_GEMINI_MODEL defaults to gemini-3.8-flash', () => {
  assert.equal(DEFAULT_GEMINI_MODEL, 'gemini-3.8-flash');
  assert.equal(PRIMARY_FALLBACK_MODEL, 'gemini-3.8-flash');
  assert.equal(SECONDARY_FALLBACK_MODEL, 'gemini-3.1-flash-lite');
});
