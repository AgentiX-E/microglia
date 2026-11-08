/**
 * Read a committed artefact and ask what every consolidation floor would have done with its store.
 *
 * Written because the question R60 left open — is corroboration absent from the corpus, or hidden by
 * the floor — can be answered from an artefact already on disk, without spending a dispatch. Used
 * that way on R60's store before R61 was registered.
 */
import { readFileSync } from "node:fs";
import { sweepStoreItems, type SweepableItem } from "../store-sweep.js";

const THRESHOLDS = [0.4, 0.45, 0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.8];

function main(argv: readonly string[]): number {
  const path = argv[0];
  if (path === undefined) {
    process.stderr.write(
      "usage: store-sweep <poc-l4.json> [conditionMinShared]\n",
    );
    return 2;
  }
  const document = JSON.parse(readFileSync(path, "utf8")) as {
    tau2?: { storeItems?: { items?: readonly SweepableItem[] } };
  };
  const items = document.tau2?.storeItems?.items;
  if (items === undefined) {
    process.stderr.write(`${path} carries no sampled store\n`);
    return 2;
  }
  const conditionMinShared = Number(argv[1] ?? "0");
  process.stdout.write(
    `store: ${String(items.filter((item) => item.status !== "retired").length)} live of ${String(items.length)}, ` +
      `condition floor ${String(conditionMinShared)}\n`,
  );
  for (const point of sweepStoreItems(items, THRESHOLDS, conditionMinShared)) {
    const largest = point.groups[0];
    process.stdout.write(
      `  threshold ${point.threshold.toFixed(2)}: groups=${String(point.groups.length)} ` +
        `largest=${String(point.largestGroup)} refusedLink=${String(point.refusedLinkage)} ` +
        `weakest=${largest === undefined ? "—" : largest.weakestPair.toFixed(2)} ` +
        `support=[${point.groups.map((group) => `${String(group.supportFloor)}..${String(group.supportCeil)}`).join(",")}]\n`,
    );
  }
  return 0;
}

process.exitCode = main(process.argv.slice(2));
