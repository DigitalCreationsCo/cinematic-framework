import { describe, it, expect } from 'vitest';
import { calculateTrend, predictRemainingAttempts } from '../../shared/utils/regression.js';

describe('Regression Utility', () => {
    describe('calculateTrend', () => {
        it('should calculate slope and intercept for linear data', () => {
            // y = 2x + 1
            const values = [1, 3, 5, 7]; // x=0,1,2,3
            const { slope, intercept } = calculateTrend(values);
            expect(slope).toBeCloseTo(2);
            expect(intercept).toBeCloseTo(1);
        });

        it('should handle single point', () => {
            const values = [5];
            const { slope, intercept } = calculateTrend(values);
            expect(slope).toBe(0);
            expect(intercept).toBe(5);
        });
        
        it('should handle empty array', () => {
             const { slope, intercept } = calculateTrend([]);
             expect(slope).toBe(0);
             expect(intercept).toBe(0);
        });
    });

    describe('predictRemainingAttempts', () => {
        it('should predict future attempts based on trend', () => {
            // x: 0, 1, 2. y: 1, 2, 3.
            // Slope 1, Intercept 1.
            const history = [1, 2, 3]; 
            const remaining = 2;
            
            // Next x: 3. y = 3*1 + 1 = 4.
            // Next x: 4. y = 4*1 + 1 = 5.
            // Sum = 9.
            const result = predictRemainingAttempts(history, remaining);
            expect(result).toBe(9); 
        });

        it('should clamp prediction to at least 1', () => {
             const history = [5, 4, 3, 2]; // Decreasing
             const remaining = 5;
             const result = predictRemainingAttempts(history, remaining);
             expect(result).toBeGreaterThanOrEqual(remaining);
        });

        it('should use average if history is insufficient', () => {
            const history = [2];
            const remaining = 3;
            // Avg = 2. Prediction = 2 * 3 = 6.
            expect(predictRemainingAttempts(history, remaining)).toBe(6);
        });
    });
});
