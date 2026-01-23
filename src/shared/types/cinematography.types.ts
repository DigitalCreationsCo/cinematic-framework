import { z } from "zod";

// ============================================================================
// CINEMATOGRAPHY SCHEMAS (Cinematographer)
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
    "Subject Placement": z.string().describe("e.g., Left third, Center, Right third"),
    "Focal Point": z.string().describe("What draws the eye first"),
    "Depth Layers": z.string().describe("Foreground: X, Midground: Y, Background: Z"),
    "Leading Lines": z.string().describe("Deliberate edges, shapes, or trajectories directing a viewer's eyes toward subject"),
    "Headroom": z.string().describe("Space above a subject's head. e.g., Tight, Standard, Generous"),
    "Look Room": z.string().describe("negative intentional space between a subject's face and the edge of the frame in the direction they are looking"),
});
export type Composition = z.infer<typeof Composition>;


// ============================================================================
// LIGHTING SCHEMAS (Gaffer)
// ============================================================================

export const Lighting = z.object({
    quality: z.object({
        Hardness: z.string().describe("e.g. Soft (diffused, gentle shadows), Hard (sharp, defined shadows)"),
        colorTemperature: z.string().describe("Warm (2700-3500K), Neutral (4000-5000K), Cool (5500-7000K)"),
        intensity: z.string().describe("e.g., Low (dim, moody), Medium (balanced), High (bright, energetic)"),
    }).describe("Lighting quality specification, "),
    motivatedSources: z.object({
        "Primary Light": z.string().describe("e.g., Sun through window, street lamp, overhead ceiling, firelight, etc"),
        "Fill Light": z.string().describe("e.g., Ambient skylight, reflected surfaces, secondary practicals"),
        "Practical Lights": z.string().describe("List visible light sources in frame: lamps, candles, screens"),
        "Accent Light": z.string().describe("e.g., Rim light from behind, side window, bounce from ground"),
        "Light Beams": z.string().describe("e.g., Visible shafts, rays, None"),
    }).describe("Light sources"),
    direction: z.object({
        "Key Light Position": z.string().describe("e.g., Front - left, right 45°, Side 90°, Back 135 - 180°, Top-down, etc"),
        "Shadow Direction": z.string().describe("e.g, Falling left, right, forward, behind subject, etc"),
        "Contrast Ratio": z.string().describe("e.g., Low(1: 2) flat, Medium(1: 4) standard, High(1: 8 +) dramatic, etc"),
    }).describe("Key light position, shadow direction"),
    atmosphere: z.object({
        "Haze": z.string().describe("e.g., None, Light mist, Dense fog"),
    }).describe("Atmospheric lighting effects")
});
export type Lighting = z.infer<typeof Lighting>;


export const Cinematography = z.object({
    shotType: ShotTypes,
    cameraAngle: CameraAngles,
    cameraMovement: CameraMovements,
    composition: Composition,
});
export type Cinematography = z.infer<typeof Cinematography>;