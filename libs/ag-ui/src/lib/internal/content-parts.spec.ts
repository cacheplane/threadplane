import { describe, expect, it } from 'vitest';
import { toolResultFromContent, messageContentFromParts } from './content-parts';

const text = { type: 'text', text: '{"hits":3}' };
const urlImage = { type: 'image', source: { type: 'url', value: 'https://x/y.png', mimeType: 'image/png' } };
const dataAudio = { type: 'audio', source: { type: 'data', value: 'AAAA', mimeType: 'audio/wav' } };

describe('toolResultFromContent', () => {
  it('parses a string result as JSON when possible', () => {
    expect(toolResultFromContent('{"hits":3}')).toEqual({ result: { hits: 3 } });
    expect(toolResultFromContent('plain')).toEqual({ result: 'plain' });
  });
  it('joins text parts and keeps every part', () => {
    expect(toolResultFromContent([text, urlImage])).toEqual({ result: { hits: 3 }, parts: [text, urlImage] });
  });
  it('yields an empty-string result for an all-media list', () => {
    expect(toolResultFromContent([dataAudio])).toEqual({ result: '', parts: [dataAudio] });
  });
  it('passes through non-string, non-array content untouched', () => {
    expect(toolResultFromContent({ hits: 3 })).toEqual({ result: { hits: 3 } });
  });
});

describe('messageContentFromParts', () => {
  it('maps text and url images to chat blocks and files the rest under extra', () => {
    expect(messageContentFromParts([text, urlImage, dataAudio])).toEqual({
      content: [
        { type: 'text', text: '{"hits":3}' },
        { type: 'image', url: 'https://x/y.png' },
      ],
      extra: { 'ag-ui': { parts: [dataAudio] } },
    });
  });
  it('returns no extra when every part mapped', () => {
    expect(messageContentFromParts([text])).toEqual({ content: [{ type: 'text', text: '{"hits":3}' }] });
  });
});
