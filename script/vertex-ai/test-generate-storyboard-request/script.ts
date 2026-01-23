import { execSync } from 'child_process';
import { InitialContextSchema, Scene } from '../../../src/shared/types/workflow.types';
import { getJSONSchema } from '../../../src/shared/utils/utils';
import { buildDirectorVisionPrompt } from "../../../src/workflow/prompts/role-director";
import fs from 'fs';

async function callVertexAI() {
    try {
        // 2. Get Access Token via CLI
        const accessToken = execSync('gcloud auth print-access-token', {
            // stdio: [stdin, stdout, stderr]
            // 'pipe' for stdout tells Node to capture it
            // 'ignore' for stderr tells Node to throw away the Python warnings
            stdio: [ 'ignore', 'pipe', 'ignore' ]
        }).toString().trim();

        // 3. Prepare configuration
        const project = process.env.GCP_PROJECT_ID;
        const location = process.env.GCP_LOCATION;
        const modelId = process.env.TEXT_MODEL_NAME;
        const endpoint = `https://aiplatform.googleapis.com/v1/projects/${project}/locations/global/publishers/google/models/${modelId}:generateContent`;

        const jsonSchema = getJSONSchema(InitialContextSchema);

        const jsonPath = 'script/vertex-ai/out/json-schema.json';
        fs.writeFileSync(jsonPath, JSON.stringify(jsonSchema, null, 2), 'utf-8');
        console.log(`Schema saved successfully to ${jsonPath}`);

        const title = "My Storyboard";
        const enhancedPrompt = "My Enhanced Prompt";
        const scenes: Scene[] = [];
        const totalDuration = 0;
        const systemPrompt = buildDirectorVisionPrompt(title, enhancedPrompt, JSON.stringify(jsonSchema), scenes, totalDuration);

        const context = `
              Generate the initial storyboard context including:
        
              ### Metadata
              ${JSON.stringify(getJSONSchema(InitialContextSchema.shape.metadata))}
        
              ### Characters
              ${JSON.stringify(getJSONSchema(InitialContextSchema.shape.characters))}
        
              ### Locations
              ${JSON.stringify(getJSONSchema(InitialContextSchema.shape.locations))}
        
              The scene-by-scene breakdown will be handled in a second pass.
            `;

        // 4. Construct the Payload
        const payload = {
            contents: [
                { role: 'user', parts: [ { text: systemPrompt } ] },
                { role: 'user', parts: [ { text: context } ] }
            ],
            generationConfig: {
                responseMimeType: "application/json",
                responseJsonSchema: jsonSchema,
                thinkingConfig: {
                    thinkingLevel: "HIGH"
                }
            }
        };

        // 5. Simple HTTP Request (using native fetch)
        const response = await fetch(endpoint, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Vertex AI API Error: ${response.status} - ${errorText}`);
        }

        const result = await response.json();

        const resultPath = 'script/vertex-ai/out/result.json';
        fs.writeFileSync(resultPath, JSON.stringify(result, null, 2), 'utf-8');
        console.log(`Response saved successfully to ${resultPath}`);

        const content = result.candidates[ 0 ].content.parts[ 0 ].text;
        const parsedContent = JSON.parse(content);

        const contentPath = 'script/vertex-ai/out/content.json';
        fs.writeFileSync(contentPath, JSON.stringify(parsedContent, null, 2), 'utf-8');
        console.log(`Content saved successfully to ${contentPath}`);


    } catch (error) {
        console.error("Execution failed:", error);
    }
}

callVertexAI();