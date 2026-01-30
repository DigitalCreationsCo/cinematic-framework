// ============================================================================
// OPTIMIZED AUDIO PROCESSING AGENT
// ============================================================================

import { GCPStorageManager } from "../services/storage-manager.js";
import { AudioAnalysis, AudioAnalysisAttributes, VALID_DURATIONS } from "../types/index.js";
import { FileData, GenerateContentResponse, GoogleGenAI, PartMediaResolution, PartMediaResolutionLevel, ThinkingLevel } from "@google/genai";
import { cleanJsonOutput, formatTime, roundToValidDuration, getJSONSchema } from "../utils/utils.js";
import { buildAudioProcessingInstruction } from "../prompts/audio-processing-instruction.js";
import { TextModelController } from "../llm/text-model-controller.js";
import { buildllmParams } from "../llm/google/google-llm-params.js";
import { MediaController } from "../services/media-controller.js";
import { GenerativeResultEnvelope, GenerativeResultProcessAudioToScenes, JobRecordProcessAudioToScenes } from "../types/job.types.js";
import { textModelName } from "../llm/google/models.js";

export class AudioProcessingAgent {
    private llm: TextModelController;
    private storageManager: GCPStorageManager;
    mediaController: MediaController;
    private options?: { signal?: AbortSignal; };

    constructor(llm: TextModelController, storageManager: GCPStorageManager, mediaController: MediaController, options?: { signal?: AbortSignal; }) {
        this.storageManager = storageManager;
        this.llm = llm;
        this.mediaController = mediaController;
        this.options = options;
    }

    /**
     * Processes an audio file to generate a detailed musical analysis and timed scene template.
     * @param audioPath The local path or public storage uri of audio file (mp3, wav) - if not provided, returns empty analysis.
     * @param enhancedPrompt The creative prompt for the video.
     * @returns A promise that resolves to an array of timed scenes and the audio GCS URI.
     */
    async processAudioToScenes(audioPath: string | undefined, enhancedPrompt: string): Promise<GenerativeResultProcessAudioToScenes> {
        if (!audioPath) {
            console.log(`🎤 No audio file provided, skipping audio processing`);
            return {
                data: {
                    analysis: {
                        bpm: 0,
                        keySignature: '',
                        duration: 0,
                        segments: [],
                        audioGcsUri: '',
                    }
                },
                metadata: {
                    model: textModelName,
                    attempts: 1,
                    acceptedAttempt: 1,
                }
            };
        }

        console.log(`🎤 Starting audio processing for: ${audioPath}`);

        const durationSeconds = await this.mediaController.getAudioDuration(audioPath);

        const result = await this.analyzeAudio(audioPath, enhancedPrompt, durationSeconds);

        return result;
    }

    private async analyzeAudio(audioPath: string, userPrompt: string, durationSeconds: number): Promise<GenerativeResultProcessAudioToScenes> {
        console.log(`   ... Analyzing audio with Gemini (detailed musical analysis)...`);

        const audioGcsUri = this.storageManager.getGcsUrl(audioPath);
        const audioPublicUri = this.storageManager.getPublicUrl(audioGcsUri);

        const audioFile: FileData = {
            displayName: "music track",
            fileUri: audioGcsUri,
            mimeType: "audio/mp3",
        };

        const systemPrompt = buildAudioProcessingInstruction(
            durationSeconds,
            VALID_DURATIONS,
            JSON.stringify(getJSONSchema(AudioAnalysisAttributes))
        );

        const audioCountToken = await this.llm.countTokens({
            model: buildllmParams({} as any).model,
            contents: {
                parts: [ { fileData: audioFile } ]
            }
        });

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
        const response = await this.llm.generateContent(buildllmParams({
            contents: [
                {
                    role: "user",
                    parts: [
                        // Media first mitigates "lost-in-the-middle" effect
                        { fileData: audioFile, mediaResolution: { numTokens: audioCountToken.totalTokens } },
                        { text: systemPrompt },
                        { text: userPrompt },
                    ],
                },
            ],
            config: {
                abortSignal: this.options?.signal,
                responseJsonSchema: getJSONSchema(AudioAnalysisAttributes),
                thinkingConfig: {
                    thinkingLevel: ThinkingLevel.HIGH
                }
            }
        }));

        if (!response?.candidates?.[ 0 ]?.content?.parts?.[ 0 ]?.text) {
            throw Error("No valid analysis result from LLM");
        }

        const rawText = cleanJsonOutput(response.candidates[ 0 ].content.parts[ 0 ].text);
        console.debug({ output: rawText });
        const analysis = AudioAnalysis.parse(JSON.parse(rawText));

        analysis.audioGcsUri = audioGcsUri;
        analysis.audioPublicUri = audioPublicUri;
        analysis.segments = analysis.segments.map((segment, index) => ({
            ...segment,
            sceneIndex: index,
        }));
        console.log(` ✓ Scene template generated with ${analysis.segments.length} scenes spanning ${analysis.duration} seconds.`);

        return { data: { analysis }, metadata: { model: textModelName, attempts: 1, acceptedAttempt: 1 } };
    }
}
