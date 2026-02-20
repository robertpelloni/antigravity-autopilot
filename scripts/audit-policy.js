'use strict';

/**
 * Enforces root audit policy:
 * - Fail CI on any high/critical vulnerability.
 * - Allow moderate/low/info without failing this gate.
 */
const { execSync } = require('node:child_process');

/**
 * Temporary allowlist for known dev-tool vulnerabilities that currently have no
 * upstream fix available in this repository's supported toolchain.
 *
 * Rule: entries are ignored by package name. Keep this list narrow and review
 * periodically as upstream fixes land.
 */
const KNOWN_NOFIX_ALLOWLIST = new Set([
  '@typescript-eslint/eslint-plugin',
  '@typescript-eslint/parser',
  '@typescript-eslint/type-utils',
  '@typescript-eslint/typescript-estree',
  '@typescript-eslint/utils',
  '@vscode/vsce',
  'minimatch',
]);

function extractJson(raw) {
  if (!raw) return null;
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) return null;
  return raw.slice(start, end + 1);
}

function parseAuditReport(rawOutput) {
  const jsonText = extractJson(rawOutput);
  if (!jsonText) {
    throw new Error('Unable to parse npm audit JSON output.');
  }

  try {
    return JSON.parse(jsonText);
  } catch (error) {
    const message = error && typeof error.message === 'string' ? error.message : 'Unknown JSON parse error';
    throw new Error(`Invalid JSON from npm audit: ${message}`);
  }
}

function summarizeVulnerabilities(report) {
  const summary = report?.metadata?.vulnerabilities || {};
  const info = Number(summary.info || 0);
  const low = Number(summary.low || 0);
  const moderate = Number(summary.moderate || 0);
  const high = Number(summary.high || 0);
  const critical = Number(summary.critical || 0);
  const total = Number(summary.total || info + low + moderate + high + critical);

  return {
    total,
    info,
    low,
    moderate,
    high,
    critical,
  };
}

function getActionableSevereVulnerabilities(report) {
  const vulnerabilities = report?.vulnerabilities;
  if (!vulnerabilities || typeof vulnerabilities !== 'object') {
    return null;
  }

  const severeEntries = Object.entries(vulnerabilities).filter(([, details]) => {
    const severity = String(details?.severity || '').toLowerCase();
    return severity === 'high' || severity === 'critical';
  });

  const actionable = severeEntries.filter(([name]) => {
    const isAllowlisted = KNOWN_NOFIX_ALLOWLIST.has(name);
    return !isAllowlisted;
  });

  const allowlisted = severeEntries
    .filter(([name]) => KNOWN_NOFIX_ALLOWLIST.has(name))
    .map(([name]) => name)
    .sort();

  return {
    actionable,
    allowlisted,
  };
}

function runPolicy(options = {}) {
  const execCommand = options.execCommand || execSync;
  const logger = options.logger || console;

  let mergedOutput = '';
  try {
    mergedOutput = execCommand('npm audit --json', {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 25 * 1024 * 1024,
    }).trim();
  } catch (error) {
    const stdout = typeof error?.stdout === 'string' ? error.stdout : '';
    const stderr = typeof error?.stderr === 'string' ? error.stderr : '';
    mergedOutput = `${stdout}\n${stderr}`.trim();

    if (!mergedOutput) {
      const message = error && typeof error.message === 'string' ? error.message : 'Unknown execution error';
      logger.error('[audit:policy] Failed to execute npm audit:', message);
      return 2;
    }
  }

  let report;
  try {
    report = parseAuditReport(mergedOutput);
  } catch (error) {
    logger.error(`[audit:policy] ${error.message}`);
    if (mergedOutput) {
      logger.error(mergedOutput);
    }
    return 2;
  }

  const summary = summarizeVulnerabilities(report);
  const severe = getActionableSevereVulnerabilities(report);

  logger.log('[audit:policy] Vulnerability summary');
  logger.log(
    `  total=${summary.total} info=${summary.info} low=${summary.low} moderate=${summary.moderate} high=${summary.high} critical=${summary.critical}`
  );

  if (severe && severe.allowlisted.length > 0) {
    logger.log(
      `[audit:policy] Ignoring allowlisted no-fix severe advisories: ${severe.allowlisted.join(', ')}`
    );
  }

  if (severe) {
    if (severe.actionable.length > 0) {
      const names = severe.actionable.map(([name]) => name).sort().join(', ');
      logger.error(`[audit:policy] Policy violation: actionable high/critical vulnerabilities detected (${names}).`);
      return 1;
    }

    logger.log('[audit:policy] Policy pass: no actionable high/critical vulnerabilities.');
    return 0;
  }

  if (summary.high > 0 || summary.critical > 0) {
    logger.error('[audit:policy] Policy violation: high/critical vulnerabilities detected.');
    return 1;
  }

  logger.log('[audit:policy] Policy pass: no high/critical vulnerabilities.');
  return 0;
}

function main() {
  const exitCode = runPolicy();
  process.exit(exitCode);
}

if (require.main === module) {
  main();
}

module.exports = {
  extractJson,
  parseAuditReport,
  summarizeVulnerabilities,
  getActionableSevereVulnerabilities,
  runPolicy,
};
