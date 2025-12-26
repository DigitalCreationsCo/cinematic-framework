import {
    CountTokensParameters,
    CountTokensResponse,
    GenerateContentParameters,
    GenerateContentResponse,
    GenerateImagesParameters,
    GenerateImagesResponse,
    GenerateVideosOperation,
    GenerateVideosParameters,
    GenerateVideosResponse,
    Operation,
    OperationGetParameters,
} from '@google/genai';

export type LlmProviderName = "google";

export interface LlmProvider {
    generateContent(params: GenerateContentParameters): Promise<GenerateContentResponse>;
    generateImages(params: GenerateImagesParameters): Promise<GenerateImagesResponse>;
    generateVideos(params: GenerateVideosParameters): Promise<Operation<GenerateVideosResponse>>;
    getVideosOperation(params: OperationGetParameters<GenerateVideosResponse, GenerateVideosOperation>): Promise<Operation<GenerateVideosResponse>>;
    countTokens(params: CountTokensParameters): Promise<CountTokensResponse>
}
