'use strict';

/**
 * Enforces root audit policy:
 * - Fail CI on any high/critical vulnerability.
 * - Allow moderate/low/info without failing this gate.
 */
const { execSync } = require('node:child_process');

function extractJson(raw) {
  if (!raw) return null;
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) return null;
  return raw.slice(start, end + 1);
}

function main() {
  let mergedOutput = '';
  try {
    mergedOutput = execSync('npm audit --json', {
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
      console.error('[audit:policy] Failed to execute npm audit:', message);
      process.exit(2);
    }
  }

  const jsonText = extractJson(mergedOutput);

  if (!jsonText) {
    console.error('[audit:policy] Unable to parse npm audit JSON output.');
    if (mergedOutput) {
      console.error(mergedOutput);
    }
    process.exit(2);
  }

  let report;
  try {
    report = JSON.parse(jsonText);
  } catch (error) {
    console.error('[audit:policy] Invalid JSON from npm audit:', error.message);
    process.exit(2);
  }

  const summary = report?.metadata?.vulnerabilities || {};
  const info = Number(summary.info || 0);
  const low = Number(summary.low || 0);
  const moderate = Number(summary.moderate || 0);
  const high = Number(summary.high || 0);
  const critical = Number(summary.critical || 0);
  const total = Number(summary.total || info + low + moderate + high + critical);

  console.log('[audit:policy] Vulnerability summary');
  console.log(`  total=${total} info=${info} low=${low} moderate=${moderate} high=${high} critical=${critical}`);

  if (high > 0 || critical > 0) {
    console.error('[audit:policy] Policy violation: high/critical vulnerabilities detected.');
    process.exit(1);
  }

  console.log('[audit:policy] Policy pass: no high/critical vulnerabilities.');
  process.exit(0);
}

main();
