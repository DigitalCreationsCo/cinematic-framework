import { describe, it, expect, vi, beforeEach } from 'vitest';
import { aggregateProjectPerformance } from '../workers/metrics-worker.js';
import { db } from '../../shared/db/index.js';

vi.mock('../../shared/db', () => ({
    db: {
        query: {
            projects: { findFirst: vi.fn() },
            scenes: { findMany: vi.fn() }
        },
        update: vi.fn().mockReturnValue({
            set: vi.fn().mockReturnValue({
                where: vi.fn().mockResolvedValue({})
            })
        })
    }
}));

describe('Metrics Worker', () => {
    it('should aggregate metrics from completed scenes', async () => {
        (db.query.projects.findFirst as any).mockResolvedValue({
            id: 'p1',
            metadata: { totalScenes: 5 }
        });

        (db.query.scenes.findMany as any).mockResolvedValue([
            { 
                status: 'complete', 
                startTime: 0, 
                endTime: 10, 
                assets: { 
                    scene_video: { 
                        head: 2, 
                        best: 2, 
                        versions: [{version: 2, metadata: { evaluation: { scores: { narrativeFidelity: { weight: 0.8 } } } } }] 
                    } 
                } 
            },
            { 
                status: 'complete', 
                startTime: 10, 
                endTime: 20, 
                assets: { 
                    scene_video: { 
                        head: 1, 
                        best: 1, 
                        versions: [{version: 1, metadata: { evaluation: { scores: { narrativeFidelity: { weight: 0.9 } } } } }] 
                    } 
                } 
            },
            { status: 'pending', startTime: 20, endTime: 30 }
        ]);

        await aggregateProjectPerformance('p1');

        expect(db.update).toHaveBeenCalled();
        
        // Inspect payload passed to set()
        const updateCall = (db.update as any).mock.results[0].value.set;
        expect(updateCall).toHaveBeenCalledWith(expect.objectContaining({
            metrics: expect.objectContaining({
                completedScenes: 2,
                averageAttemptsPerScene: 1.5,
                totalDuration: 30, // 10+10+10
            })
        }));
    });

    it('should do nothing if project not found', async () => {
        (db.query.projects.findFirst as any).mockResolvedValue(null);
        await aggregateProjectPerformance('p1');
        expect(db.update).not.toHaveBeenCalled();
    });
});
