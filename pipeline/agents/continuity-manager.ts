import {
    retryLlmCall,
    RetryConfig,
} from "../lib/llm-retry";
import {
    Character,
    Scene,
    Location,
    Storyboard,
    GraphState,
    ObjectData,
    SceneStatus,
} from "../../shared/pipeline-types";
import { GCPStorageManager } from "../storage-manager";
import { ApiError, Modality } from "@google/genai";
import { FrameCompositionAgent } from "./frame-composition-agent";
import { buildCharacterImagePrompt } from "../prompts/character-image-instruction";
import { buildLocationImagePrompt } from "../prompts/location-image-instruction";
import { composeEnhancedSceneGenerationPrompt } from "../prompts/prompt-composer";
import { buildFrameGenerationPrompt } from "../prompts/frame-generation-instruction";
import { LlmController, LlmProvider } from "../llm/controller";
import { imageModelName } from "../llm/google/models";
import { QualityCheckAgent } from "./quality-check-agent";
import { evolveCharacterState, evolveLocationState } from "./state-evolution";
import { GraphInterrupt } from "@langchain/langgraph";

// ============================================================================
// CONTINUITY MANAGER AGENT
// ============================================================================

export class ContinuityManagerAgent {
    private imageModel: LlmController;
    private storageManager: GCPStorageManager;
    private frameComposer: FrameCompositionAgent;
    private qualityAgent: QualityCheckAgent;
    private ASSET_GEN_COOLDOWN_MS = 60000;
    private options?: { signal?: AbortSignal; };

    constructor(
        llm: LlmController,
        imageModel: LlmController,
        frameComposer: FrameCompositionAgent,
        qualityAgent: QualityCheckAgent,
        storageManager: GCPStorageManager,
        options?: { signal?: AbortSignal; }
    ) {
        // llm parameter kept for backward compatibility but not used
        this.imageModel = imageModel;
        this.frameComposer = frameComposer;
        this.qualityAgent = qualityAgent;
        this.storageManager = storageManager;
        this.options = options;
    }

    async prepareAndRefineSceneInputs(
        scene: Scene,
        state: GraphState,
    ): Promise<{ enhancedPrompt: string; refinedRules: string[], startFrame?: ObjectData; characterReferenceImages?: ObjectData[]; locationReferenceImages?: ObjectData[]; location: Location; }> {
        if (!state.storyboardState) throw new Error("No storyboard state available");

        const { characters, locations, scenes } = state.storyboardState;
        const generationRules = state.generationRules || [];

        // Find previous scene for continuity context
        const previousSceneIndex = scenes.findIndex(s => s.id === scene.id) - 1;
        const previousScene = previousSceneIndex >= 0 ? scenes[ previousSceneIndex ] : undefined;

        const charactersInScene = characters.filter(char =>
            scene.characters.includes(char.id)
        );
        const characterReferenceImages = charactersInScene.flatMap(c => c.referenceImages || []);

        const locationInScene = locations.find(loc => loc.id === scene.locationId)!;
        const locationReferenceImages = locationInScene?.referenceImages || [];

        // Use role-based prompt composition for scene enhancement, or override if provided
        const promptOverride = state.scenePromptOverrides?.[ scene.id ];
        let enhancedPrompt = "";

        if (promptOverride) {
            console.log(`   📝 Using prompt override for Scene ${scene.id}`);
            enhancedPrompt = promptOverride;
        } else {
            enhancedPrompt = composeEnhancedSceneGenerationPrompt(
                scene,
                charactersInScene,
                locationInScene!,
                previousScene,
                generationRules
            );
        }

        // Refined rules are now incorporated directly in the enhanced prompt
        // Previous evaluation feedback is used to inform global generation rules
        const refinedRules = generationRules;

        return {
            enhancedPrompt,
            refinedRules,
            startFrame: previousScene?.endFrame,
            characterReferenceImages,
            locationReferenceImages,
            location: locationInScene,
        };
    }

    async generateCharacterAssets(
        characters: Character[],
        onProgress?: (id: string, msg: string, status?: SceneStatus, artifacts?: any) => Promise<void>
    ): Promise<Character[]> {
        console.log(`\n🎨 Checking for existing reference images for ${characters.length} characters...`);

        const charactersToGenerate: Character[] = [];
        const updatedCharacters: Character[] = [ ...characters ];

        for (const character of characters) {
            const imagePath = this.storageManager.getGcsObjectPath({ type: "character_image", characterId: character.id });
            const exists = await this.storageManager.fileExists(imagePath);

            if (exists) {
                console.log(`  → Found existing image for: ${character.name}`);
                const imageUrl = this.storageManager.getGcsUrl(imagePath);
                const characterIndex = updatedCharacters.findIndex(c => c.id === character.id);
                if (characterIndex > -1) {
                    updatedCharacters[ characterIndex ] = {
                        ...updatedCharacters[ characterIndex ],
                        referenceImages: [ this.storageManager.buildObjectData(imageUrl) ],
                    };
                }
            } else {
                console.log(`  → No image found for: ${character.name}. Queued for generation.`);
                charactersToGenerate.push(character);
            }
        }

        if (charactersToGenerate.length > 0) {
            console.log(`\n🎨 Generating reference images for ${charactersToGenerate.length} characters...`);

            for (const character of charactersToGenerate) {
                console.log(`  → Generating: ${character.name}`);

                if (onProgress) {
                    await onProgress(character.id, `Generating initial reference image...`);
                }

                const imagePrompt = buildCharacterImagePrompt(character);

                try {
                    const outputMimeType = "image/png";

                    const result = await retryLlmCall(
                        (params) => this.imageModel.generateContent({
                            model: imageModelName,
                            contents: [ params.prompt ],
                            config: {
                                abortSignal: this.options?.signal,
                                candidateCount: 1,
                                responseModalities: [ Modality.IMAGE ],
                                seed: Math.floor(Math.random() * 1000000),
                                imageConfig: {
                                    outputMimeType: outputMimeType
                                }
                            }
                        }),
                        {
                            prompt: imagePrompt,
                        },
                        {
                            initialDelay: this.ASSET_GEN_COOLDOWN_MS,
                        },
                    );

                    if (!result.candidates || result.candidates?.[ 0 ]?.content?.parts?.length === 0) {
                        throw new Error("Image generation failed to return any images.");
                    }

                    const generatedImageData = result.candidates[ 0 ].content?.parts?.[ 0 ]?.inlineData?.data;
                    if (!generatedImageData) {
                        throw new Error("Generated image is missing inline data.");
                    }

                    const imageBuffer = Buffer.from(generatedImageData, "base64");

                    const imagePath = this.storageManager.getGcsObjectPath({ type: "character_image", characterId: character.id });
                    const imageUrl = await this.storageManager.uploadBuffer(
                        imageBuffer,
                        imagePath,
                        outputMimeType,
                    );

                    const characterIndex = updatedCharacters.findIndex(c => c.id === character.id);
                    if (characterIndex > -1) {
                        updatedCharacters[ characterIndex ].referenceImages = [ this.storageManager.buildObjectData(imageUrl) ];
                    }
                    console.log(`    ✓ Saved: ${this.storageManager.getPublicUrl(imageUrl)}`);

                    if (onProgress) {
                        await onProgress(character.id, `Reference image generation complete.`);
                    }

                } catch (error) {
                    if (error instanceof GraphInterrupt) throw Error;

                    console.error(`    ✗ Failed to generate image for ${character.name}:`, error);
                    if (onProgress) {
                        await onProgress(character.id, `Reference image generation failed: ${(error as Error).message}`);
                    }
                    const characterIndex = updatedCharacters.findIndex(c => c.id === character.id);
                    if (characterIndex > -1) {
                        updatedCharacters[ characterIndex ].referenceImages = [];
                    }
                }
            }
        }

        // Ensure all characters have their state initialized with enhanced temporal tracking.
        return updatedCharacters.map(character => ({
            ...character,
            state: {
                lastSeen: undefined,
                position: "center",
                lastExitDirection: "none",
                emotionalState: "neutral",
                emotionalHistory: [],
                physicalCondition: "healthy",
                injuries: [],
                dirtLevel: "clean",
                exhaustionLevel: "fresh",
                sweatLevel: "dry",
                costumeCondition: {
                    tears: [],
                    stains: [],
                    wetness: "dry",
                    damage: [],
                },
                hairCondition: {
                    style: character.physicalTraits.hair,
                    messiness: "pristine",
                    wetness: "dry",
                },
            }
        }));
    }

    async generateSceneFramesBatch(
        scenes: Scene[],
        storyboardState: Storyboard,
        generationRules?: string[],
        onProgress?: (sceneId: number, msg: string, status?: SceneStatus, artifacts?: { startFrame?: ObjectData, endFrame?: ObjectData; }) => void
    ): Promise<Scene[]> {
        console.log(`\n🖼️ Generating start/end frames for ${scenes.length} scenes in batch...`);
        const updatedScenes: Scene[] = [];

        for (const scene of scenes) {
            const previousSceneIndex = storyboardState.scenes.findIndex(s => s.id === scene.id) - 1;
            const previousScene = previousSceneIndex >= 0 ? storyboardState.scenes[ previousSceneIndex ] : undefined;

            let currentScene = { ...scene };

            const sceneCharacters = storyboardState.characters.filter(char => currentScene.characters.includes(char.id));
            const sceneLocations = storyboardState.locations.filter(loc => currentScene.locationId.includes(loc.id));

            // --- Generate Start Frame ---
            if (!currentScene.startFrame?.storageUri) {
                const startFramePath = this.storageManager.getGcsObjectPath({ type: "scene_start_frame", sceneId: scene.id, attempt: 'latest' });
                const startFrameExists = await this.storageManager.fileExists(startFramePath);

                if (startFrameExists) {
                    console.log(`  → Found existing START frame for Scene ${scene.id} in storage`);
                    currentScene.startFrame = this.storageManager.buildObjectData(startFramePath);

                    // Reconstruct the prompt for state consistency
                    currentScene.startFramePrompt = buildFrameGenerationPrompt(
                        "start",
                        currentScene,
                        sceneCharacters,
                        sceneLocations,
                        previousScene,
                        generationRules
                    );
                } else {
                    console.log(`  → Generating START frame for Scene ${scene.id}...`);
                    const startFramePrompt = buildFrameGenerationPrompt(
                        "start",
                        currentScene,
                        sceneCharacters,
                        sceneLocations,
                        previousScene,
                        generationRules
                    );

                    currentScene.startFramePrompt = startFramePrompt;
                    currentScene.startFrame = await this.frameComposer.generateImage(
                        currentScene,
                        startFramePrompt,
                        "start",
                        sceneCharacters,
                        sceneLocations,
                        previousScene?.endFrame,
                        [
                            ...sceneCharacters.map(char => char.referenceImages![ 0 ]),
                            sceneLocations[ 0 ].referenceImages![ 0 ],
                        ],
                        onProgress
                    );
                }
            } else {
                console.log(`  → Found existing START frame for Scene ${scene.id} in state: ${currentScene.startFrame.publicUri}`);
            }

            // --- Generate End Frame ---
            if (!currentScene.endFrame?.storageUri) {
                const endFramePath = this.storageManager.getGcsObjectPath({ type: "scene_end_frame", sceneId: scene.id, attempt: 'latest' });
                const endFrameExists = await this.storageManager.fileExists(endFramePath);

                if (endFrameExists) {
                    console.log(`  → Found existing END frame for Scene ${scene.id} in storage`);
                    currentScene.endFrame = this.storageManager.buildObjectData(endFramePath);

                    // Reconstruct the prompt for state consistency
                    currentScene.endFramePrompt = buildFrameGenerationPrompt(
                        "end",
                        currentScene,
                        sceneCharacters,
                        sceneLocations,
                        previousScene,
                        generationRules
                    );
                } else {
                    console.log(`  → Generating END frame for Scene ${scene.id}...`);
                    const endFramePrompt = buildFrameGenerationPrompt(
                        "end",
                        currentScene,
                        sceneCharacters,
                        sceneLocations,
                        previousScene,
                        generationRules
                    );
                    currentScene.endFramePrompt = endFramePrompt;
                    currentScene.endFrame = await this.frameComposer.generateImage(
                        currentScene,
                        endFramePrompt,
                        "end",
                        sceneCharacters,
                        sceneLocations,
                        currentScene.startFrame,
                        [
                            ...sceneCharacters.map(char => char.referenceImages![ 0 ]),
                            sceneLocations[ 0 ].referenceImages![ 0 ]
                        ],
                        onProgress
                    );
                }
            } else {
                console.log(`  → Found existing END frame for Scene ${scene.id} in state: ${currentScene.endFrame.publicUri}`);
            }

            if (onProgress) onProgress(
                scene.id,
                `Saved START and END frame images`,
                "complete",
                {
                    startFrame: currentScene.startFrame,
                    endFrame: currentScene.endFrame
                }
            );

            updatedScenes.push(currentScene);
        }
        return updatedScenes;
    }

    async generateLocationAssets(
        locations: Location[],
        onProgress?: (id: string, msg: string, status?: SceneStatus, artifacts?: any) => Promise<void>
    ): Promise<Location[]> {
        console.log(`\n🎨 Checking for existing reference images for ${locations.length} locations...`);

        const locationsToGenerate: Location[] = [];
        const updatedLocations: Location[] = [ ...locations ];

        for (const location of locations) {
            const imagePath = this.storageManager.getGcsObjectPath({ type: "location_image", locationId: location.id });
            const exists = await this.storageManager.fileExists(imagePath);

            if (exists) {
                console.log(`  → Found existing image for: ${location.name}`);
                const imageUrl = this.storageManager.getGcsUrl(imagePath);
                const locationIndex = updatedLocations.findIndex(l => l.id === location.id);
                if (locationIndex > -1) {
                    updatedLocations[ locationIndex ] = {
                        ...updatedLocations[ locationIndex ],
                        referenceImages: [ this.storageManager.buildObjectData(imageUrl) ],
                    };
                }
            } else {
                console.log(`  → No image found for: ${location.name}. Queued for generation.`);
                locationsToGenerate.push(location);
            }
        }

        if (locationsToGenerate.length > 0) {
            console.log(`\n🎨 Generating reference images for ${locationsToGenerate.length} locations...`);

            for (const location of locationsToGenerate) {
                console.log(`  → Generating: ${location.name}`);

                if (onProgress) {
                    await onProgress(location.id, `Generating initial image for ${location.name}...`);
                }

                const imagePrompt = buildLocationImagePrompt(location);

                try {
                    const outputMimeType = "image/png";

                    const generateLocationImage = (params: any) => {
                        return this.imageModel.generateContent({
                            model: imageModelName,
                            contents: [ params.prompt ],
                            config: {
                                abortSignal: this.options?.signal,
                                candidateCount: 1,
                                responseModalities: [ Modality.IMAGE ],
                                seed: Math.floor(Math.random() * 1000000),
                                imageConfig: {
                                    outputMimeType: outputMimeType
                                }
                            }
                        });
                    };

                    const result = await retryLlmCall(
                        generateLocationImage,
                        { prompt: imagePrompt },
                        {
                            initialDelay: this.ASSET_GEN_COOLDOWN_MS,
                        },
                    );

                    if (!result.candidates || result.candidates?.[ 0 ]?.content?.parts?.length === 0) {
                        throw new Error("Image generation failed to return any images.");
                    }

                    const generatedImageData = result.candidates[ 0 ].content?.parts?.[ 0 ]?.inlineData?.data;
                    if (!generatedImageData) {
                        throw new Error("Generated image is missing inline data.");
                    }

                    const imageBuffer = Buffer.from(generatedImageData, "base64");

                    const imagePath = this.storageManager.getGcsObjectPath({ type: "location_image", locationId: location.id });
                    const imageUrl = await this.storageManager.uploadBuffer(
                        imageBuffer,
                        imagePath,
                        outputMimeType,
                    );

                    const locationIndex = updatedLocations.findIndex(l => l.id === location.id);
                    if (locationIndex > -1) {
                        updatedLocations[ locationIndex ].referenceImages = [ this.storageManager.buildObjectData(imageUrl) ];
                    }
                    console.log(`    ✓ Saved: ${this.storageManager.getPublicUrl(imageUrl)}`);

                    if (onProgress) {
                        await onProgress(location.id, `Reference image generation complete.`);
                    }

                } catch (error) {
                    if (error instanceof GraphInterrupt) throw Error;

                    console.error(`    ✗ Failed to generate image for ${location.name}:`, error);
                    if (onProgress) {
                        await onProgress(location.id, `Reference image generation failed: ${(error as Error).message}`);
                    }
                    const locationIndex = updatedLocations.findIndex(l => l.id === location.id);
                    if (locationIndex > -1) {
                        updatedLocations[ locationIndex ].referenceImages = [];
                    }
                }
            }
        }

        // Ensure all locations have their state initialized with enhanced temporal tracking.
        return updatedLocations.map(location => ({
            ...location,
            state: {
                lastUsed: undefined,
                timeOfDay: location.timeOfDay,
                timeHistory: [],
                weather: location.weather || "Clear",
                weatherHistory: [],
                precipitation: "none",
                visibility: "clear",
                lighting: location.lightingConditions,
                lightingHistory: [],
                groundCondition: {
                    wetness: "dry",
                    debris: [],
                    damage: [],
                },
                brokenObjects: [],
                atmosphericEffects: [],
                season: "unspecified",
                temperatureIndicators: [],
            }
        }));
    }

    updateStoryboardState(
        scene: Scene,
        currentStoryboardState: Storyboard
    ): Storyboard {
        // Use enhanced state evolution logic to track progressive changes

        const updatedCharacters = currentStoryboardState.characters.map((char: Character) => {
            if (scene.characters.includes(char.id)) {
                // Evolve character state based on scene narrative
                const evolvedState = evolveCharacterState(char, scene, scene.description);
                return {
                    ...char,
                    state: evolvedState
                };
            }
            return char;
        });

        const updatedLocations = currentStoryboardState.locations.map((loc: Location) => {
            if (loc.id === scene.locationId) {
                // Evolve location state based on scene narrative
                const evolvedState = evolveLocationState(loc, scene, scene.description);
                return {
                    ...loc,
                    state: evolvedState
                };
            }
            return loc;
        });

        // Update the specific scene in the scenes array with the latest generation data
        const updatedScenes = currentStoryboardState.scenes.map((s: Scene) => {
            if (s.id === scene.id) {
                return scene;
            }
            return s;
        });

        return {
            ...currentStoryboardState,
            characters: updatedCharacters,
            locations: updatedLocations,
            scenes: updatedScenes
        };
    }
}
