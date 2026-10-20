#!/usr/bin/env node
/**
 * Print what a Hugging Face dataset actually contains.
 *
 * The public-benchmark lane depends on two datasets whose contents have changed
 * between releases: one holds the questions, another holds the databases. Rather
 * than encoding an assumption about either, the lane prints the inventory first, so
 * a run that cannot find its data says what was there instead of what was expected.
 */
const DATASETS = process.argv.slice(2);

if (DATASETS.length === 0) {
  process.stderr.write('usage: node scripts/hf-inventory.mjs <owner/name> [...more]\n');
  process.exit(2);
}

for (const id of DATASETS) {
  try {
    const response = await fetch(`https://huggingface.co/api/datasets/${id}`);
    if (!response.ok) {
      process.stdout.write(`${id}: HTTP ${response.status}\n`);
      continue;
    }
    const body = await response.json();
    const files = (body.siblings ?? []).map((entry) => entry.rfilename);
    process.stdout.write(`${id}: ${files.length} files\n`);
    for (const file of files.slice(0, 40)) process.stdout.write(`  ${file}\n`);
    if (files.length > 40) process.stdout.write(`  ... ${files.length - 40} more\n`);
  } catch (error) {
    process.stdout.write(`${id}: unreachable (${String(error).slice(0, 120)})\n`);
  }
}
