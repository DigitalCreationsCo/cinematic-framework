import {
  Cinematography, Lighting, PhysicalTraits, DirectorScene, Location, Character
} from "../shared/types/index.js";

export const buildCinematicPrompt = (
  scene: DirectorScene,
  cinematography: Cinematography,
  lighting: Lighting,
  characters: Character[],
  location: Location
): string => {
  const parts: string[] = [];

  // 1. Scene Description & Mood
  parts.push(`Scene Description: ${scene.description}`);
  if (scene.mood) parts.push(`Mood: ${scene.mood}`);

  // 2. Location
  parts.push(`Location: ${location.name}. ${location.lightingConditions.quality.hardness} lighting.`);
  if (location.weather) parts.push(`Weather: ${location.weather}`);
  if (location.timeOfDay) parts.push(`Time: ${location.timeOfDay}`);

  // 3. Characters
  if (characters.length > 0) {
    const charDescriptions = characters.map(c => {
      const traits = c.physicalTraits;
      let desc = `${c.name}: ${traits.hair}, wearing ${Array.isArray(traits.clothing) ? traits.clothing.join(", ") : traits.clothing}`;
      if (traits.distinctiveFeatures.length > 0) desc += `, ${traits.distinctiveFeatures.join(", ")}`;
      return desc;
    });
    parts.push(`Characters: ${charDescriptions.join("; ")}`);
  }

  // 4. Cinematography
  parts.push(`Camera: ${cinematography.shotType}, ${cinematography.cameraMovement}, ${cinematography.cameraAngle}.`);
  if (cinematography.composition) parts.push(`Composition: ${cinematography.composition}`);

  // 5. Lighting Details
  if (Object.values(lighting.motivatedSources).length > 0) {
    parts.push(`Lighting Sources: ${Object.values(lighting.motivatedSources).join(", ")}`);
  }
  if (lighting.quality.colorTemperature) {
    parts.push(`Color Temp: ${lighting.quality.colorTemperature}`);
  }

  return parts.join("\n");
};
