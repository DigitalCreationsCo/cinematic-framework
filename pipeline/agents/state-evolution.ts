import { Character, Location, Scene, CharacterState, LocationState } from "../../shared/pipeline-types";

/**
 * State Evolution Helper
 *
 * This module contains logic for evolving character and location states across scenes.
 * It uses LLM-driven heuristics to parse scene descriptions and update temporal state.
 */

// ============================================================================
// CHARACTER STATE EVOLUTION
// ============================================================================

export function evolveCharacterState(
    character: Character,
    scene: Scene,
    sceneDescription: string
): CharacterState {
    const currentState: Partial<CharacterState> = character.state || {};
    const desc = sceneDescription.toLowerCase();
    const sceneMood = scene.mood?.toLowerCase() || "";

    // Track emotional history
    const emotionalHistory = [
        ...(currentState.emotionalHistory || []),
        { sceneId: scene.id, emotion: scene.mood || "neutral" }
    ];

    // Detect exit direction from scene description
    const lastExitDirection = detectExitDirection(desc);

    // Detect position in frame
    const position = detectPosition(desc);

    // Accumulate dirt level
    const dirtLevel = accumulateDirtLevel(currentState.dirtLevel, desc);

    // Accumulate exhaustion
    const exhaustionLevel = accumulateExhaustion(currentState.exhaustionLevel, desc, sceneMood);

    // Accumulate sweat
    const sweatLevel = accumulateSweat(currentState.sweatLevel, desc, sceneMood);

    // Detect injuries
    const injuries = detectInjuries(currentState.injuries || [], scene, desc);

    // Detect costume damage
    const costumeCondition = detectCostumeDamage(
        currentState.costumeCondition || { tears: [], stains: [], wetness: "dry", damage: [] },
        desc
    );

    // Detect hair condition changes
    const hairCondition = detectHairCondition(
        currentState.hairCondition || {
            style: character.physicalTraits.hair,
            messiness: "pristine" as const,
            wetness: "dry" as const
        },
        desc,
        character.physicalTraits.hair
    );

    // Construct evolved state
    return {
        lastSeen: scene.id,
        position,
        lastExitDirection,
        emotionalState: scene.mood || "neutral",
        emotionalHistory,
        physicalCondition: generatePhysicalConditionSummary(injuries, dirtLevel, exhaustionLevel),
        injuries,
        dirtLevel,
        exhaustionLevel,
        sweatLevel,
        costumeCondition,
        hairCondition,
    };
}

// ============================================================================
// LOCATION STATE EVOLUTION
// ============================================================================

export function evolveLocationState(
    location: Location,
    scene: Scene,
    sceneDescription: string
): LocationState {
    const currentState: Partial<LocationState> = location.state || {};
    const desc = sceneDescription.toLowerCase();
    const lighting = scene.lighting || location.lightingConditions;

    // Track time progression
    const timeOfDay = parseTimeOfDay(desc, currentState.timeOfDay || location.timeOfDay);
    const timeHistory = [
        ...(currentState.timeHistory || []),
        { sceneId: scene.id, timeOfDay }
    ];

    // Track weather progression
    const weather = parseWeather(desc, currentState.weather || location.weather || "Clear");
    const weatherIntensity = parseWeatherIntensity(desc);
    const weatherHistory = [
        ...(currentState.weatherHistory || []),
        { sceneId: scene.id, weather, intensity: weatherIntensity }
    ];

    // Track lighting progression
    const lightingHistory = [
        ...(currentState.lightingHistory || []),
        { sceneId: scene.id, lighting }
    ];

    // Detect precipitation
    const precipitation = detectPrecipitation(desc, weather);

    // Detect visibility
    const visibility = detectVisibility(desc);

    // Detect ground condition changes
    const groundCondition = evolveGroundCondition(
        currentState.groundCondition || { wetness: "dry", debris: [], damage: [] },
        desc,
        weather,
        precipitation
    );

    // Detect broken objects
    const brokenObjects = detectBrokenObjects(
        currentState.brokenObjects || [],
        scene,
        desc
    );

    // Detect atmospheric effects
    const atmosphericEffects = evolveAtmosphericEffects(
        currentState.atmosphericEffects || [],
        scene,
        desc
    );

    return {
        lastUsed: scene.id,
        timeOfDay,
        timeHistory,
        weather,
        weatherHistory,
        precipitation,
        visibility,
        lighting,
        lightingHistory,
        groundCondition,
        brokenObjects,
        atmosphericEffects: atmosphericEffects.map(e => ({
            ...e,
            dissipating: e.dissipating || false
        })),
        season: currentState.season || "unspecified",
        temperatureIndicators: currentState.temperatureIndicators || [],
    };
}

// ============================================================================
// CHARACTER DETECTION HEURISTICS
// ============================================================================

function detectExitDirection(desc: string): "left" | "right" | "up" | "down" | "none" {
    if (desc.includes("exits left") || desc.includes("moves left") || desc.includes("walks off left")) {
        return "left";
    }
    if (desc.includes("exits right") || desc.includes("moves right") || desc.includes("walks off right")) {
        return "right";
    }
    if (desc.includes("exits up") || desc.includes("climbs up") || desc.includes("ascends")) {
        return "up";
    }
    if (desc.includes("exits down") || desc.includes("descends") || desc.includes("falls")) {
        return "down";
    }
    return "none";
}

function detectPosition(desc: string): string {
    if (desc.includes("frame left") || desc.includes("left side") || desc.includes("on the left")) {
        return "left";
    }
    if (desc.includes("frame right") || desc.includes("right side") || desc.includes("on the right")) {
        return "right";
    }
    if (desc.includes("foreground") || desc.includes("front")) {
        return "foreground";
    }
    if (desc.includes("background") || desc.includes("distance")) {
        return "background";
    }
    return "center";
}

function accumulateDirtLevel(
    current: "clean" | "slightly_dirty" | "dirty" | "very_dirty" | "covered" | undefined,
    desc: string
): "clean" | "slightly_dirty" | "dirty" | "very_dirty" | "covered" {
    const currentLevel = current || "clean";

    // Check for dirt-causing events
    const isDirtEvent =
        desc.includes("mud") || desc.includes("dirt") || desc.includes("dust") ||
        desc.includes("filth") || desc.includes("grime") || desc.includes("soil") ||
        desc.includes("crawl") || desc.includes("roll") || desc.includes("fall");

    // Check for cleaning events
    const isCleanEvent =
        desc.includes("clean") || desc.includes("wash") || desc.includes("shower") ||
        desc.includes("bath") || desc.includes("wipe");

    if (isCleanEvent) {
        return "clean";
    }

    if (isDirtEvent) {
        // Escalate dirt level
        const levels: Array<"clean" | "slightly_dirty" | "dirty" | "very_dirty" | "covered"> =
            [ "clean", "slightly_dirty", "dirty", "very_dirty", "covered" ];
        const currentIndex = levels.indexOf(currentLevel);
        const nextIndex = Math.min(currentIndex + 1, levels.length - 1);
        return levels[ nextIndex ];
    }

    return currentLevel;
}

function accumulateExhaustion(
    current: "fresh" | "slightly_tired" | "tired" | "exhausted" | "collapsing" | undefined,
    desc: string,
    mood: string
): "fresh" | "slightly_tired" | "tired" | "exhausted" | "collapsing" {
    const currentLevel = current || "fresh";

    // Check for exhausting events
    const isExhaustingEvent =
        desc.includes("run") || desc.includes("sprint") || desc.includes("chase") ||
        desc.includes("fight") || desc.includes("struggle") || desc.includes("climb") ||
        desc.includes("swim") || desc.includes("exert") || mood.includes("intense") ||
        mood.includes("desperate");

    // Check for rest events
    const isRestEvent =
        desc.includes("rest") || desc.includes("sleep") || desc.includes("sit") ||
        desc.includes("relax") || desc.includes("recover");

    if (isRestEvent) {
        // Reduce exhaustion by one level
        const levels: Array<"fresh" | "slightly_tired" | "tired" | "exhausted" | "collapsing"> =
            [ "fresh", "slightly_tired", "tired", "exhausted", "collapsing" ];
        const currentIndex = levels.indexOf(currentLevel);
        const prevIndex = Math.max(currentIndex - 1, 0);
        return levels[ prevIndex ];
    }

    if (isExhaustingEvent) {
        // Escalate exhaustion
        const levels: Array<"fresh" | "slightly_tired" | "tired" | "exhausted" | "collapsing"> =
            [ "fresh", "slightly_tired", "tired", "exhausted", "collapsing" ];
        const currentIndex = levels.indexOf(currentLevel);
        const nextIndex = Math.min(currentIndex + 1, levels.length - 1);
        return levels[ nextIndex ];
    }

    return currentLevel;
}

function accumulateSweat(
    current: "dry" | "slight" | "moderate" | "heavy" | "drenched" | undefined,
    desc: string,
    mood: string
): "dry" | "slight" | "moderate" | "heavy" | "drenched" {
    const currentLevel = current || "dry";

    // Check for sweat-inducing events
    const isSweatEvent =
        desc.includes("sweat") || desc.includes("perspir") || desc.includes("run") ||
        desc.includes("sprint") || desc.includes("fight") || desc.includes("heat") ||
        desc.includes("hot") || mood.includes("intense") || mood.includes("panic");

    // Check for drying events
    const isDryEvent =
        desc.includes("dry") || desc.includes("wipe") || desc.includes("cool") ||
        desc.includes("cold");

    if (isDryEvent) {
        return "dry";
    }

    if (isSweatEvent) {
        // Escalate sweat level
        const levels: Array<"dry" | "slight" | "moderate" | "heavy" | "drenched"> =
            [ "dry", "slight", "moderate", "heavy", "drenched" ];
        const currentIndex = levels.indexOf(currentLevel);
        const nextIndex = Math.min(currentIndex + 1, levels.length - 1);
        return levels[ nextIndex ];
    }

    return currentLevel;
}

function detectInjuries(
    current: Array<{
        type: string;
        location: string;
        severity: "minor" | "moderate" | "severe";
        acquiredInScene: number;
    }>,
    scene: Scene,
    desc: string
): Array<{
    type: string;
    location: string;
    severity: "minor" | "moderate" | "severe";
    acquiredInScene: number;
}> {
    const injuries = [ ...current ];

    // Detect new injuries
    const injuryKeywords = [
        { keyword: "cut", type: "cut", severity: "minor" as const },
        { keyword: "slash", type: "cut", severity: "moderate" as const },
        { keyword: "bruise", type: "bruise", severity: "minor" as const },
        { keyword: "punch", type: "bruise", severity: "moderate" as const },
        { keyword: "wound", type: "wound", severity: "moderate" as const },
        { keyword: "stab", type: "stab wound", severity: "severe" as const },
        { keyword: "shot", type: "gunshot wound", severity: "severe" as const },
        { keyword: "burn", type: "burn", severity: "moderate" as const },
        { keyword: "scrape", type: "scrape", severity: "minor" as const },
        { keyword: "fracture", type: "fracture", severity: "severe" as const },
        { keyword: "break", type: "broken bone", severity: "severe" as const },
    ];

    for (const { keyword, type, severity } of injuryKeywords) {
        if (desc.includes(keyword)) {
            // Try to detect location
            const location = detectInjuryLocation(desc);

            // Only add if not duplicate
            const isDuplicate = injuries.some(
                inj => inj.type === type && inj.location === location
            );

            if (!isDuplicate) {
                injuries.push({
                    type,
                    location,
                    severity,
                    acquiredInScene: scene.id
                });
            }
        }
    }

    return injuries;
}

function detectInjuryLocation(desc: string): string {
    const locations = [
        "head", "face", "eye", "nose", "jaw", "neck",
        "shoulder", "arm", "elbow", "wrist", "hand", "finger",
        "chest", "ribs", "abdomen", "back",
        "hip", "leg", "knee", "ankle", "foot"
    ];

    for (const loc of locations) {
        if (desc.includes(loc)) {
            return loc;
        }
    }

    return "body";
}

function detectCostumeDamage(
    current: {
        tears: string[];
        stains: string[];
        wetness: "dry" | "damp" | "wet" | "soaked";
        damage: string[];
    },
    desc: string
): {
    tears: string[];
    stains: string[];
    wetness: "dry" | "damp" | "wet" | "soaked";
    damage: string[];
} {
    const costume = { ...current };

    // Detect tears
    if (desc.includes("tear") || desc.includes("rip") || desc.includes("torn") || desc.includes("ripped")) {
        const garment = detectGarment(desc);
        if (!costume.tears.includes(`${garment} torn`)) {
            costume.tears.push(`${garment} torn`);
        }
    }

    // Detect stains
    const stainKeywords = [ "blood", "mud", "oil", "grease", "dirt", "wine", "food" ];
    for (const stain of stainKeywords) {
        if (desc.includes(stain)) {
            const garment = detectGarment(desc);
            if (!costume.stains.includes(`${stain} on ${garment}`)) {
                costume.stains.push(`${stain} on ${garment}`);
            }
        }
    }

    // Detect wetness
    if (desc.includes("soak") || desc.includes("drench") || desc.includes("saturate")) {
        costume.wetness = "soaked";
    } else if (desc.includes("wet") || desc.includes("splash") || desc.includes("rain")) {
        costume.wetness = costume.wetness === "soaked" ? "soaked" : "wet";
    } else if (desc.includes("damp") || desc.includes("moist")) {
        costume.wetness = costume.wetness === "dry" ? "damp" : costume.wetness;
    } else if (desc.includes("dry")) {
        costume.wetness = "dry";
    }

    // Detect other damage
    if (desc.includes("burn") || desc.includes("scorch") || desc.includes("singe")) {
        const garment = detectGarment(desc);
        if (!costume.damage.includes(`${garment} burned`)) {
            costume.damage.push(`${garment} burned`);
        }
    }

    return costume;
}

function detectGarment(desc: string): string {
    const garments = [
        "shirt", "pants", "dress", "jacket", "coat", "sweater",
        "skirt", "shorts", "shoes", "boots", "hat", "gloves",
        "sleeve", "collar", "pocket"
    ];

    for (const garment of garments) {
        if (desc.includes(garment)) {
            return garment;
        }
    }

    return "clothing";
}

function detectHairCondition(
    current: {
        style?: string;
        messiness: "pristine" | "slightly_messy" | "messy" | "disheveled" | "wild";
        wetness: "dry" | "damp" | "wet" | "soaked";
    },
    desc: string,
    baselineStyle: string
): {
    style: string | undefined;
    messiness: "pristine" | "slightly_messy" | "messy" | "disheveled" | "wild";
    wetness: "dry" | "damp" | "wet" | "soaked";
} {
    const hair = { ...current, style: current.style || baselineStyle };

    // Detect messiness
    if (desc.includes("wild hair") || desc.includes("hair flying")) {
        hair.messiness = "wild";
    } else if (desc.includes("disheveled") || desc.includes("tangled")) {
        hair.messiness = "disheveled";
    } else if (desc.includes("messy")) {
        hair.messiness = "messy";
    } else if (desc.includes("tidy") || desc.includes("neat") || desc.includes("groom")) {
        hair.messiness = "pristine";
    }

    // Detect wetness
    if (desc.includes("soaked") || desc.includes("drenched")) {
        hair.wetness = "soaked";
    } else if (desc.includes("wet hair") || desc.includes("rain")) {
        hair.wetness = hair.wetness === "soaked" ? "soaked" : "wet";
    } else if (desc.includes("damp")) {
        hair.wetness = hair.wetness === "dry" ? "damp" : hair.wetness;
    } else if (desc.includes("dry")) {
        hair.wetness = "dry";
    }

    return hair;
}

function generatePhysicalConditionSummary(
    injuries: Array<{ type: string; location: string; severity: string; }>,
    dirtLevel: string,
    exhaustionLevel: string
): string {
    const parts: string[] = [];

    if (injuries.length > 0) {
        parts.push(`${injuries.length} ${injuries.length === 1 ? "injury" : "injuries"}`);
    }

    if (dirtLevel !== "clean") {
        parts.push(dirtLevel.replace("_", " "));
    }

    if (exhaustionLevel !== "fresh") {
        parts.push(exhaustionLevel.replace("_", " "));
    }

    return parts.length > 0 ? parts.join(", ") : "healthy";
}

// ============================================================================
// LOCATION DETECTION HEURISTICS
// ============================================================================

function parseTimeOfDay(desc: string, current: string): string {
    const timeKeywords = [
        { keywords: [ "dawn", "sunrise", "early morning" ], time: "dawn" },
        { keywords: [ "morning", "a.m.", "am" ], time: "morning" },
        { keywords: [ "noon", "midday", "mid-day" ], time: "noon" },
        { keywords: [ "afternoon", "p.m.", "pm" ], time: "afternoon" },
        { keywords: [ "dusk", "sunset", "twilight" ], time: "dusk" },
        { keywords: [ "evening", "night", "nighttime" ], time: "night" },
        { keywords: [ "midnight", "late night" ], time: "midnight" },
    ];

    for (const { keywords, time } of timeKeywords) {
        if (keywords.some(kw => desc.includes(kw))) {
            return time;
        }
    }

    return current;
}

function parseWeather(desc: string, current: string): string {
    const weatherKeywords = [
        { keywords: [ "clear", "sunny", "bright" ], weather: "Clear" },
        { keywords: [ "cloudy", "overcast" ], weather: "Cloudy" },
        { keywords: [ "rain", "raining", "rainy", "downpour" ], weather: "Rain" },
        { keywords: [ "storm", "stormy", "thunderstorm" ], weather: "Storm" },
        { keywords: [ "snow", "snowing", "snowy", "blizzard" ], weather: "Snow" },
        { keywords: [ "fog", "foggy", "mist", "misty" ], weather: "Fog" },
        { keywords: [ "wind", "windy", "gust" ], weather: "Windy" },
    ];

    for (const { keywords, weather } of weatherKeywords) {
        if (keywords.some(kw => desc.includes(kw))) {
            return weather;
        }
    }

    return current;
}

function parseWeatherIntensity(desc: string): "light" | "moderate" | "heavy" | "extreme" | undefined {
    if (desc.includes("extreme") || desc.includes("severe") || desc.includes("violent")) {
        return "extreme";
    }
    if (desc.includes("heavy") || desc.includes("intense") || desc.includes("torrential")) {
        return "heavy";
    }
    if (desc.includes("moderate")) {
        return "moderate";
    }
    if (desc.includes("light") || desc.includes("slight")) {
        return "light";
    }
    return undefined;
}

function detectPrecipitation(desc: string, weather: string): "none" | "light" | "moderate" | "heavy" {
    if (weather === "Clear" || weather === "Cloudy") {
        return "none";
    }

    if (desc.includes("heavy rain") || desc.includes("downpour") || desc.includes("torrential")) {
        return "heavy";
    }
    if (desc.includes("moderate rain")) {
        return "moderate";
    }
    if (desc.includes("light rain") || desc.includes("drizzle") || desc.includes("sprinkle")) {
        return "light";
    }

    // Default based on weather
    if (weather === "Rain" || weather === "Snow") {
        return "moderate";
    }
    if (weather === "Storm") {
        return "heavy";
    }

    return "none";
}

function detectVisibility(desc: string): "clear" | "slight_haze" | "hazy" | "foggy" | "obscured" {
    if (desc.includes("obscured") || desc.includes("can't see") || desc.includes("cannot see")) {
        return "obscured";
    }
    if (desc.includes("fog") || desc.includes("foggy") || desc.includes("dense mist")) {
        return "foggy";
    }
    if (desc.includes("haze") || desc.includes("hazy")) {
        return "hazy";
    }
    if (desc.includes("slight haze") || desc.includes("light fog")) {
        return "slight_haze";
    }
    return "clear";
}

function evolveGroundCondition(
    current: {
        wetness: "dry" | "damp" | "wet" | "soaked" | "flooded";
        debris: string[];
        damage: string[];
    },
    desc: string,
    weather: string,
    precipitation: "none" | "light" | "moderate" | "heavy"
): {
    wetness: "dry" | "damp" | "wet" | "soaked" | "flooded";
    debris: string[];
    damage: string[];
} {
    const ground = { ...current };

    // Update wetness based on weather
    if (weather === "Rain" || weather === "Storm") {
        if (precipitation === "heavy") {
            ground.wetness = "flooded";
        } else if (precipitation === "moderate") {
            ground.wetness = ground.wetness === "dry" ? "wet" : "soaked";
        } else if (precipitation === "light") {
            ground.wetness = ground.wetness === "dry" ? "damp" : "wet";
        }
    } else if (weather === "Clear" || weather === "Sunny") {
        // Ground dries over time
        const dryingMap: Record<string, "dry" | "damp" | "wet" | "soaked" | "flooded"> = {
            "flooded": "soaked",
            "soaked": "wet",
            "wet": "damp",
            "damp": "dry",
            "dry": "dry"
        };
        ground.wetness = dryingMap[ ground.wetness ] || ground.wetness;
    }

    // Detect debris
    const debrisKeywords = [ "glass", "rubble", "debris", "trash", "wreckage", "fragments" ];
    for (const debris of debrisKeywords) {
        if (desc.includes(debris) && !ground.debris.includes(debris)) {
            ground.debris.push(debris);
        }
    }

    // Detect damage
    const damageKeywords = [ "crater", "burn marks", "scorch", "explosion", "impact", "hole" ];
    for (const damage of damageKeywords) {
        if (desc.includes(damage) && !ground.damage.includes(damage)) {
            ground.damage.push(damage);
        }
    }

    return ground;
}

function detectBrokenObjects(
    current: Array<{
        object: string;
        description: string;
        brokenInScene: number;
    }>,
    scene: Scene,
    desc: string
): Array<{
    object: string;
    description: string;
    brokenInScene: number;
}> {
    const broken = [ ...current ];

    // Detect breaking events
    const breakKeywords = [
        { keyword: "shatter", object: "glass" },
        { keyword: "break", object: "object" },
        { keyword: "smash", object: "object" },
        { keyword: "destroy", object: "structure" },
        { keyword: "collapse", object: "structure" },
    ];

    for (const { keyword, object } of breakKeywords) {
        if (desc.includes(keyword)) {
            // Only add if not already broken
            const exists = broken.some(b => b.object === object && desc.includes(object));
            if (!exists) {
                broken.push({
                    object,
                    description: `${object} ${keyword}ed`,
                    brokenInScene: scene.id
                });
            }
        }
    }

    return broken;
}

function evolveAtmosphericEffects(
    current: Array<{
        type: string;
        intensity: "light" | "moderate" | "heavy";
        addedInScene: number;
        dissipating?: boolean;
    }>,
    scene: Scene,
    desc: string
): Array<{
    type: string;
    intensity: "light" | "moderate" | "heavy";
    addedInScene: number;
    dissipating?: boolean;
}> {
    const effects = current.map(effect => ({
        ...effect,
        // Mark effects as dissipating over time
        dissipating: effect.addedInScene < scene.id - 2
    }));

    // Detect new atmospheric effects
    const effectKeywords = [
        { keywords: [ "smoke", "smoking" ], type: "smoke" },
        { keywords: [ "fog", "foggy" ], type: "fog" },
        { keywords: [ "dust cloud", "dust" ], type: "dust" },
        { keywords: [ "steam", "steaming" ], type: "steam" },
        { keywords: [ "mist", "misty" ], type: "mist" },
    ];

    for (const { keywords, type } of effectKeywords) {
        if (keywords.some(kw => desc.includes(kw))) {
            const intensity = parseEffectIntensity(desc);

            // Only add if not duplicate
            const exists = effects.some(e => e.type === type && !e.dissipating);
            if (!exists) {
                effects.push({
                    type,
                    intensity,
                    addedInScene: scene.id,
                    dissipating: false
                });
            }
        }
    }

    // Remove fully dissipated effects (older than 5 scenes)
    return effects.filter(effect => effect.addedInScene >= scene.id - 5);
}

function parseEffectIntensity(desc: string): "light" | "moderate" | "heavy" {
    if (desc.includes("heavy") || desc.includes("thick") || desc.includes("dense")) {
        return "heavy";
    }
    if (desc.includes("moderate")) {
        return "moderate";
    }
    return "light";
}
