/**
 * What the clock costs, printed before the first call.
 *
 * The provider bills in two bands and peak is exactly double, so the same dispatch costs 1.9× for the
 * same tokens depending on when it starts. R77 ran at 23:19 UTC and paid $0.531 for 6,946 calls; R78 ran
 * the same experiment at 03:19 UTC and paid $1.111 for 6,943 — 95% of it at peak. Nothing about the
 * experiment improved by running it at 11:19 Beijing time.
 *
 * `bandOf` and `nextOffPeak` have existed since the rate card was written and **nothing called them**,
 * which is the failure this package treats as a defect rather than an omission: a cost mechanism that
 * only exists in a document is not a mechanism. This is the call site.
 *
 * It prints rather than refuses. A guard that stops a dispatch at 11:00 and says "try again at 16:30" is
 * a guard an operator overrides — and an experiment that was ready to run is a real thing to lose. The
 * line is a `::warning::` when the moment is peak, so it appears on the run's own page beside the
 * numbers it applies to, and `next_off_peak` names the hour rather than leaving the reader to work it
 * out.
 *
 * Output, one line, on `$GITHUB_OUTPUT` when that path is set:
 *
 *   band=peak|off_peak
 *   next_off_peak=<ISO 8601, unchanged when the moment is already off-peak>
 *   usd_multiplier=2.0|1.0
 */
import { appendFileSync } from 'node:fs';
import { bandOf, nextOffPeak } from '@agentix-e/microglia-eval';

function main(argv: readonly string[]): number {
  const at = argv.indexOf('--at');
  const when = at === -1 ? new Date() : new Date(argv[at + 1] ?? '');
  if (Number.isNaN(when.getTime())) {
    process.stdout.write(`[band] --at needs an ISO timestamp\n`);
    return 1;
  }

  const band = bandOf(when);
  const offPeakAt = nextOffPeak(when);
  const multiplier = band === 'peak' ? '2.0' : '1.0';
  const iso = (date: Date): string => date.toISOString().replace(/\.\d{3}Z$/, 'Z');

  // The same sentence the guard would say if it refused, minus the refusal: what the moment costs, and
  // when it stops costing that.
  process.stdout.write(
    band === 'peak'
      ? `[band] ${iso(when)} is peak — the same tokens cost twice as much; off-peak from ${iso(offPeakAt)}\n`
      : `[band] ${iso(when)} is off-peak — this dispatch is at the cheaper rate\n`,
  );

  const output = process.env['GITHUB_OUTPUT'];
  if (output !== undefined && output !== '') {
    appendFileSync(output, `band=${band}\nnext_off_peak=${iso(offPeakAt)}\nusd_multiplier=${multiplier}\n`);
  }
  if (band === 'peak') {
    // The annotation form reaches the run's summary page. `::warning::` rather than `::error::` because
    // the run is going ahead: this is a price, not a verdict.
    process.stdout.write(
      `::warning::this dispatch starts at peak rate (2.0x); the identical run from ${iso(offPeakAt)} would be billed at 1.0x\n`,
    );
  }
  return 0;
}

process.exitCode = main(process.argv.slice(2));
