/**
 * BazaarSwap client tests. Every network call is mocked — `npm test` never touches the wire.
 * Moved from cardano-defi-mcp's adapter tests when BazaarSwap left that server.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getBaseUrl, getQuote, parseSseBuffer } from '../bazaar.js';

const ENV_KEYS = ['BAZAAR_API_URL', 'BAZAAR_API_KEY'] as const;

let savedEnv: Record<string, string | undefined>;

beforeEach(() => {
  savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const key of ENV_KEYS) delete process.env[key];
});

afterEach(() => {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** A `text/event-stream` Response whose body arrives in the given chunks. */
function sseResponse(chunks: string[], status = 200): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
  return new Response(stream, {
    status,
    headers: { 'content-type': 'text/event-stream' },
  });
}

function quote(quoteId: string, netOutput: string, merchantName: string) {
  return {
    quoteId,
    expiresAt: 1_900_000_000_000,
    merchantName,
    merchantLogo: `https://cdn.example/${merchantName}.svg`,
    fromChainId: 1,
    toChainId: 1815,
    fromToken: '0x0000000000000000000000000000000000000000',
    toToken: 'lovelace',
    inAmount: '1000000000000000000',
    outAmount: netOutput,
    netOutput,
    fees: { gas: [], platform: [], totalUSD: 0 },
    estimatedArrivalSeconds: 180,
    tx: { to: '0xrouter', data: '0xdeadbeef', value: '0' },
  };
}

const QUOTE_A = quote('q-a', '1200000000', 'rango');
const QUOTE_B = quote('q-b', '1350000000', 'squid');

/** Canned SSE transcript in the shape apps/api streams on GET /events/market. */
const SSE_FIXTURE =
  `event: adapters\ndata: {"adapters":["rango","squid"]}\n\n` +
  `: heartbeat\n\n` +
  `event: quote\ndata: ${JSON.stringify(QUOTE_A)}\n\n` +
  `event: adapter_result\ndata: {"adapter":"rango","status":"ok"}\n\n` +
  `event: quote\ndata: ${JSON.stringify(QUOTE_B)}\n\n` +
  `event: done\ndata: {"reason":"complete"}\n\n`;

// ── swap.parseSseBuffer ──────────────────────────────────────────────────────

describe('swap.parseSseBuffer', () => {
  it('parses whole events out of a canned text/event-stream buffer', () => {
    const { events, rest } = parseSseBuffer(SSE_FIXTURE);

    expect(rest).toBe('');
    expect(events.map((e) => e.event)).toEqual([
      'adapters',
      'quote',
      'adapter_result',
      'quote',
      'done',
    ]);
    expect(JSON.parse(events[1]!.data).quoteId).toBe('q-a');
  });

  it('drops comment-only blocks (heartbeats) rather than emitting empty events', () => {
    const { events } = parseSseBuffer(': heartbeat\n\n: another\n\n');
    expect(events).toEqual([]);
  });

  it('defaults a data-only block to the "message" event', () => {
    const { events } = parseSseBuffer('data: hello\n\n');
    expect(events).toEqual([{ event: 'message', data: 'hello' }]);
  });

  it('joins multi-line data with newlines and strips one leading space', () => {
    const { events } = parseSseBuffer('event: quote\ndata: line1\ndata:line2\n\n');
    expect(events[0]).toEqual({ event: 'quote', data: 'line1\nline2' });
  });

  it('normalises CRLF line endings', () => {
    const { events, rest } = parseSseBuffer('event: done\r\ndata: {}\r\n\r\n');
    expect(events).toEqual([{ event: 'done', data: '{}' }]);
    expect(rest).toBe('');
  });

  it('returns a trailing partial event as rest, and parses it once the rest arrives', () => {
    const split = SSE_FIXTURE.indexOf('"q-b"') + 3; // mid-way through the second quote's JSON
    const head = SSE_FIXTURE.slice(0, split);
    const tail = SSE_FIXTURE.slice(split);

    const first = parseSseBuffer(head);
    expect(first.events.map((e) => e.event)).toEqual(['adapters', 'quote', 'adapter_result']);
    expect(first.rest).not.toBe('');
    // The partial event must not have been emitted yet.
    expect(first.events.filter((e) => e.event === 'quote')).toHaveLength(1);

    const second = parseSseBuffer(first.rest + tail);
    expect(second.events.map((e) => e.event)).toEqual(['quote', 'done']);
    expect(JSON.parse(second.events[0]!.data).quoteId).toBe('q-b');
    expect(second.rest).toBe('');
  });
});

// ── swap.getQuote ────────────────────────────────────────────────────────────

describe('swap.getQuote', () => {
  const params = {
    fromChain: '1',
    toChain: '1815',
    fromToken: '0x0000000000000000000000000000000000000000',
    toToken: 'lovelace',
    amount: '1000000000000000000',
    userAddress: '0xabc',
    slippage: '0.5',
  };

  it('collects quotes off the SSE stream and resolves best/all by netOutput', async () => {
    // Chunk boundary falls inside an event so the carryover path is exercised.
    const cut = SSE_FIXTURE.indexOf('"q-b"') + 3;
    const fetchMock = vi.fn(async () =>
      sseResponse([SSE_FIXTURE.slice(0, cut), SSE_FIXTURE.slice(cut)]),
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await getQuote(params);

    expect(result.all.map((q) => q.quoteId)).toEqual(['q-b', 'q-a']);
    expect(result.best?.quoteId).toBe('q-b');
    expect(result.best?.merchantName).toBe('squid');
  });

  it('requests /events/market with the Bazaar param names and the SSE accept header', async () => {
    process.env.BAZAAR_API_URL = 'https://api.example.com/';
    const fetchMock = vi.fn(async () => sseResponse([SSE_FIXTURE]));
    vi.stubGlobal('fetch', fetchMock);

    await getQuote(params);

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const parsed = new URL(url);
    expect(parsed.origin + parsed.pathname).toBe('https://api.example.com/events/market');
    expect(Object.fromEntries(parsed.searchParams)).toEqual({
      fromChain: '1',
      toChain: '1815',
      fromToken: params.fromToken,
      toToken: 'lovelace',
      amount: params.amount,
      userAddress: '0xabc',
      slippage: '0.5',
    });
    expect((init.headers as Record<string, string>).accept).toBe('text/event-stream');
  });

  it('returns an empty race on no_routes', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => sseResponse(['event: no_routes\ndata: {"reason":"none"}\n\n'])),
    );

    const result = await getQuote(params);
    expect(result).toEqual({ best: null, all: [] });
  });

  it('throws a short message with the status on a non-2xx response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('bad request', { status: 400 })),
    );

    await expect(getQuote(params)).rejects.toThrow(/400 for \/events\/market/);
  });
});

describe('getBaseUrl', () => {
  it('defaults to the production BazaarSwap API, since gateway children get no environment', () => {
    expect(getBaseUrl()).toBe('https://bazaar-web.onrender.com');
  });

  it('honours BAZAAR_API_URL without a trailing slash', () => {
    process.env.BAZAAR_API_URL = 'http://localhost:3001/';
    expect(getBaseUrl()).toBe('http://localhost:3001');
  });
});
