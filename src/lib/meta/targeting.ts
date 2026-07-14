import "server-only";

import { graphGet, MetaApiError, type Paged } from "./client";
import type { Audience } from "@/lib/ai/schemas";

/**
 * Phase 1 hands us an audience in plain English ("Dehradun", "Home improvement").
 * Meta only accepts its own opaque keys, so every location and interest has to be
 * resolved against its search endpoints before an ad set can be created.
 */

export type TargetingSpec = {
  geo_locations: {
    countries?: string[];
    regions?: { key: string }[];
    cities?: { key: string; radius: number; distance_unit: "kilometer" }[];
  };
  age_min: number;
  age_max: number;
  genders?: number[];
  flexible_spec?: { interests: { id: string; name: string }[] }[];
  publisher_platforms: string[];
  facebook_positions?: string[];
  instagram_positions?: string[];
};

type GeoResult = {
  key: string;
  name: string;
  type: "city" | "region" | "country" | string;
  country_code?: string;
};

type InterestResult = { id: string; name: string };

/** Radius around a targeted city. Meta's default is 25km; keep it tight for local trades. */
const CITY_RADIUS_KM = 25;

async function resolveLocation(token: string, query: string): Promise<GeoResult | null> {
  const res = await graphGet<Paged<GeoResult>>("/search", token, {
    type: "adgeolocation",
    q: query,
    location_types: JSON.stringify(["city", "region", "country"]),
    limit: "1",
  });
  return res.data[0] ?? null;
}

async function resolveInterest(token: string, query: string): Promise<InterestResult | null> {
  const res = await graphGet<Paged<InterestResult>>("/search", token, {
    type: "adinterest",
    q: query,
    limit: "1",
  });
  return res.data[0] ?? null;
}

const GENDER_CODES: Record<Audience["genders"], number[] | undefined> = {
  ALL: undefined, // Omitting the field is how Meta expresses "everyone".
  MALE: [1],
  FEMALE: [2],
};

export type ResolvedTargeting = {
  spec: TargetingSpec;
  /** Interests Meta had no match for. Surfaced to the user rather than swallowed. */
  droppedInterests: string[];
};

export async function buildTargeting(
  token: string,
  audience: Audience,
  options: { includeInstagram: boolean },
): Promise<ResolvedTargeting> {
  const located = await Promise.all(
    audience.locations.map((location) => resolveLocation(token, location)),
  );

  const geo: TargetingSpec["geo_locations"] = {};
  for (const hit of located) {
    if (!hit) continue;

    if (hit.type === "city") {
      (geo.cities ??= []).push({
        key: hit.key,
        radius: CITY_RADIUS_KM,
        distance_unit: "kilometer",
      });
    } else if (hit.type === "region") {
      (geo.regions ??= []).push({ key: hit.key });
    } else if (hit.country_code) {
      (geo.countries ??= []).push(hit.country_code);
    }
  }

  if (!geo.cities && !geo.regions && !geo.countries) {
    // Defaulting to a whole country here would quietly spend the budget in the
    // wrong place. Make the user fix the audience instead.
    throw new MetaApiError(
      `Meta didn't recognise any of these locations: ${audience.locations.join(", ")}. Edit the audience and try again.`,
    );
  }

  const resolvedInterests: InterestResult[] = [];
  const droppedInterests: string[] = [];

  for (const interest of audience.interests) {
    const hit = await resolveInterest(token, interest);
    if (hit) resolvedInterests.push({ id: hit.id, name: hit.name });
    else droppedInterests.push(interest);
  }

  const spec: TargetingSpec = {
    geo_locations: geo,
    age_min: clampAge(audience.ageMin),
    age_max: clampAge(audience.ageMax),
    genders: GENDER_CODES[audience.genders],
    // No interests at all means a broad ad set, which is a legitimate strategy —
    // don't send an empty flexible_spec, Meta rejects it.
    flexible_spec:
      resolvedInterests.length > 0 ? [{ interests: resolvedInterests }] : undefined,
    publisher_platforms: options.includeInstagram
      ? ["facebook", "instagram"]
      : ["facebook"],
  };

  return { spec, droppedInterests };
}

/** Meta only accepts 13–65, and rejects the ad set outright outside that range. */
function clampAge(age: number): number {
  return Math.min(65, Math.max(18, Math.round(age)));
}
