export const promptVersion = "3.0.0-script-supervisor";

import { Scene, Character, Location } from "../../shared/pipeline-types";

/**
 * SCRIPT SUPERVISOR - Continuity Tracking
 * Ensures visual continuity across all scenes for characters, locations, props, and spatial geography
 */

export const buildScriptSupervisorContinuityChecklist = (
      scene: Scene,
      previousScene: Scene | undefined,
      characters: Character[],
      locations: Location[]
) => {
      const location = locations.find((l) => l.id === scene.locationId);
      const previousLocation = previousScene?.locationId ? locations.find((l) => l.id === previousScene.locationId) : undefined;

      return `
SCRIPT SUPERVISOR CONTINUITY CHECKLIST for Scene ${scene.id}:

${previousScene
                  ? `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PREVIOUS SCENE ${previousScene.id}:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
End Frame: ${previousScene.endFrame?.publicUri || "N/A"}
Description: ${previousScene.description}
Lighting: ${previousScene.lighting}
Characters: ${previousScene.characters.join(", ")}
Location: ${previousScene.locationId}
`
                  : `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
FIRST SCENE - ESTABLISH BASELINES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
No previous scene. Set initial states for all characters and location.
`
            }

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CURRENT SCENE ${scene.id} REQUIREMENTS:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Description: ${scene.description}
Characters: ${scene.characters.join(", ")}
Location: ${scene.locationId}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CHARACTER CONTINUITY (verify each):
━━━━━━━━━━━━━━━━━━━━━━━━━━━━

${characters
                  .map(
                        (char) => `
CHARACTER: ${char.name}
☐ Hair: ${char.physicalTraits.hair} [MUST MATCH EXACTLY]
☐ Clothing: ${char.physicalTraits.clothing} [MUST MATCH EXACTLY]
☐ Accessories: ${char.physicalTraits.accessories.join(", ")} [MUST MATCH EXACTLY]
☐ Position: ${previousScene
                                    ? "[Carryforward from previous: if exited left, enters right; if exited right, enters left]"
                                    : "[Establish initial position: left/center/right, foreground/background]"
                              }
☐ Physical State: ${previousScene
                                    ? "[Injuries, dirt, sweat carry forward and accumulate]"
                                    : "[Establish initial clean/pristine state]"
                              }
☐ Emotional State: [Previous: ${previousScene?.mood || "N/A"} → Current: ${scene.mood}]
`
                  )
                  .join("\n")}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
LOCATION CONTINUITY:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Location: ${location?.name || "Unspecified"}
☐ Lighting Direction: ${previousScene
                  ? "[MUST match unless time/location changed]"
                  : "[Establish baseline lighting direction]"
            }
☐ Weather: ${location?.weather || "Clear"} ${previousScene
                  ? "[Can evolve gradually: rain→drizzle→stop, not instant changes]"
                  : ""
            }
☐ Time Progression: ${previousScene ? "[How much time has passed since previous scene?]" : "[Starting time of day]"
            }
☐ Props: ${previousScene
                  ? "[Any objects from previous scene must remain/persist unless removed]"
                  : "[Establish what objects are present]"
            }

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SPATIAL CONTINUITY (Screen Direction):
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
180° Line Rule: Characters on same side of imaginary line maintain left/right positions
${previousScene
                  ? `
Previous Positions: [Document where each character was: left/center/right]
Current Positions: [Maintain spatial relationships OR show motivated movement]
Exit/Entry: [If character exits frame-left, they enter next scene frame-right, and vice versa]
`
                  : `
Establish Geography: [Define who is where, facing which direction]
Spatial Relationships: [Who is left/right relative to each other]
`
            }

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CARRYFORWARD NOTES:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${previousScene
                  ? `
FROM PREVIOUS SCENE:
- Lighting: ${previousScene.lighting}
- Character States: [List any damage, exhaustion, emotional carryover]
- Props in Play: [Any objects that must continue to exist]
- Weather: ${previousLocation?.weather || "N/A"}
`
                  : `
- No previous scene. Establish all baselines.
`
            }

FOR NEXT SCENE:
- End states to preserve: [List what the NEXT scene must inherit]
- Character positions at end of this scene: [Where each character finishes]
- Any accumulated damage/dirt/changes: [Track progressive wear]

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CONSTRAINT:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
When in doubt, MATCH EXACTLY. Only allow evolution with clear narrative justification.
If continuity must break (e.g., time jump, location change), explicitly note the break.

OUTPUT: Continuity verification checklist (not paragraph descriptions).
`;
};

export const buildScriptSupervisorPrompt = (
      scene: Scene,
      previousScene: Scene | undefined,
      characters: Character[],
      locations: Location[]
) => `
You are the SCRIPT SUPERVISOR ensuring continuity for Scene ${scene.id}.

${buildScriptSupervisorContinuityChecklist(scene, previousScene, characters, locations)}

VERIFY ALL CHECKLIST ITEMS ABOVE.

OUTPUT: Completed continuity checklist with all items verified.
`;
