export * from './provider-types';
export * from './google/google-provider';
import { GoogleProvider } from './google/google-provider';
import { LlmProvider, LlmProviderName } from './provider-types';

export class LlmController {
    provider: LlmProvider;

    constructor() {
        const providerName = process.env.LLM_PROVIDER as LlmProviderName;

        let provider;
        switch (providerName) {
            case "google":
                provider = new GoogleProvider()
                break;
            default:
                provider = new GoogleProvider();
                break;
        }
        
        this.provider = provider;
    }

    async generateContent(params: Parameters<this[ 'provider' ][ 'generateContent' ]>[ 0 ]) {
        return this.provider.generateContent(params);
    }
    
    async generateImages(params: Parameters<this[ 'provider' ][ 'generateImages' ]>[ 0 ]) {
        return this.provider.generateImages(params);
    }

    async generateVideos(params: Parameters<this[ 'provider' ][ 'generateVideos' ]>[ 0 ]) {
        return this.provider.generateVideos(params);
    }

    async getVideosOperation(params: Parameters<this[ 'provider' ][ 'getVideosOperation' ]>[ 0 ]) {
        return this.provider.getVideosOperation(params);
    }

    async countTokens(params: Parameters<this[ 'provider' ][ 'countTokens' ]>[ 0 ]) {
        return this.provider.countTokens(params);
    }
}
