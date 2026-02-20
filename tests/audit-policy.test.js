'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  extractJson,
  parseAuditReport,
  summarizeVulnerabilities,
  getActionableSevereVulnerabilities,
  runPolicy,
} = require('../scripts/audit-policy.js');

function createLogger() {
  const logs = [];
  const errors = [];
  return {
    logger: {
      log: (...args) => logs.push(args.join(' ')),
      error: (...args) => errors.push(args.join(' ')),
    },
    logs,
    errors,
  };
}

test('extractJson returns null for empty input', () => {
  assert.equal(extractJson(''), null);
});

test('extractJson extracts JSON from noisy output', () => {
  const input = 'prefix noise\n{"metadata":{"vulnerabilities":{"high":0}}}\nsuffix';
  const output = extractJson(input);
  assert.equal(output, '{"metadata":{"vulnerabilities":{"high":0}}}');
});

test('parseAuditReport parses valid report', () => {
  const report = parseAuditReport('{"metadata":{"vulnerabilities":{"total":0}}}');
  assert.equal(report.metadata.vulnerabilities.total, 0);
});

test('parseAuditReport throws on invalid report', () => {
  assert.throws(() => parseAuditReport('not-json'), /Unable to parse npm audit JSON output/);
});

test('summarizeVulnerabilities normalizes missing fields', () => {
  const summary = summarizeVulnerabilities({ metadata: { vulnerabilities: { high: 1 } } });
  assert.deepEqual(summary, {
    total: 1,
    info: 0,
    low: 0,
    moderate: 0,
    high: 1,
    critical: 0,
  });
});

test('runPolicy returns 0 when high/critical are zero', () => {
  const mockOutput = JSON.stringify({
    metadata: {
      vulnerabilities: {
        total: 2,
        info: 1,
        low: 1,
        moderate: 0,
        high: 0,
        critical: 0,
      },
    },
  });

  const { logger, errors } = createLogger();
  const exitCode = runPolicy({
    execCommand: () => mockOutput,
    logger,
  });

  assert.equal(exitCode, 0);
  assert.equal(errors.length, 0);
});

test('runPolicy returns 1 when high vulnerabilities exist', () => {
  const mockOutput = JSON.stringify({
    metadata: {
      vulnerabilities: {
        total: 1,
        high: 1,
      },
    },
  });

  const { logger, errors } = createLogger();
  const exitCode = runPolicy({
    execCommand: () => mockOutput,
    logger,
  });

  assert.equal(exitCode, 1);
  assert.ok(errors.some((line) => line.includes('Policy violation')));
});

test('getActionableSevereVulnerabilities ignores allowlisted no-fix advisories', () => {
  const report = {
    vulnerabilities: {
      minimatch: {
        severity: 'high',
        fixAvailable: false,
      },
      '@typescript-eslint/parser': {
        severity: 'high',
        fixAvailable: false,
      },
    },
  };

  const severe = getActionableSevereVulnerabilities(report);
  assert.ok(severe);
  assert.equal(severe.actionable.length, 0);
  assert.deepEqual(severe.allowlisted, ['@typescript-eslint/parser', 'minimatch']);
});

test('runPolicy fails when non-allowlisted severe advisory exists', () => {
  const mockOutput = JSON.stringify({
    vulnerabilities: {
      minimatch: {
        severity: 'high',
        fixAvailable: false,
      },
      'some-runtime-package': {
        severity: 'critical',
        fixAvailable: false,
      },
    },
    metadata: {
      vulnerabilities: {
        total: 2,
        high: 1,
        critical: 1,
      },
    },
  });

  const { logger, errors } = createLogger();
  const exitCode = runPolicy({
    execCommand: () => mockOutput,
    logger,
  });

  assert.equal(exitCode, 1);
  assert.ok(errors.some((line) => line.includes('some-runtime-package')));
});

test('runPolicy parses JSON from command error stdout/stderr', () => {
  const error = new Error('audit returned non-zero');
  error.stdout = '';
  error.stderr = JSON.stringify({
    metadata: {
      vulnerabilities: {
        total: 0,
        high: 0,
        critical: 0,
      },
    },
  });

  const { logger, errors } = createLogger();
  const exitCode = runPolicy({
    execCommand: () => {
      throw error;
    },
    logger,
  });

  assert.equal(exitCode, 0);
  assert.equal(errors.length, 0);
});

test('runPolicy returns 2 when command fails without output', () => {
  const error = new Error('spawn failed');
  error.stdout = '';
  error.stderr = '';

  const { logger, errors } = createLogger();
  const exitCode = runPolicy({
    execCommand: () => {
      throw error;
    },
    logger,
  });

  assert.equal(exitCode, 2);
  assert.ok(errors.some((line) => line.includes('Failed to execute npm audit')));
});
