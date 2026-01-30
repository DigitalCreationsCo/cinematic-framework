import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LogContext, initLogger, logContextStore } from '../../shared/logger/index.js';

describe('Concurrency & Context Integrity', () => {
    const mockPublish = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();
        // Initialize the interceptor
        initLogger(mockPublish);
    });

    it('should maintain strict context isolation under high concurrency', async () => {
        const concurrentRequests = 100;

        const runTask = async (id: number) => {
            const context: LogContext = {
                w_id: "test-worker",
                jobId: `job-${id}`,
                projectId: `project-${id}`,
                correlationId: `corr-${id}`,
                shouldPublish: true
            };

            return new Promise<void>((resolve) => {
                logContextStore.run(context, async () => {
                    // Simulate random async delay to force event loop interleaving
                    await new Promise(r => setTimeout(r, Math.random() * 50));

                    // Trigger the intercepted console.log
                    console.log(`Executing task ${id}`);

                    resolve();
                });
            });
        };

        // Execute 100 tasks in parallel
        await Promise.all(Array.from({ length: concurrentRequests }).map((_, i) => runTask(i)));

        // Verify results
        expect(mockPublish).toHaveBeenCalledTimes(concurrentRequests);

        // Verify that every single call had the correct matching IDs
        mockPublish.mock.calls.forEach((call) => {
            const event = call[ 0 ];
            const idMatch = event.correlationId.match(/corr-(\d+)/);
            const id = idMatch ? idMatch[ 1 ] : null;

            // Ensure the correlationId matches the IDs in the payload
            expect(event.projectId).toBe(`project-${id}`);
            expect(event.payload.job_id).toBe(`job-${id}`);
        });
    });

    it('should handle context loss gracefully (Fallback Mode)', () => {
        const spy = vi.spyOn(console, 'log');

        // Log called OUTSIDE of a logContextStore.run() block
        console.log("Startup log with no context");

        expect(spy).toHaveBeenCalled();
        // Ensure we didn't attempt to publish an event without a project ID
        expect(mockPublish).not.toHaveBeenCalled();
    });
});