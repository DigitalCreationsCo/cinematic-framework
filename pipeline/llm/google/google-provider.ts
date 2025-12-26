import { GoogleGenAI, GenerateContentParameters, Operation, GenerateContentResponse, GenerateVideosResponse, GenerateVideosParameters, GenerateImagesParameters, GenerateImagesResponse, CountTokensParameters, CountTokensResponse, OperationGetParameters, GenerateVideosOperation } from "@google/genai";
import { LlmProvider } from "../provider-types";

export class GoogleProvider implements LlmProvider {
    public llm: GoogleGenAI;
    private videoModel: GoogleGenAI;

    constructor() {
        const projectId = process.env.GCP_PROJECT_ID || "your-project-id";

        const llm = new GoogleGenAI({
            vertexai: true,
            project: projectId,
            location: "global"
        });
        this.llm = llm;
        this.videoModel = llm;
    }

    async generateContent(params: GenerateContentParameters): Promise<GenerateContentResponse> {
        return this.llm.models.generateContent(params);
    }

    async generateImages(params: GenerateImagesParameters): Promise<GenerateImagesResponse> {
        return this.videoModel.models.generateImages(params);
    }

    async generateVideos(params: GenerateVideosParameters): Promise<Operation<GenerateVideosResponse>> {
        return this.videoModel.models.generateVideos(params);
    }

    async getVideosOperation(params: OperationGetParameters<GenerateVideosResponse, GenerateVideosOperation>): Promise<Operation<GenerateVideosResponse>> {
        return this.videoModel.operations.getVideosOperation(params);
    }

    async countTokens(params: CountTokensParameters): Promise<CountTokensResponse> {
        return this.llm.models.countTokens(params);
    }
}
