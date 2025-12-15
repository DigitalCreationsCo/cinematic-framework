import { describe, it, expect } from 'vitest';
import { calculateLearningTrends, cleanJsonOutput, formatTime, roundToValidDuration } from './utils';
import { WorkflowMetrics, AttemptMetric } from '../shared/pipeline-types';

describe('Utility Functions', () => {
  describe('cleanJsonOutput', () => {
    it('should remove markdown code blocks', () => {
      const input = '```json\n{"key": "value"}\n```';
      const expected = '{"key": "value"}';
      expect(cleanJsonOutput(input)).toBe(expected);
    });

    it('should extract JSON object from surrounding text', () => {
      const input = 'Some text before {"key": "value"} and some text after';
      const expected = '{"key": "value"}';
      expect(cleanJsonOutput(input)).toBe(expected);
    });

    it('should handle nested JSON objects', () => {
      const input = '```json\n{"a": {"b": {"c": 1}}}\n```';
      const expected = '{"a": {"b": {"c": 1}}}';
      expect(cleanJsonOutput(input)).toBe(expected);
    });

    it('should return the original string if no JSON object is found', () => {
      const input = 'this is a plain string';
      expect(cleanJsonOutput(input)).toBe(input);
    });
  });

  describe('formatTime', () => {
    it('should format seconds into MM:SS format', () => {
      expect(formatTime(65)).toBe('01:05');
      expect(formatTime(59)).toBe('00:59');
      expect(formatTime(120)).toBe('02:00');
      expect(formatTime(0)).toBe('00:00');
    });
  });

  describe('roundToValidDuration', () => {
    it('should round to the nearest valid duration', () => {
      expect(roundToValidDuration(3)).toBe(4);
      expect(roundToValidDuration(5)).toBe(4);
      expect(roundToValidDuration(6)).toBe(6);
      expect(roundToValidDuration(7)).toBe(6);
      expect(roundToValidDuration(8)).toBe(8);
      expect(roundToValidDuration(10)).toBe(8);
    });
  });

  describe('calculateLearningTrends', () => {
    it('should initialize metrics correctly on first attempt', () => {
      const currentMetrics: WorkflowMetrics = {
        sceneMetrics: [],
        attemptMetrics: [],
        trendHistory: [],
        regression: { count: 0, sumX: 0, sumY_a: 0, sumY_q: 0, sumXY_a: 0, sumXY_q: 0, sumX2: 0 },
      };
      
      const attempt: AttemptMetric = { sceneId: 1, attemptNumber: 1, finalScore: 0.8 };
      
      const updated = calculateLearningTrends(currentMetrics, attempt);
      
      expect(updated.attemptMetrics).toHaveLength(1);
      expect(updated.attemptMetrics[0]).toEqual(attempt);
      expect(updated.regression.count).toBe(1);
      expect(updated.globalTrend?.qualityTrendSlope).toBe(0); // Slope 0 with < 2 points
    });

    it('should calculate positive slope for improving quality', () => {
      let metrics: WorkflowMetrics = {
        sceneMetrics: [],
        attemptMetrics: [],
        trendHistory: [],
        regression: { count: 0, sumX: 0, sumY_a: 0, sumY_q: 0, sumXY_a: 0, sumXY_q: 0, sumX2: 0 },
      };

      // 0.5 -> 0.6 -> 0.7 (Perfect linear improvement)
      const attempts = [0.5, 0.6, 0.7];
      
      attempts.forEach((score, i) => {
        metrics = calculateLearningTrends(metrics, { sceneId: 1, attemptNumber: i + 1, finalScore: score });
      });

      expect(metrics.attemptMetrics).toHaveLength(3);
      expect(metrics.globalTrend?.qualityTrendSlope).toBeCloseTo(0.1);
    });

    it('should calculate negative slope for degrading quality', () => {
        let metrics: WorkflowMetrics = {
          sceneMetrics: [],
          attemptMetrics: [],
          trendHistory: [],
          regression: { count: 0, sumX: 0, sumY_a: 0, sumY_q: 0, sumXY_a: 0, sumXY_q: 0, sumX2: 0 },
        };
  
        // 0.9 -> 0.8 -> 0.7
        const attempts = [0.9, 0.8, 0.7];
        
        attempts.forEach((score, i) => {
          metrics = calculateLearningTrends(metrics, { sceneId: 1, attemptNumber: i + 1, finalScore: score });
        });
  
        expect(metrics.globalTrend?.qualityTrendSlope).toBeCloseTo(-0.1);
      });
  });
});
