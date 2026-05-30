/**
 * ingest-zoom-session.js
 * 
 * CLI to ingest session data from zoom_* collections into the Spurti ledger.
 * 
 * Usage:
 *   node ingest-zoom-session.js --date 2026-05-29          # ingest one date
 *   node ingest-zoom-session.js --all                       # ingest all missing dates
 *   node ingest-zoom-session.js --date 2026-05-29 --dry-run  # preview without writing
 *   node ingest-zoom-session.js --date 2026-05-27 --force   # re-ingest even if exists
 *   node ingest-zoom-session.js --date 2026-05-29 --skip-polls
 */

import { ingestZoomSession, ingestAllMissingDates, buildSessionLabel } from './lib/ingestZoomCollections.js';

function args(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) continue;
    const key = argv[i].slice(2);
    const value = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
    out[key] = value;
  }
  return out;
}

async function main() {
  const options = args(process.argv.slice(2));

  if (options.all) {
    console.log('\n🔍 Scanning for all missing session ingestions...\n');
    const results = await ingestAllMissingDates({
      dryRun: options['dry-run'] || false,
      force: options.force || false,
      skipAttendance: options['skip-attendance'] || false,
      skipPolls: options['skip-polls'] || false,
    });
    console.log('\n📊 Summary:');
    results.forEach(r => {
      if (r.success) {
        console.log(`  ✅ ${r.sessionLabel}: att=${r.stats.attendance}, polls=${r.stats.pollRecords}`);
      } else {
        console.log(`  ⏭️  ${r.sessionLabel || r.date}: ${r.reason}`);
      }
    });
    return;
  }

  if (!options.date) {
    console.error('Usage:\n  node ingest-zoom-session.js --date 2026-05-29\n  node ingest-zoom-session.js --all\n  node ingest-zoom-session.js --date 2026-05-29 --dry-run\n  node ingest-zoom-session.js --date 2026-05-27 --force --skip-attendance  (add missing polls)');
    process.exit(1);
  }

  const result = await ingestZoomSession(options.date, {
    dryRun: options['dry-run'] || false,
    force: options.force || false,
    skipAttendance: options['skip-attendance'] || false,
    skipPolls: options['skip-polls'] || false,
  });

  if (!result.success) {
    if (result.reason === 'already_ingested') {
      console.log('\n💡 Use --force to re-ingest, or --skip-attendance/--skip-polls to do partial ingest.');
    }
    process.exit(1);
  }
}

main().catch(async (err) => {
  console.error('\n❌ Error:', err);
  process.exit(1);
});
