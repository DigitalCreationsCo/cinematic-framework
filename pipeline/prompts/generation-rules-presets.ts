/**
 * Preset generation rules for common domains and quality issues
 * These can be automatically added based on script content or proactively included
 */

export const DOMAIN_SPECIFIC_RULES = {
  surfing: [
    "[DOMAIN_SEMANTICS_SURFING] TOKEN OVERRIDE 'BARREL': In this context, 'barrel' or 'tube' = [Liquid water, hollow wave interior, translucent, moving fluid]. NEGATIVE CONSTRAINT: [No concrete pipes, no blue plastic tunnels, no solid structures, no dry interiors]. The camera is inside the splash zone.",
    "[DOMAIN_SEMANTICS_ACTION] PHYSICS ANCHORING: 'Riding' = [Standing on board, weight compression on knees, wake trailing behind board]. 'Wipeout' = [Submersion into liquid, splash particles, loss of board contact]. NEGATIVE CONSTRAINT: [Sitting on water, standing on still water, floating above water].",
    "[PHYSICS_ENGINE] FLUID DYNAMICS: Water is a translucent liquid that refracts light. It is NOT opaque blue paint. Breaking waves generate white foam/spray. Surfboards displace water (create wakes/ripples). NEGATIVE CONSTRAINT: [No floating objects without displacement, no solid blue surfaces]."
  ],

  sports: [
    "[BIOMECHANICS] SKELETAL INTEGRITY: High-action sports (running, surfing) require visible muscle tension and weight distribution. Center of gravity must align with stance. NEGATIVE CONSTRAINT: [Sliding without foot movement, floating jumps, disjointed limbs].",
    "[EQUIPMENT_HANDLING] PHYSICS INTERACTION: Sports equipment must have realistic contact points and tension. Rackets/bats must compress on impact. Hands must grip handles firmly. NEGATIVE CONSTRAINT: [Floating equipment, hands clipping through objects, weak/loose grip]."
  ],

  medical: [
    "MEDICAL TERMINOLOGY: Use anatomically correct terms. 'Operating room' has specific sterile equipment layout, 'patient' is a person receiving care, 'procedure' follows medical protocols with proper protective equipment.",
    "MEDICAL REALISM: Medical settings require appropriate sterile procedures, protective equipment (gloves, masks, gowns), and authentic medical equipment that matches the specified procedure."
  ],

  urban: [
    "URBAN AUTHENTICITY: City streets have consistent architectural styles, appropriate traffic density for time of day, logical signage and storefronts. Background pedestrians behave naturally (walking with purpose, looking ahead, normal pace).",
    "URBAN CONTINUITY: Weather effects persist (wet pavement from rain, snow accumulation, puddles). Lighting matches time of day (streetlights on at night, sun position accurate for time)."
  ],

  nature: [
    "NATURAL PHYSICS: Plants sway in wind, water flows downhill, animals move with species-appropriate gaits. Natural elements interact logically (wind creates ripples on water, rain creates splashes, snow accumulates on surfaces).",
    "ENVIRONMENTAL CONSISTENCY: Natural lighting follows sun position and weather conditions. Shadows cast in correct directions. Seasonal indicators (foliage, snow, temperature effects) remain consistent."
  ]
};

export const QUALITY_ISSUE_RULES = {
  characterConsistency: [
    "CHARACTER IDENTITY: Character gender, age, and core physical features (face structure, build, height) are IMMUTABLE and must match reference images exactly across all scenes.",
    "CHARACTER APPEARANCE: Hair color/style, facial features (eye color, nose shape, jawline), and distinctive marks must match reference images precisely. Clothing specified in character description is mandatory unless scene explicitly changes it.",
    "CHARACTER COUNT EXACTNESS: When a specific number of characters is specified (e.g., 'five surfers', 'three children'), that exact count must be maintained and verifiable in every frame. Each character must be distinct and individually identifiable."
  ],

  spatialContinuity: [
    "SPATIAL LOGIC: Characters cannot teleport. Movement between locations must show physical progression or explicit transition. If character exits frame-left, they enter next frame from frame-right.",
    "POSITIONAL CONSISTENCY: Relative positions of characters and objects persist unless explicit movement occurs. If A is left of B in one frame, this relationship maintains until movement changes it.",
    "ENVIRONMENTAL PERSISTENCE: Broken objects stay broken, moved objects stay moved, spilled liquids remain visible. Damage and changes to environment persist across scenes."
  ],

  motionDirection: [
    "CAMERA-RELATIVE DIRECTIONS: 'Toward camera' shows faces, front bodies approaching. 'Away from camera' shows backs, receding figures. 'Left' and 'right' are from camera perspective, not character perspective.",
    "MOTION CONTINUITY: Action direction specified in scene description must be maintained. 'Running into ocean' means moving from land toward water, NOT parallel to shoreline or away from water."
  ],

  semanticAccuracy: [
    "LITERAL INTERPRETATION: Domain-specific terms must be interpreted according to their literal meaning in that domain. Research domain terminology if uncertain - do not substitute similar-sounding but incorrect interpretations.",
    "NEGATIVE CONSTRAINTS: When terminology could be ambiguous, explicitly specify what it is NOT. Example: 'wave barrel (NOT a pipe, NOT a tunnel structure, specifically curved water)'."
  ],

  technicalQuality: [
    "FRAME STABILITY: Keyframes must show complete, stable poses with weight settled, NOT mid-transition states. Characters should be at clear beginning or end positions, not caught mid-gesture or mid-step.",
    "GENERATION ARTIFACTS: Avoid horizontal banding, digital noise, inconsistent resolution, unnatural blur, or AI artifacts. Images should be clean, professional cinema-grade quality.",
    "FOCUS AND CLARITY: Main subjects in focus with appropriate depth of field. Background blur (bokeh) when shallow DoF specified. No motion blur unless intentional and cinematic."
  ]
};

export const PROACTIVE_QUALITY_RULES = [
  "[GLOBAL_IDENTITY] STRICT IDENTITY LOCK: Character facial features, bone structure, and body proportions must strictly match reference embeddings. 28-year-old male = masculine features. NO gender swapping. NO age drifting. Reference images are GROUND TRUTH, not suggestions.",
  "[CRITICAL_COUNTING] QUANTITY ENFORCEMENT: Character counts are binary requirements. If '5 characters' are prompted, exactly 5 distinct entities must be visible. 4 is a CRITICAL FAILURE. 6 is a CRITICAL FAILURE. Crowds must be separated from named characters.",
  "[TEMPORAL_CONTINUITY] STATE PERSISTENCE: Material states (Wet, Dirty, Torn, Injured) are IMMUTABLE unless a specific 'Cleaning/Healing' event occurs. If Frame 1 is wet, Frame 100 MUST be wet. Drying requires a time-lapse transition.",
  "[CAMERA_VECTOR] VECTOR LOGIC: Camera directions are absolute relative to the lens. 'Toward Camera' = Object scale increasing, distance decreasing. 'Away from Camera' = Object scale decreasing, distance increasing. NEGATIVE CONSTRAINT: [Lateral movement when depth movement is requested].",
  "[ENVIRONMENT_MANDATE] LAYER COMPOSITION: Specified background layers (mountains, crowds) are REQUIRED to establish scale and parallax. However, Character Consistency takes priority over Background Detail in low-bitrate situations.",
];

/**
 * Helper to detect which domain rules might be relevant based on scene content
 */
export function detectRelevantDomainRules(sceneDescriptions: string[]): string[] {
  const allText = sceneDescriptions.join(' ').toLowerCase();
  const relevantRules: string[] = [];

  if (allText.match(/\b(surf|wave|barrel|ocean|beach|board|paddle|ride|wipeout)\b/)) {
    relevantRules.push(...DOMAIN_SPECIFIC_RULES.surfing);
  }

  if (allText.match(/\b(sport|run|sprint|jump|throw|catch|play|athlete|game)\b/)) {
    relevantRules.push(...DOMAIN_SPECIFIC_RULES.sports);
  }

  if (allText.match(/\b(hospital|doctor|surgery|patient|medical|operate|clinic)\b/)) {
    relevantRules.push(...DOMAIN_SPECIFIC_RULES.medical);
  }

  if (allText.match(/\b(city|street|urban|building|sidewalk|traffic|downtown)\b/)) {
    relevantRules.push(...DOMAIN_SPECIFIC_RULES.urban);
  }

  if (allText.match(/\b(forest|mountain|river|lake|tree|wildlife|nature|outdoor)\b/)) {
    relevantRules.push(...DOMAIN_SPECIFIC_RULES.nature);
  }

  return relevantRules;
}

/**
 * Helper to get quality rules based on observed issues
 */
export function getQualityRulesForIssues(issueCategories: string[]): string[] {
  const rules: string[] = [];

  if (issueCategories.some(cat => cat.includes('character') || cat.includes('appearance'))) {
    rules.push(...QUALITY_ISSUE_RULES.characterConsistency);
  }

  if (issueCategories.some(cat => cat.includes('continuity') || cat.includes('spatial'))) {
    rules.push(...QUALITY_ISSUE_RULES.spatialContinuity);
  }

  if (issueCategories.some(cat => cat.includes('motion') || cat.includes('direction'))) {
    rules.push(...QUALITY_ISSUE_RULES.motionDirection);
  }

  if (issueCategories.some(cat => cat.includes('semantic') || cat.includes('interpretation'))) {
    rules.push(...QUALITY_ISSUE_RULES.semanticAccuracy);
  }

  if (issueCategories.some(cat => cat.includes('technical') || cat.includes('artifact'))) {
    rules.push(...QUALITY_ISSUE_RULES.technicalQuality);
  }

  return rules;
}

/**
 * Get all proactive rules to include from the start
 */
export function getProactiveRules(): string[] {
  return [ ...PROACTIVE_QUALITY_RULES ];
}
