import type { Role } from "@prisma/client";

import { can, type Permission } from "@/lib/permissions";
import { PLAN_SPECS, planOf } from "@/lib/billing/plans";

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

const deny = (role: Role, permission: Permission) =>
  check(`${role} CANNOT ${permission}`, !can(role, permission));

const allow = (role: Role, permission: Permission) =>
  check(`${role} can ${permission}`, can(role, permission));

console.log("\n1. An employee can draft, but cannot spend money");
allow("EMPLOYEE", "client:generate");
deny("EMPLOYEE", "campaign:publish");
deny("EMPLOYEE", "campaign:activate");
deny("EMPLOYEE", "automation:manage");
deny("EMPLOYEE", "team:manage");
deny("EMPLOYEE", "billing:manage");

console.log("\n2. A manager runs campaigns, but not the business");
allow("MANAGER", "campaign:publish");
allow("MANAGER", "campaign:activate");
allow("MANAGER", "automation:manage");
deny("MANAGER", "team:manage");
deny("MANAGER", "billing:manage");
deny("MANAGER", "branding:manage");

console.log("\n3. An admin runs the agency, but never touches the card");
allow("ADMIN", "team:manage");
allow("ADMIN", "branding:manage");
allow("ADMIN", "campaign:activate");
deny("ADMIN", "billing:manage");

console.log("\n4. The owner can do everything");
allow("OWNER", "billing:manage");
allow("OWNER", "team:manage");
allow("OWNER", "campaign:activate");

console.log("\n5. A lapsed subscription drops to Free limits, not lockout");
check("no subscription -> FREE", planOf(null) === "FREE");
check(
  "active GROWTH -> GROWTH",
  planOf({ plan: "GROWTH", status: "active" }) === "GROWTH",
);
check(
  "halted GROWTH -> FREE",
  planOf({ plan: "GROWTH", status: "halted" }) === "FREE",
  planOf({ plan: "GROWTH", status: "halted" }),
);
check(
  "cancelled AGENCY -> FREE",
  planOf({ plan: "AGENCY", status: "cancelled" }) === "FREE",
);
check(
  "garbage plan string -> FREE",
  planOf({ plan: "ENTERPRISE_ULTRA", status: "active" }) === "FREE",
);

console.log("\n6. Paid capabilities are actually gated by plan");
check("FREE has no auto-pilot", PLAN_SPECS.FREE.autopilot === false);
check("FREE has no white-label", PLAN_SPECS.FREE.whiteLabel === false);
check("FREE caps clients at 1", PLAN_SPECS.FREE.maxClients === 1);
check("STARTER has auto-pilot", PLAN_SPECS.STARTER.autopilot === true);
check("STARTER has no white-label", PLAN_SPECS.STARTER.whiteLabel === false);
check("GROWTH has white-label", PLAN_SPECS.GROWTH.whiteLabel === true);
check("AGENCY is unlimited", PLAN_SPECS.AGENCY.maxClients === null);

console.log("\n7. A halted GROWTH agency loses auto-pilot");
{
  const plan = planOf({ plan: "GROWTH", status: "halted" });
  check(
    "optimiser would be blocked on a halted plan",
    PLAN_SPECS[plan].autopilot === false,
  );
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
