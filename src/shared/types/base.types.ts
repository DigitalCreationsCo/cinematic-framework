// shared/types/base.types.ts
import { z } from "zod";
import { v7 as uuidv7 } from "uuid";

// ============================================================================
// CORE PRIMITIVES (No dependencies)
// ============================================================================

export const InsertIdentityBase = z.object({
  id: z.uuid({ "version": "v7" }).default(() => (uuidv7())).describe("Unique identifier (uuid)"),
  createdAt: z.preprocess(
    (val) => (typeof val === "string" ? new Date(val) : val),
    z.date()
  ).default(() => new Date()),
  updatedAt: z.preprocess(
    (val) => (typeof val === "string" ? new Date(val) : val),
    z.date()
  ).default(() => new Date()),
});

export const IdentityBase = z.object({
  id: z.uuid({ "version": "v7" }).nonempty().nonoptional().describe("Unique identifier (uuid)"),
  createdAt: z.preprocess(
    (val) => (typeof val === "string" ? new Date(val) : val),
    z.date()
  ).default(() => new Date()),
  updatedAt: z.preprocess(
    (val) => (typeof val === "string" ? new Date(val) : val),
    z.date()
  ).default(() => new Date()),
});

export const ProjectRef = z.object({
  projectId: z.uuid({ "version": "v7" }).nonempty().nonoptional().describe("Pipeline project id"),
});

// ============================================================================
// VALID DURATIONS
// ============================================================================

export const VALID_DURATIONS = [ 5, 6, 7, 8 ] as const;

export function roundToValidDuration(duration: number): ValidDurations {
  if (typeof duration !== 'number' || isNaN(duration)) {
    throw new Error("Invalid input: duration must be a valid number.");
  }

  const validDurations = VALID_DURATIONS;
  let closest: ValidDurations = validDurations[ 0 ];
  let minDiff = Math.abs(duration - validDurations[ 0 ]);

  for (let i = 1; i < validDurations.length; i++) {
    const diff = Math.abs(duration - validDurations[ i ]);
    if (diff < minDiff) {
      minDiff = diff;
      closest = validDurations[ i ];
    }
  }
  return closest;
}

export const ValidDurations = z.preprocess((val) => roundToValidDuration(Number(val)), z.union(VALID_DURATIONS.map(duration => z.literal(duration)) as z.ZodLiteral<number>[])).describe("Valid segment duration in seconds");
export type ValidDurations = typeof VALID_DURATIONS[ number ];

export function isValidDuration(duration: number): duration is ValidDurations {
  return VALID_DURATIONS.includes(duration as ValidDurations);
}
