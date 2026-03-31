import { describe, it, expect, beforeEach } from 'vitest';
import { ChatHistory } from '../src/storage/history.js';

describe('ChatHistory', () => {
  let history: ChatHistory;

  beforeEach(() => {
    localStorage.clear();
    history = new ChatHistory();
  });

  it('starts with empty messages', () => {
    expect(history.getMessages()).toEqual([]);
  });

  it('adds and retrieves messages', () => {
    history.addMessage('user', 'Hallo');
    history.addMessage('assistant', 'Hallo! Ich bin Sarah.');
    const messages = history.getMessages();
    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe('user');
    expect(messages[0].content).toBe('Hallo');
    expect(messages[1].role).toBe('assistant');
  });

  it('persists to localStorage', () => {
    history.addMessage('user', 'Test');
    const newHistory = new ChatHistory();
    expect(newHistory.getMessages()).toHaveLength(1);
    expect(newHistory.getMessages()[0].content).toBe('Test');
  });

  it('clears messages', () => {
    history.addMessage('user', 'Test');
    history.clear();
    expect(history.getMessages()).toEqual([]);
  });

  it('expires after TTL', () => {
    history.addMessage('user', 'Old message');
    const data = JSON.parse(localStorage.getItem('sarah-chat-history')!);
    data.lastUpdated = Date.now() - (8 * 24 * 60 * 60 * 1000);
    localStorage.setItem('sarah-chat-history', JSON.stringify(data));

    const newHistory = new ChatHistory();
    expect(newHistory.getMessages()).toEqual([]);
  });

  it('getSessionId returns consistent ID', () => {
    const id1 = history.getSessionId();
    const id2 = history.getSessionId();
    expect(id1).toBe(id2);
    expect(id1.length).toBeGreaterThan(0);
  });
});
