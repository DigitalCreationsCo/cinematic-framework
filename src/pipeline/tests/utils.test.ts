import { describe, it, expect } from 'vitest';
import { cleanJsonOutput, formatTime, roundToValidDuration } from '../../shared/utils/utils.js';

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
      // VALID_DURATIONS are [5, 6, 7, 8]
      expect(roundToValidDuration(3)).toBe(5);
      expect(roundToValidDuration(5)).toBe(5);
      expect(roundToValidDuration(6)).toBe(6);
      expect(roundToValidDuration(7)).toBe(7);
      expect(roundToValidDuration(8)).toBe(8);
      expect(roundToValidDuration(10)).toBe(8);
    });
  });
});
