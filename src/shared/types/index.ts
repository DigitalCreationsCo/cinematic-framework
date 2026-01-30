// Base types (foundation - no dependencies)
export * from "./base.types.js";

// Primitive domain types (depend only on base)
export * from "./cinematography.types.js";
export * from "./assets.types.js";
export * from "./metrics.types.js";
export * from "./quality.types.js";

// Audio types (depends on base + cinematography)
export * from "./audio.types.js";

// Domain entity attributes (depend on base + primitives)
export * from "./character.types.js";
export * from "./location.types.js";
export * from "./scene.types.js";
export * from "./metadata.types.js";

// Database entities (depend on domain attributes + schema)
export * from "./entities.types.js";

// Workflow types (aggregate layer - depends on entities)
export * from "./workflow.types.js";

// Pipeline types (top layer - depends on project)
export * from "./pipeline.types.js";
