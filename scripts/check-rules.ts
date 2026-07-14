import { decide, type AdSetStat } from "@/lib/optimize/rules";

let passed = 0;
let failed = 0;

function check(name: string, condition: boolean, detail = "") {
  if (condition) {
    passed++;
    console.log(`  PASS  ${name}`);
  } else {
    failed++;
    console.log(`  FAIL  ${name} ${detail}`);
  }
}

const ad = (over: Partial<AdSetStat["ads"][number]> = {}) => ({
  adId: "a1",
  name: "Ad A",
  status: "ACTIVE",
  impressions: 10_000,
  clicks: 200, // 2%
  ctr: 2,
  spend: 100,
  leads: 0,
  cpl: null,
  ...over,
});

const adSet = (over: Partial<AdSetStat> = {}): AdSetStat => ({
  adSetId: "s1",
  name: "Broad",
  dailyBudget: 60_000, // ₹600/day
  ads: [ad()],
  ...over,
});

console.log("\n1. Loser ad is paused and a replacement queued");
{
  const decisions = decide({
    adSets: [
      adSet({
        ads: [
          ad({ adId: "a1", name: "Ad A", ctr: 0.8, clicks: 40, impressions: 5_000 }),
          ad({ adId: "a2", name: "Ad B", ctr: 2.0, clicks: 100, impressions: 5_000 }),
        ],
      }),
    ],
    maxDailyBudget: null,
  });
  const pause = decisions.find((d) => d.action === "PAUSE_AD");
  check("pauses the 0.8% ad", pause?.action === "PAUSE_AD" && pause.adId === "a1");
  check("queues a replacement creative", decisions.some((d) => d.action === "QUEUE_CREATIVE"));
  console.log(`        reason: "${pause && "reason" in pause ? pause.reason : ""}"`);
}

console.log("\n2. Never pauses the last active ad (would kill delivery)");
{
  const decisions = decide({
    adSets: [
      adSet({ ads: [ad({ adId: "solo", ctr: 0.2, clicks: 20, impressions: 10_000 })] }),
    ],
    maxDailyBudget: null,
  });
  check("no PAUSE_AD when it's the only ad", !decisions.some((d) => d.action === "PAUSE_AD"));
}

console.log("\n3. Small samples are not judged");
{
  const decisions = decide({
    adSets: [
      adSet({
        ads: [
          ad({ adId: "a1", ctr: 0.1, clicks: 1, impressions: 900 }),
          ad({ adId: "a2", ctr: 0.1, clicks: 1, impressions: 900 }),
        ],
      }),
    ],
    maxDailyBudget: null,
  });
  check("no decisions below 4,000 impressions", decisions.length === 0, JSON.stringify(decisions));
}

console.log("\n4. Winner ad set gets more budget, capped at +20%/day");
{
  const decisions = decide({
    adSets: [
      adSet({
        dailyBudget: 60_000,
        ads: [ad({ ctr: 4, clicks: 400, impressions: 10_000 })],
      }),
    ],
    maxDailyBudget: null,
  });
  const raise = decisions.find((d) => d.action === "RAISE_BUDGET");
  check("raises budget", raise?.action === "RAISE_BUDGET");
  check(
    "by exactly 20% (60000 -> 72000 paise)",
    raise?.action === "RAISE_BUDGET" && raise.from === 60_000 && raise.to === 72_000,
    JSON.stringify(raise),
  );
  console.log(`        reason: "${raise && "reason" in raise ? raise.reason : ""}"`);
}

console.log("\n5. The hard spend ceiling wins over the rules");
{
  const decisions = decide({
    adSets: [
      adSet({
        dailyBudget: 60_000,
        ads: [ad({ ctr: 4, clicks: 400, impressions: 10_000 })],
      }),
    ],
    maxDailyBudget: 65_000, // only ₹50 of headroom
  });
  const raise = decisions.find((d) => d.action === "RAISE_BUDGET");
  check(
    "raise is clamped to the ceiling (-> 65000, not 72000)",
    raise?.action === "RAISE_BUDGET" && raise.to === 65_000,
    JSON.stringify(raise),
  );
}

console.log("\n6. No headroom means no raise at all");
{
  const decisions = decide({
    adSets: [
      adSet({ dailyBudget: 60_000, ads: [ad({ ctr: 4, clicks: 400, impressions: 10_000 })] }),
    ],
    maxDailyBudget: 60_000,
  });
  check("no RAISE_BUDGET at the cap", !decisions.some((d) => d.action === "RAISE_BUDGET"));
}

console.log("\n7. Weak ad set loses budget, but never below Meta's floor");
{
  const decisions = decide({
    adSets: [
      adSet({
        dailyBudget: 11_000, // ₹110 — one 20% cut would breach the ₹100 floor
        // Both ads weak, so the ad set aggregate is genuinely below the 1% floor.
        ads: [
          ad({ adId: "a1", ctr: 0.5, clicks: 50, impressions: 10_000 }),
          ad({ adId: "a2", ctr: 0.5, clicks: 50, impressions: 10_000 }),
        ],
      }),
    ],
    maxDailyBudget: null,
  });
  const lower = decisions.find((d) => d.action === "LOWER_BUDGET");
  check(
    "clamps the cut to the ₹100 floor (10000 paise)",
    lower?.action === "LOWER_BUDGET" && lower.to === 10_000,
    JSON.stringify(lower),
  );
}

console.log("\n8. A/B: clear winner pauses the clear loser");
{
  const decisions = decide({
    adSets: [
      adSet({
        ads: [
          ad({ adId: "win", name: "Ad A", ctr: 4, clicks: 400, impressions: 10_000 }),
          ad({ adId: "lose", name: "Ad B", ctr: 1.5, clicks: 150, impressions: 10_000 }),
        ],
      }),
    ],
    maxDailyBudget: null,
  });
  const paused = decisions.filter((d) => d.action === "PAUSE_AD");
  check("pauses exactly one ad", paused.length === 1, JSON.stringify(paused));
  check(
    "pauses the loser, keeps the winner",
    paused[0]?.action === "PAUSE_AD" && paused[0].adId === "lose",
  );
  console.log(`        reason: "${paused[0] && "reason" in paused[0] ? paused[0].reason : ""}"`);
}

console.log("\n9. A/B: a narrow margin is noise, not a winner");
{
  const decisions = decide({
    adSets: [
      adSet({
        ads: [
          ad({ adId: "a1", ctr: 3.0, clicks: 300, impressions: 10_000 }),
          ad({ adId: "a2", ctr: 2.9, clicks: 290, impressions: 10_000 }),
        ],
      }),
    ],
    maxDailyBudget: null,
  });
  check("does not pause on a 3.0 vs 2.9 difference", !decisions.some((d) => d.action === "PAUSE_AD"));
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
