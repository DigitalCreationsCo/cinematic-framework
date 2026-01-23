import {
    retryLlmCall,
} from "../../shared/utils/llm-retry";
import {
    Character,
    Scene,
    Location,
    Storyboard,
    Project,
    AssetStatus,
} from "../../shared/types/workflow.types";
import { GCPStorageManager } from "../storage-manager";
import { Modality } from "@google/genai";
import { FrameCompositionAgent } from "./frame-composition-agent";
import { buildCharacterImagePrompt } from "../prompts/character-image-instruction";
import { buildLocationImagePrompt } from "../prompts/location-image-instruction";
import { composeEnhancedSceneGenerationPromptMetav1, composeEnhancedSceneGenerationPromptMetav2, composeGenerationRules } from "../prompts/prompt-composer";
import { TextModelController } from "../llm/text-model-controller";
import { imageModelName, textModelName } from "../llm/google/models";
import { ThinkingLevel } from "@google/genai";
import { buildllmParams } from "../llm/google/google-llm-params";
import { QualityCheckAgent } from "./quality-check-agent";
import { evolveCharacterState, evolveLocationState } from "./state-evolution";
import { GraphInterrupt } from "@langchain/langgraph";
import { cleanJsonOutput, getAllBestFromAssets } from "../../shared/utils/utils";
import { AssetVersionManager } from "../asset-version-manager";
import { SaveAssetsCallback, UpdateSceneCallback, OnAttemptCallback } from "@shared/types/pipeline.types";
import { GenerativeResultEnvelope, JobRecordGenerateCharacterAssets, JobRecordGenerateLocationAssets, JobRecordGenerateSceneFrames } from "@shared/types/job.types";



export class ContinuityManagerAgent {
    private llm: TextModelController;
    private imageModel: TextModelController;
    private storageManager: GCPStorageManager;
    private assetManager: AssetVersionManager;
    private frameComposer: FrameCompositionAgent;
    private qualityAgent: QualityCheckAgent;
    private ASSET_GEN_COOLDOWN_MS = 60000;
    private options?: { signal?: AbortSignal; };

    constructor(
        llm: TextModelController,
        imageModel: TextModelController,
        frameComposer: FrameCompositionAgent,
        qualityAgent: QualityCheckAgent,
        storageManager: GCPStorageManager,
        assetManager: AssetVersionManager,
        options?: { signal?: AbortSignal; }
    ) {
        this.llm = llm;
        this.imageModel = imageModel;
        this.frameComposer = frameComposer;
        this.qualityAgent = qualityAgent;
        this.storageManager = storageManager;
        this.assetManager = assetManager;
        this.options = options;
    }

    async prepareAndRefineSceneInputs(
        scene: Scene,
        state: Project,
        overridePrompt: boolean,
        saveAssets: SaveAssetsCallback,
    ): Promise<{
        enhancedPrompt: string;
        startFrame?: string;
        characterReferenceImages?: string[];
        locationReferenceImages?: string[];
        sceneCharacters: Character[];
        location: Location;
        previousScene: Scene | undefined;
        generationRules: string[];
    }> {

        if (!state.metadata) throw new Error("No metadata available");
        if (!state.characters) throw new Error("No characters data available");
        if (!state.locations) throw new Error("No locations data available");
        if (!state.scenes) throw new Error("No scenes data available");

        const { characters, locations, scenes } = state;
        const generationRules = state.generationRules || [];

        const previousSceneIndex = scenes.findIndex(s => s.id === scene.id) - 1;
        const previousScene = previousSceneIndex >= 0 ? scenes[ previousSceneIndex ] : undefined;

        const charactersInScene = characters.filter(char =>
            scene.characters.includes(char.id)
        );
        const characterReferenceImages = charactersInScene.flatMap(c => {
            const assets = getAllBestFromAssets(c.assets);
            return assets['character_image']?.data ? [ assets['character_image'].data ] : [];
        });

        const locationInScene = locations.find(loc => loc.id === scene.locationId)!;
        const locationAssets = getAllBestFromAssets(locationInScene?.assets);
        const locationReferenceImages = locationAssets['location_image']?.data ? [ locationAssets['location_image'].data ] : [];

        let enhancedPrompt = "";
        if (overridePrompt) {
            const [ promptAsset ] = await this.assetManager.getBestVersion(
                { projectId: scene.projectId, sceneId: scene.id },
                'scene_prompt'
            );
            if (promptAsset) {
                enhancedPrompt = promptAsset.data;
                console.log(`   📝 Using prompt override for Scene ${scene.id}`);
            } else {
                console.log(` Prompt asset not found. Override will not be used .`);
            }
        }

        if (!enhancedPrompt) {
            console.log(`   🧠 Generating enhanced video prompt for Scene ${scene.id} via LLM...`);
            let metaPrompt = composeEnhancedSceneGenerationPromptMetav1(
                scene,
                charactersInScene,
                locations,
                previousScene,
            );

            console.log(`   📝 Meta-Prompt Instructions (First 500 chars):\n${metaPrompt.substring(0, 500)}...`);

            const params = buildllmParams({
                contents: metaPrompt,
                config: {
                    abortSignal: this.options?.signal,
                    thinkingConfig: {
                        thinkingLevel: ThinkingLevel.HIGH
                    }
                }
            });
            const response = await this.llm.generateContent(params);
            if (!response.text) {
                console.warn("   ⚠️ LLM failed to generate enhanced prompt. Using metaPrompt as fallback.");
                enhancedPrompt = metaPrompt;
            } else {
                enhancedPrompt = cleanJsonOutput(response.text);
            }
            enhancedPrompt += composeGenerationRules(generationRules);
            saveAssets(
                { projectId: scene.projectId, sceneId: scene.id },
                'scene_prompt',
                'text',
                [ enhancedPrompt ],
                { model: params.model, prompt: metaPrompt }
            );
            console.log(`   ✨ Generated Video Prompt:\n"${enhancedPrompt}"`);
        }

        return {
            enhancedPrompt,
            generationRules,
            startFrame: previousScene ? getAllBestFromAssets(previousScene.assets)[ 'scene_end_frame' ]?.data : undefined,
            sceneCharacters: charactersInScene,
            location: locationInScene,
            characterReferenceImages,
            locationReferenceImages,
            previousScene,
        };
    }

    async generateCharacterAssets(
        characters: Character[],
        generationRules: string[],
        saveAssets: SaveAssetsCallback,
        onAttempt: OnAttemptCallback,
    ): Promise<GenerativeResultEnvelope<JobRecordGenerateCharacterAssets[ 'result' ]>> {

        const charactersToGenerateIds: string[] = [];
        const charactersToGenerate: Character[] = [];
        const updatedCharacters: Character[] = [ ...characters ];
        for (const character of characters) {
            const assets = getAllBestFromAssets(character.assets);
            if (!assets[ 'character_image' ]?.data) {

                console.log(`  → No image found for: ${character.name}. Queued for generation.`);
                charactersToGenerateIds.push(character.id);
                charactersToGenerate.push(character);
            }
        }

        console.log(`\n🎨 Generating reference images for ${charactersToGenerate.length} characters...`);
        if (charactersToGenerate.length > 0) {
            for (const [ index, character ] of charactersToGenerate.entries()) {
                const [attempt] = await this.assetManager.getNextVersionNumber({ projectId: character.projectId, characterIds: [ character.id ] }, 'character_image');

                const imagePrompt = buildCharacterImagePrompt(character, generationRules);
                saveAssets(
                    { projectId: character.projectId, characterIds: [ character.id ] },
                    'character_prompt',
                    'text',
                    [ imagePrompt ],
                    { model: textModelName },
                    true
                );

                console.log(`\n🎨 Checking for existing reference images for ${characters.length} characters...`);
                const imagePath = this.storageManager.getObjectPath({ type: "character_image", characterId: character.id, attempt });
                const exists = await this.storageManager.fileExists(imagePath);
                if (exists) {
                    console.log(`  → Found existing image for: ${character.name}`);
                    const imageUrl = this.storageManager.getGcsUrl(imagePath);

                    saveAssets(
                        { projectId: character.projectId, characterIds: [ character.id ] },
                        'character_image',
                        'image',
                        [ imageUrl ],
                        { model: imageModelName, prompt: imagePrompt },
                        true
                    );

                } else {
                    console.log(`  → Generating: ${character.name}`);
                    // if (onProgress) { await onProgress(character.id, `Generating initial reference image...`, "generating"); }

                    try {
                        const maxRetries = this.qualityAgent.qualityConfig.safetyRetries + attempt;
                        const outputMimeType = "image/png";
                        const result = await retryLlmCall(
                            (params) => this.imageModel.generateContent({
                                model: params.imageModel,
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
                                imageModel: imageModelName,
                            },
                            {
                                attempt,
                                maxRetries,
                                initialDelay: this.ASSET_GEN_COOLDOWN_MS,
                                projectId: character.projectId
                            },
                            async (error, attempt, params) => {
                                onAttempt(attempt);
                                return {
                                    attempt,
                                    params
                                };
                            }
                        );
                        if (!result.candidates || result.candidates?.[ 0 ]?.content?.parts?.length === 0) {
                            throw new Error("Image generation failed to return any images.");
                        }

                        const generatedImageData = result.candidates[ 0 ].content?.parts?.[ 0 ]?.inlineData?.data;
                        if (!generatedImageData) {
                            throw new Error("Generated image is missing inline data.");
                        }

                        const imageBuffer = Buffer.from(generatedImageData, "base64");
                        const imagePath = this.storageManager.getObjectPath({ type: "character_image", characterId: character.id, attempt });
                        const imageUrl = await this.storageManager.uploadBuffer(
                            imageBuffer,
                            imagePath,
                            outputMimeType,
                        );

                        saveAssets(
                            { projectId: character.projectId, characterIds: [ character.id ] },
                            'character_image',
                            'image',
                            [ imageUrl ],
                            { model: imageModelName, prompt: imagePrompt },
                            true
                        );

                        console.log(` ✓ Saved character image: ${this.storageManager.getPublicUrl(imageUrl)}`);
                        // if (onProgress) { await onProgress(character.id, `Reference image generation complete.`, "complete"); }

                    } catch (error) {
                        console.error(`    ✗ Failed to generate image for ${character.name}:`, error);
                        if (error instanceof GraphInterrupt) throw error;
                        // if (onProgress) { await onProgress(character.id, `Reference image generation failed: ${(error as Error).message}`, "error"); }
                    }
                }
            }
        }

        // Ensure all characters have their state initialized with enhanced temporal tracking.
        const finalizedCharacters = updatedCharacters.map(character => ({
            ...character,
            state: {
                lastSeen: character.state?.lastSeen || undefined,
                position: character.state?.position || "center",
                lastExitDirection: character.state?.lastExitDirection || "none",
                emotionalState: character.state?.emotionalState || "neutral",
                emotionalHistory: character.state?.emotionalHistory || [],
                physicalCondition: character.state?.physicalCondition || "healthy",
                injuries: character.state?.injuries || [],
                dirtLevel: character.state?.dirtLevel || "clean",
                exhaustionLevel: character.state?.exhaustionLevel || "fresh",
                sweatLevel: character.state?.sweatLevel || "dry",
                costumeCondition: character.state?.costumeCondition || {
                    tears: [],
                    stains: [],
                    wetness: "dry",
                    damage: [],
                },
                hairCondition: character.state?.hairCondition || {
                    style: character.physicalTraits.hair,
                    messiness: "pristine",
                    wetness: "dry",
                },

            }
        }));
        return { data: { characters: finalizedCharacters }, metadata: { model: imageModelName, attempts: 1, acceptedAttempt: 1 } };
    }


    async generateSceneFramesBatch(
        project: Project,
        assetKey: 'scene_start_frame' | 'scene_end_frame',
        saveAssets: SaveAssetsCallback,
        updateScene: UpdateSceneCallback,
        onAttempt: OnAttemptCallback,
    ): Promise<GenerativeResultEnvelope<JobRecordGenerateSceneFrames[ 'result' ]>> {
        console.log(`\n🖼️ Generating ${assetKey} for ${project.scenes.length} scenes in batch...`);
        const updatedScenes: Scene[] = [];

        for (const scene of project.scenes) {
            const previousSceneIndex = project.scenes.findIndex(s => s.id === scene.id) - 1;
            const previousScene = previousSceneIndex >= 0 ? project.scenes[ previousSceneIndex ] : undefined;

            let currentScene = { ...scene };

            const sceneCharacters = project.characters.filter(char => currentScene.characters.includes(char.id));
            const sceneLocations = project.locations.filter(loc => currentScene.locationId.includes(loc.id));

            // --- Generate Start Frame ---
            const currentAssets = getAllBestFromAssets(currentScene.assets);
            const frame = currentAssets[ assetKey ]?.data;
            if (!frame) {
                const [ attempt ] = await this.assetManager.getNextVersionNumber({ projectId: project.id, sceneId: scene.id }, assetKey);
                const framePath = this.storageManager.getObjectPath({ type: assetKey, sceneId: scene.id, attempt });
                const frameExists = await this.storageManager.fileExists(framePath);

                const promptKey = assetKey === "scene_start_frame" ? "start_frame_prompt" : "end_frame_prompt";
                let framePrompt = currentAssets[ promptKey ]?.data;
                if (!framePrompt) {
                    console.warn(`No ${promptKey} found for Scene ${scene.id}`);

                    // Reconstruct the prompt for state consistency
                    framePrompt = await this.frameComposer.generateFrameGenerationPrompt(
                        assetKey === "scene_start_frame" ? "start" : "end",
                        currentScene,
                        sceneCharacters,
                        sceneLocations,
                        previousScene,
                        project.generationRules
                    );
                }

                if (frameExists) {
                    console.log(`  → Found existing ${assetKey} for Scene ${scene.id} in storage`);
                    const url = this.storageManager.getGcsUrl(framePath);

                    saveAssets(
                        { projectId: project.id, sceneId: scene.id },
                        assetKey,
                        'image',
                        [ url ],
                        { model: imageModelName, prompt: framePrompt },
                        true
                    );


                } else {
                    console.log(`  → Generating ${assetKey} for Scene ${scene.id}...`);
                    const previousAssets = getAllBestFromAssets(previousScene?.assets);
                    const prevEndFrameOrSceneStartFrame =
                        assetKey === "scene_start_frame" ?
                            previousAssets[ 'scene_end_frame' ]?.data :
                            currentAssets[ 'scene_start_frame' ]?.data;
                    
                    const charImages = sceneCharacters.flatMap(c => {
                         const a = getAllBestFromAssets(c.assets);
                         return a['character_image']?.data ? [a['character_image'].data] : [];
                    });
                    const locImages = sceneLocations.flatMap(l => {
                         const a = getAllBestFromAssets(l.assets);
                         return a['location_image']?.data ? [a['location_image'].data] : [];
                    });

                    const result = await this.frameComposer.generateImage(
                        currentScene,
                        framePrompt,
                        assetKey === "scene_start_frame" ? "start" : "end",
                        sceneCharacters,
                        sceneLocations,
                        prevEndFrameOrSceneStartFrame,
                        [ ...charImages, ...locImages ],
                        saveAssets,
                        updateScene,
                        onAttempt,
                    );
                    
                    saveAssets(
                        { projectId: project.id, sceneId: scene.id },
                        assetKey,
                        'image',
                        [ result.data.image ],
                        { model: imageModelName, prompt: framePrompt },
                        true
                    );

                    saveAssets(
                        { projectId: project.id, sceneId: scene.id },
                        promptKey,
                        'text',
                        [ framePrompt ],
                        { model: textModelName },
                        true
                    );
                }
            } else {
                console.log(`  → Found existing ${assetKey} for Scene ${scene.id} in state: ${this.storageManager.getPublicUrl(frame)}`);
            }

            currentScene.progressMessage =
                `Saved ${assetKey}`;
            currentScene.status =
                "complete";

            updatedScenes.push(currentScene);

            updateScene(currentScene);
        }
        return { data: { updatedScenes }, metadata: { model: imageModelName, attempts: 1, acceptedAttempt: 1 } };
    }

    async generateLocationAssets(
        locations: Location[],
        generationRules: string[],
        saveAssets: SaveAssetsCallback,
        onAttempt: OnAttemptCallback,
    ): Promise<GenerativeResultEnvelope<JobRecordGenerateLocationAssets[ 'result' ]>> {

        const locationsToGenerateIds: string[] = [];
        const locationsToGenerate: Location[] = [];
        let updatedLocations: Location[] = [ ...locations ];
        for (const loc of locations) {
            const assets = getAllBestFromAssets(loc.assets);
            if (!assets[ 'location_image' ]?.data) {

                console.log(`  → No image found for: ${loc.name}. Queued for generation.`);
                locationsToGenerateIds.push(loc.id);
                locationsToGenerate.push(loc);
            }
        }

        console.log(`\n🎨 Generating reference images for ${locationsToGenerate.length} locations...`);
        if (locationsToGenerate.length > 0) {
            for (const [ index, location ] of locationsToGenerate.entries()) {
                const [attempt] = await this.assetManager.getNextVersionNumber({ projectId: location.projectId, locationIds: [ location.id ] }, 'location_image');

                console.log(`\n🎨 Checking for existing reference images for ${locations.length} locations...`);
                const imagePath = this.storageManager.getObjectPath({ type: "location_image", locationId: location.id, attempt });
                const exists = await this.storageManager.fileExists(imagePath);

                if (exists) {
                    console.log(`  → Found existing image for: ${location.name}`);
                    const imageUrl = this.storageManager.getGcsUrl(imagePath);
                    saveAssets(
                        { projectId: location.projectId, locationIds: [ location.id ] },
                        'location_image',
                        'image',
                        [ imageUrl ],
                        { model: imageModelName },
                        true
                    );
                } else {
                    console.log(`  → Generating: ${location.name}`);
                    // if (onProgress) { await onProgress(location.id, `Generating initial image for ${location.name}...`, "generating"); }

                    const imagePrompt = buildLocationImagePrompt(location, generationRules);
                    try {
                        const maxRetries = this.qualityAgent.qualityConfig.safetyRetries + attempt;
                        const outputMimeType = "image/png";
                        const result = await retryLlmCall(
                            (params) => {
                                return this.imageModel.generateContent({
                                    model: params.model,
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
                            },
                            {
                                prompt: imagePrompt,
                                model: imageModelName
                            },
                            {
                                attempt,
                                maxRetries,
                                initialDelay: this.ASSET_GEN_COOLDOWN_MS,
                                projectId: location.projectId
                            },
                            async (error, attempt, params) => {
                                onAttempt(attempt);
                                return {
                                    attempt,
                                    params,
                                };
                            }
                        );
                        if (!result.candidates || result.candidates?.[ 0 ]?.content?.parts?.length === 0) {
                            throw new Error("Image generation failed to return any images.");
                        }

                        const generatedImageData = result.candidates[ 0 ].content?.parts?.[ 0 ]?.inlineData?.data;
                        if (!generatedImageData) {
                            throw new Error("Generated image is missing inline data.");
                        }

                        const imageBuffer = Buffer.from(generatedImageData, "base64");
                        const imagePath = this.storageManager.getObjectPath({ type: "location_image", locationId: location.id, attempt });
                        const imageUrl = await this.storageManager.uploadBuffer(
                            imageBuffer,
                            imagePath,
                            outputMimeType,
                        );

                        saveAssets(
                            { projectId: location.projectId, locationIds: [ location.id ] },
                            'location_image',
                            'image',
                            [ imageUrl ],
                            { model: imageModelName, prompt: imagePrompt },
                            true
                        );

                        saveAssets(
                            { projectId: location.projectId, locationIds: [ location.id ] },
                            'location_prompt',
                            'text',
                            [ imagePrompt ],
                            { model: textModelName },
                            true
                        );
                        console.log(`    ✓ Saved: ${this.storageManager.getPublicUrl(imageUrl)}`);
                        // if (onProgress) { await onProgress(location.id, `Reference image generation complete.`, "complete"); }

                    } catch (error) {
                        console.error(`    ✗ Failed to generate image for ${location.name}:`, error);
                        if (error instanceof GraphInterrupt) throw Error;
                        // if (onProgress) { await onProgress(location.id, `Reference image generation failed: ${(error as Error).message}`, "error"); }
                    }
                }
            }
        }

        // Ensure all locations have their state initialized with enhanced temporal tracking.
        updatedLocations = updatedLocations.map(location => ({
            ...location,
            state: {
                lastUsed: location.state?.lastUsed || undefined,
                timeOfDay: location.state?.timeOfDay || location.timeOfDay,
                timeHistory: location.state?.timeHistory || [],
                weather: location.state?.weather || location.weather || "Clear",
                weatherHistory: location.state?.weatherHistory || [],
                precipitation: location.state?.precipitation || "none",
                visibility: location.state?.visibility || "clear",
                lighting: location.state?.lighting || location.lightingConditions,
                lightingHistory: location.state?.lightingHistory || [],
                groundCondition: location.state?.groundCondition || {
                    wetness: "dry",
                    debris: [],
                    damage: [],
                },
                brokenObjects: location.state?.brokenObjects || [],
                atmosphericEffects: location.state?.atmosphericEffects || [],
                season: location.state?.season || "unspecified",
                temperatureIndicators: location.state?.temperatureIndicators || [],
            }
        }));

        return { data: { locations: updatedLocations }, metadata: { model: imageModelName, attempts: 1, acceptedAttempt: 1 } };
    }

    /**
     * Use state evolution logic to track progressive narrative changes
     * across scenes
     */
    updateNarrativeState(
        scene: Scene,
        currentStoryboardState: Project
    ): Project {

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
