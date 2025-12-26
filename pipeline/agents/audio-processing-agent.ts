// ============================================================================
// OPTIMIZED AUDIO PROCESSING AGENT
// ============================================================================

import { GCPStorageManager } from "../storage-manager";
import { AudioAnalysis, AudioAnalysisSchema, AudioSegment, Scene, TransitionType, VALID_DURATIONS, zodToJSONSchema } from "../../shared/pipeline-types";
import { FileData, GenerateContentResponse, GoogleGenAI, PartMediaResolution, PartMediaResolutionLevel, ThinkingLevel } from "@google/genai";
import path from "path";
import { cleanJsonOutput, formatTime, roundToValidDuration } from "../utils";
import ffmpeg from "fluent-ffmpeg";
import { buildAudioProcessingInstruction } from "../prompts/audio-processing-instruction";
import { LlmController } from "../llm/controller";
import { buildllmParams } from "../llm/google/llm-params";

export class AudioProcessingAgent {
    private genAI: LlmController;
    private storageManager: GCPStorageManager;
    private options?: { signal?: AbortSignal; };

    constructor(genAI: LlmController, storageManager: GCPStorageManager, options?: { signal?: AbortSignal; }) {
        this.storageManager = storageManager;
        this.genAI = genAI;
        this.options = options;
    }

    /**
     * Processes an audio file to generate a detailed musical analysis and timed scene template.
     * @param audioPath The local path or public storage uri of audio file (mp3, wav) - if not provided, returns empty analysis.
     * @param creativePrompt The creative prompt for the video.
     * @returns A promise that resolves to an array of timed scenes and the audio GCS URI.
     */
    async processAudioToScenes(audioPath: string | undefined, creativePrompt: string): Promise<AudioAnalysis> {
        if (!audioPath) {
            console.log(`🎤 No audio file provided, skipping audio processing`);
            return {
                bpm: 0,
                keySignature: '',
                totalDuration: 0,
                segments: [],
                audioGcsUri: '',
            };
        }

        console.log(`🎤 Starting audio processing for: ${audioPath}`);

        const durationSeconds = await this.getAudioDuration(audioPath);
        console.log(`   ... Actual audio duration (ffprobe): ${durationSeconds}s`);

        const audioGcsUri = this.storageManager.getGcsUrl(audioPath);
        const audioPublicUri = this.storageManager.getPublicUrl(audioPath);
        const result = await this.analyzeAudio(audioGcsUri, creativePrompt, durationSeconds);

        if (!result?.candidates?.[ 0 ]?.content?.parts?.[ 0 ]?.text) {
            throw Error("No valid analysis result from LLM");
        }

        const rawText = cleanJsonOutput(result.candidates[ 0 ].content.parts[ 0 ].text);
        const analysis: AudioAnalysis = JSON.parse(rawText);
        analysis.audioPublicUri = audioPublicUri;

        // Initialize startFrame and endFrame for each scene
        analysis.segments = analysis.segments.map((segment, index) => ({
            ...segment,
            id: index, // Ensure 0-based sequential IDs
            startFrame: undefined,
            endFrame: undefined,
        }));

        console.log(` ✓ Scene template generated with ${analysis.segments.length} scenes covering full track duration.`);
        return analysis;
    }

    private getAudioDuration(filePath: string): Promise<number> {
        return new Promise((resolve, reject) => {
            this.ffprobe(filePath, (err: any, metadata: any) => {
                if (err) {
                    reject(err);
                } else {
                    const duration = metadata.format.duration;
                    resolve(duration || 0);
                }
            });
        });
    }

    private ffprobe(filePath: string, callback: (err: any, metadata: any) => void): void {
        ffmpeg.ffprobe(filePath, callback);
    }

    private async analyzeAudio(gcsUri: string, userPrompt: string, durationSeconds: number): Promise<GenerateContentResponse> {
        console.log(`   ... Analyzing audio with Gemini (detailed musical analysis)...`);

        const audioFile: FileData = {
            displayName: "music track",
            fileUri: gcsUri,
            mimeType: "audio/mp3",
        };

        const jsonSchema = zodToJSONSchema(AudioAnalysisSchema);

        const prompt = buildAudioProcessingInstruction(
            durationSeconds,
            VALID_DURATIONS,
            jsonSchema
        );


        const audioCountToken = await this.genAI.countTokens({
            model: buildllmParams({} as any).model,
            contents: {
                parts: [ { fileData: audioFile } ]
            }
        })

        /**
         * ANALYZE AUDIO: Multimodal Storyboarding Logic
         * * CRITICAL IMPLEMENTATION NOTES FOR GEMINI 3 PRO PREVIEW:
         * * 1. MEDIA-FIRST POSITIONING: 
         * The `fileData` is placed at index 0 of the parts array. This forces the model 
         * to load the audio buffer into its attention head before parsing the instructions, 
         * significantly reducing "blind" hallucinations based on text-only prompts.
         * * 2. STOCHASTIC GROUNDING (audioEvidence):
         * The schema now requires 'audioEvidence'. This acts as a 'Chain of Verification' 
         * field, forcing the model to identify specific waveform events (transients, 
         * frequency shifts) to justify the creative storyboard choices.
         * * 3. TRANSIENT DETECTION:
         * By asking for 'transientImpact', we force the model to look at the 'attack' 
         * phase of the audio at the startTime, ensuring visual 'Cuts' align with 
         * actual musical beats rather than generic time-slices.
         * * 4. SYSTEM INSTRUCTION VS USER PROMPT:
         * Instructions are separated to maintain a 'Master Musicologist' persona, 
         * preventing the user's creative prompt from over-riding the technical 
         * requirements of the segmentation philosophy.
         */
        const result = await this.genAI.generateContent(buildllmParams({
            contents: [
                {
                    role: "user",
                    parts: [
                        // Media first mitigates "lost-in-the-middle" effect
                        { fileData: audioFile, mediaResolution: { level: PartMediaResolutionLevel.MEDIA_RESOLUTION_HIGH, numTokens: audioCountToken.totalTokens } },
                        { text: prompt },         // System-level instructions
                        { text: userPrompt },     // Specific user request
                    ],
                },
            ],
            config: {
                abortSignal: this.options?.signal,
                responseJsonSchema: jsonSchema,
                thinkingConfig: {
                    /** Indicates the thinking budget in tokens. 0 is DISABLED. -1 is AUTOMATIC. The default values and allowed ranges are model dependent. */
                    thinkingBudget: -1,
                    /** Optional. The level of thoughts tokens that the model should generate. */
                    thinkingLevel: ThinkingLevel.HIGH
                }
            }
        }));

        return result;
    }
}
