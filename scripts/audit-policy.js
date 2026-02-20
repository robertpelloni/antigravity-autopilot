'use strict';

/**
 * Enforces root audit policy:
 * - Fail CI on any high/critical vulnerability.
 * - Allow moderate/low/info without failing this gate.
 */
const { execSync } = require('node:child_process');

const DEFAULT_ALLOWED_HIGH_PACKAGES = new Set([
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

function summarizeEffectivePolicyVulnerabilities(report, allowHighPackages = DEFAULT_ALLOWED_HIGH_PACKAGES) {
  const rawSummary = summarizeVulnerabilities(report);
  const vulnerabilityMap = report && typeof report === 'object' ? report.vulnerabilities : null;

  if (!vulnerabilityMap || typeof vulnerabilityMap !== 'object') {
    return {
      ...rawSummary,
      allowlistedHigh: 0,
      allowlistedCritical: 0,
      effectiveHigh: rawSummary.high,
      effectiveCritical: rawSummary.critical,
    };
  }

  let effectiveHigh = 0;
  let effectiveCritical = 0;
  let allowlistedHigh = 0;
  let allowlistedCritical = 0;

  for (const [packageName, details] of Object.entries(vulnerabilityMap)) {
    if (!details || typeof details !== 'object') continue;
    const severity = String(details.severity || '').toLowerCase();
    const isAllowlisted = allowHighPackages.has(packageName);

    if (severity === 'high') {
      if (isAllowlisted) allowlistedHigh += 1;
      else effectiveHigh += 1;
      continue;
    }

    if (severity === 'critical') {
      if (isAllowlisted) allowlistedCritical += 1;
      else effectiveCritical += 1;
    }
  }

  return {
    ...rawSummary,
    allowlistedHigh,
    allowlistedCritical,
    effectiveHigh,
    effectiveCritical,
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

  const summary = summarizeEffectivePolicyVulnerabilities(report);

  logger.log('[audit:policy] Vulnerability summary');
  logger.log(
    `  total=${summary.total} info=${summary.info} low=${summary.low} moderate=${summary.moderate} high=${summary.high} critical=${summary.critical}`
  );
  logger.log(
    `  effectiveHigh=${summary.effectiveHigh} effectiveCritical=${summary.effectiveCritical} allowlistedHigh=${summary.allowlistedHigh} allowlistedCritical=${summary.allowlistedCritical}`
  );

  if (summary.effectiveHigh > 0 || summary.effectiveCritical > 0) {
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
  summarizeEffectivePolicyVulnerabilities,
  runPolicy,
};
