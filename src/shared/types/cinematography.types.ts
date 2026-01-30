// shared/types/cinematography.types.ts
import { z } from "zod";

// ============================================================================
// CINEMATOGRAPHY ENUMS & TYPES
// ============================================================================

export const TransitionTypes = z.enum([
  "Cut",
  "Hard Cut",
  "Jump Cut",
  "Smash Cut",
  "Dissolve",
  "Cross Fade",
  "Fade",
  "Fade to Black",
  "Wipe",
  "Iris In",
  "Iris Out",
  "Push",
  "Slide",
  "none"
]);
export type TransitionType = z.infer<typeof TransitionTypes.options[ number ]>;


export const ShotTypes = z.union([
  z.literal("Extreme Close-Up").describe("Eyes, hands, small object details"),
  z.literal("Close-Up").describe("Head and shoulders only"),
  z.literal("Medium Close-Up").describe("Chest up"),
  z.literal("Medium Shot").describe("Waist up"),
  z.literal("Medium Wide").describe("Knees up"),
  z.literal("Wide Shot").describe("Full body head-to-toe visible"),
  z.literal("Very Wide/Establishing").describe("Environment dominates, characters small in frame"),
]);
export const shotTypesWithDescriptions = ShotTypes.options.map(option => ({
  value: option.value,
  description: option.description
}));
export type ShotType = z.Infer<typeof ShotTypes.options[ number ]>;


export const CameraMovements = z.union([
  z.literal("Static").describe("No movement [use for: stable moments, observation]"),
  z.literal("Pan Left").describe("Horizontal rotation [use for: following action, revealing space]"),
  z.literal("Pan Right").describe("Horizontal rotation [use for: following action, revealing space]"),
  z.literal("Pan").describe("Horizontal rotation [use for: following action, revealing space]"),
  z.literal("Tilt Up").describe("Vertical rotation [use for: revealing scale, subject to context]"),
  z.literal("Tilt Down").describe("Vertical rotation [use for: revealing scale, subject to context]"),
  z.literal("Tilt").describe("Vertical rotation [use for: revealing scale, subject to context]"),
  z.literal("Dolly In").describe("Moving toward subject [use for: intensifying focus, building tension]"),
  z.literal("Dolly Out").describe("Moving away [use for: revealing context, showing isolation]"),
  z.literal("Track Left").describe("Moving alongside [use for: dynamic action, following character]"),
  z.literal("Track Right").describe("Moving alongside [use for: dynamic action, following character]"),
  z.literal("Track").describe("Moving alongside [use for: dynamic action, following character]"),
  z.literal("Crane Up").describe("Sweeping vertical [use for: grand reveals, transitions]"),
  z.literal("Crane Down").describe("Sweeping vertical [use for: grand reveals, transitions]"),
  z.literal("Crane").describe("Sweeping vertical [use for: grand reveals, transitions]"),
  z.literal("Handheld").describe("Unstable, organic [use for: intimacy, chaos, urgency]"),
  z.literal("Steadicam").describe(""),
  z.literal("Drone").describe(""),
  z.literal("Aerial").describe(""),
  z.literal("Orbit").describe(""),
  z.literal("Zoom In").describe(""),
  z.literal("Zoom Out").describe(""),
]);
export const cameraMovementsWithDescriptions = CameraMovements.options.map(option => ({
  value: option.value,
  description: option.description
}));
export type CameraMovement = z.infer<typeof CameraMovements.options[ number ]>;


export const CameraAngles = z.union([
  z.literal("Eye Level").describe("Neutral, relatable perspective"),
  z.literal("High Angle").describe("15-45° looking down (subject appears smaller/vulnerable)"),
  z.literal("Low Angle").describe("15-45° looking up (subject appears larger/powerful)"),
  z.literal("Bird's Eye").describe("90° directly overhead"),
  z.literal("Dutch Angle").describe("Tilted horizon (creates psychological unease)"),
]);
export const cameraAnglesWithDescriptions = CameraAngles.options.map(option => ({
  value: option.value,
  description: option.description
}));
export type CameraAngle = z.infer<typeof CameraAngles.options[ number ]>;


export const Composition = z.object({
  "Subject Placement": z.string().default("Center").describe("e.g., Left third, Center, Right third"),
  "Focal Point": z.string().default("Center").describe("What draws the eye first"),
  "Depth Layers": z.string().default("Foreground").describe("Foreground, Midground, Background"),
  "Leading Lines": z.string().default("None").describe("Deliberate edges, shapes, or trajectories directing a viewer's eyes toward subject"),
  "Headroom": z.string().default("Standard").describe("Space above a subject's head. e.g., Tight, Standard, Generous"),
  "Look Room": z.string().default("None").describe("negative intentional space between a subject's face and the edge of the frame in the direction they are looking"),
});
export type Composition = z.infer<typeof Composition>;

export const Lighting = z.object({
    quality: z.object({
        hardness: z.string().default("Soft").describe("e.g. Soft (diffused, gentle shadows), Hard (sharp, defined shadows)"),
        colorTemperature: z.string().default("Neutral").describe("Warm (2700-3500K), Neutral (4000-5000K), Cool (5500-7000K)"),
        intensity: z.string().default("Medium").describe("e.g., Low (dim, moody), Medium (balanced), High (bright, energetic)"),
    }).default({
        hardness: "Soft",
        colorTemperature: "Neutral",
        intensity: "Medium",
    }).describe("Lighting quality specification, "),
    
    motivatedSources: z.object({
        "primaryLight": z.string().default("").describe("e.g., Sun through window, street lamp, overhead ceiling, firelight, etc"),
        "fillLight": z.string().default("").describe("e.g., Ambient skylight, reflected surfaces, secondary practicals"),
        "practicalLights": z.string().default("").describe("List visible light sources in frame: lamps, candles, screens"),
        "accentLight": z.string().default("").describe("e.g., Rim light from behind, side window, bounce from ground"),
        "lightBeams": z.string().default("").describe("e.g., Visible shafts, rays, None"),
    }).default({
        primaryLight: "",
        fillLight: "",
        practicalLights: "",
        accentLight: "",
        lightBeams: "",
    }).describe("Light sources"),
    
    direction: z.object({
        "keyLightPosition": z.string().default("").describe("e.g., Front - left, right 45°, Side 90°, Back 135 - 180°, Top-down, etc"),
        "shadowDirection": z.string().default("").describe("e.g, Falling left, right, forward, behind subject, etc"),
        "contrastRatio": z.string().default("").describe("e.g., Low(1: 2) flat, Medium(1: 4) standard, High(1: 8 +) dramatic, etc"),
    }).default({
        keyLightPosition: "",
        shadowDirection: "",
        contrastRatio: "",
    }).describe("Key light position, shadow direction"),
    
    atmosphere: z.object({
        "haze": z.string().default("None").describe("e.g., None, Light mist, Dense fog"),
    }).default({
        haze: "None",
    }).describe("Atmospheric lighting effects")
});
export type Lighting = z.infer<typeof Lighting>;


export const Cinematography = z.object({
    shotType: ShotTypes.default("Medium Close-Up"),
    cameraAngle: CameraAngles.default("Eye Level"),
    cameraMovement: CameraMovements.default("Steadicam"),
    transitionType: TransitionTypes.default("none"),
    composition: Composition.default(() => Composition.parse({})),
});
export type Cinematography = z.infer<typeof Cinematography>;