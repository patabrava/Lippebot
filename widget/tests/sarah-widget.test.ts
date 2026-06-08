import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import {
  GREETINGS,
  INACTIVITY_FOLLOW_UP_MESSAGE,
  OPENING_MESSAGES,
  SarahWidget,
  pickGreeting,
} from '../src/sarah-widget.js';

describe('pickGreeting', () => {
  it('returns one of the configured bubble greetings', () => {
    const result = pickGreeting(GREETINGS, () => 0);
    expect(GREETINGS).toContain(result);
  });

  it('uses the rng to pick by index', () => {
    const result = pickGreeting(['a', 'b', 'c'], () => 2);
    expect(result).toBe('c');
  });

  it('clamps an rng value of 1 to the last entry', () => {
    const result = pickGreeting(['a', 'b', 'c'], () => 1);
    expect(result).toBe('c');
  });

  it('exports at least 3 bubble greetings and 3 opening messages', () => {
    expect(GREETINGS.length).toBeGreaterThanOrEqual(3);
    expect(OPENING_MESSAGES.length).toBeGreaterThanOrEqual(3);
  });
});

describe('SarahWidget inactivity handling', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    document.body.innerHTML = '';
    vi.stubGlobal('ResizeObserver', class {
      observe() {}
      disconnect() {}
    });
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0);
      return 0;
    });
    Element.prototype.scrollTo = vi.fn();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    localStorage.clear();
    document.body.innerHTML = '';
  });

  it('asks the inactivity follow-up after the configured idle window', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response([
      'data: {"type":"token","content":"Ich pruefe das fuer dich."}',
      'data: {"type":"done","mode":"berater","collectedData":{}}',
      '',
    ].join('\n')));
    vi.stubGlobal('fetch', fetchMock);

    new SarahWidget('https://api.example.test', {
      delay: 999_999,
      inactivityMs: 600_000,
      unansweredInactivityMs: 600_000,
    } as never);

    document.querySelector<HTMLButtonElement>('.sarah-bubble')!.click();
    const input = document.querySelector<HTMLInputElement>('.sarah-input')!;
    input.value = 'Mein Lift macht komische Geraeusche.';
    document.querySelector<HTMLButtonElement>('.sarah-send')!.click();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    expect(document.body.textContent).not.toContain(INACTIVITY_FOLLOW_UP_MESSAGE);
    await vi.advanceTimersByTimeAsync(600_000);

    expect(document.body.textContent).toContain(INACTIVITY_FOLLOW_UP_MESSAGE);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('submits an abandoned chat summary when the follow-up stays unanswered', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response([
        'data: {"type":"token","content":"Ich pruefe das fuer dich."}',
        'data: {"type":"done","mode":"berater","collectedData":{}}',
        '',
      ].join('\n')))
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: 'sent' }), {
        headers: { 'Content-Type': 'application/json' },
      }));
    vi.stubGlobal('fetch', fetchMock);

    new SarahWidget('https://api.example.test', {
      delay: 999_999,
      inactivityMs: 600_000,
      unansweredInactivityMs: 600_000,
    } as never);

    document.querySelector<HTMLButtonElement>('.sarah-bubble')!.click();
    const input = document.querySelector<HTMLInputElement>('.sarah-input')!;
    input.value = 'Ich brauche Hilfe mit meinem Treppenlift.';
    document.querySelector<HTMLButtonElement>('.sarah-send')!.click();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await vi.advanceTimersByTimeAsync(600_000);
    await vi.advanceTimersByTimeAsync(600_000);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][0]).toBe('https://api.example.test/api/chat/abandoned');
    expect(JSON.parse(fetchMock.mock.calls[1][1].body as string)).toEqual(expect.objectContaining({
      reason: 'no_answer_after_inactivity_prompt',
      history: expect.arrayContaining([
        expect.objectContaining({ role: 'assistant', content: INACTIVITY_FOLLOW_UP_MESSAGE }),
      ]),
    }));
  });
});
