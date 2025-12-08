import MessageLog from '../MessageLog';
import type { PipelineMessage } from '@shared/pipeline-types';

// todo: remove mock functionality
const mockMessages: PipelineMessage[] = [
  { id: "1", type: "info", message: "Pipeline started - analyzing audio segments", timestamp: new Date() },
  { id: "2", type: "success", message: "Scene 1 generation complete", timestamp: new Date(), sceneId: 1 },
  { id: "3", type: "warning", message: "Scene 2 required 3 attempts due to character consistency issues", timestamp: new Date(), sceneId: 2 },
  { id: "4", type: "error", message: "Failed to generate scene 3 - content policy violation. Adjusting prompt.", timestamp: new Date(), sceneId: 3 },
  { id: "5", type: "info", message: "Retrying scene 3 with modified prompt", timestamp: new Date(), sceneId: 3 },
];

export default function MessageLogExample() {
  return (
    <div className="w-full max-w-md">
      <MessageLog 
        messages={mockMessages}
        onDismiss={(id) => console.log('Dismiss message:', id)}
      />
    </div>
  );
}
