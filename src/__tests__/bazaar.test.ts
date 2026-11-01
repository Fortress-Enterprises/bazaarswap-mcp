/**
 * BazaarSwap client tests. Every network call is mocked — `npm test` never touches the wire.
 * Moved from cardano-defi-mcp's adapter tests when BazaarSwap left that server.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { forwardedFor, getBaseUrl, getQuote, getSwapStatus, parseSseBuffer } from '../bazaar.js';

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

  it('forwards the hosted caller IP so each caller keeps its own API rate limit', async () => {
    const fetchMock = vi.fn(async () => sseResponse([SSE_FIXTURE]));
    vi.stubGlobal('fetch', fetchMock);

    await forwardedFor.run('203.0.113.7', () => getQuote(params));
    await getQuote(params);

    const headersOf = (i: number) => (fetchMock.mock.calls[i] as unknown as [string, RequestInit])[1].headers as Record<string, string>;
    expect(headersOf(0)['x-forwarded-for']).toBe('203.0.113.7');
    expect(headersOf(1)).not.toHaveProperty('x-forwarded-for');
  });

  it('ranks on rankUSD when every quote has it, so a fee paid on top sinks the route', async () => {
    // Live case: Rubic out-quotes Rango but needs a $0.72 protocol fee sent as tx.value.
    const rubic = { ...quote('q-rubic', '438071694728150', 'Rubic'), rankUSD: 0.277 };
    const rango = { ...quote('q-rango', '436231162114395', 'Rango'), rankUSD: 0.998 };
    vi.stubGlobal('fetch', vi.fn(async () => sseResponse([
      `event: quote\ndata: ${JSON.stringify(rubic)}\n\n`,
      `event: quote\ndata: ${JSON.stringify(rango)}\n\nevent: done\ndata: {}\n\n`,
    ])));

    const result = await getQuote(params);
    expect(result.all.map((q) => q.quoteId)).toEqual(['q-rango', 'q-rubic']);
    expect(result.best?.quoteId).toBe('q-rango');
  });

  it('falls back to netOutput when any quote lacks rankUSD, so order never depends on arrival', async () => {
    const priced = { ...quote('q-priced', '1000', 'rango'), rankUSD: 5 };
    const unpriced = quote('q-unpriced', '2000', 'squid');
    vi.stubGlobal('fetch', vi.fn(async () => sseResponse([
      `event: quote\ndata: ${JSON.stringify(priced)}\n\nevent: quote\ndata: ${JSON.stringify(unpriced)}\n\nevent: done\ndata: {}\n\n`,
    ])));

    expect((await getQuote(params)).best?.quoteId).toBe('q-unpriced');
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

// ── swap.getSwapStatus ───────────────────────────────────────────────────────

describe('swap.getSwapStatus', () => {
  const TX = '0xfe6554f12ccc3e0440b844ebe35d38e9dba8d4ad00204fe55ff5df15d7306cce';
  const bridging = { txHash: TX, merchant: 'Rango', status: 'bridging', updatedAt: 1 };
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
  const unregistered = () => json({ txHash: TX, status: 'not_found', updatedAt: 1 }, 404);

  it('polls a registered swap without registering it again', async () => {
    const fetchMock = vi.fn(async () => json(bridging));
    vi.stubGlobal('fetch', fetchMock);

    expect(await getSwapStatus({ txHash: TX, tracking: 't' })).toEqual(bridging);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]![0]).toBe(`https://api.bazaarswap.io/status/${TX}`);
  });

  it('registers an unknown swap with its tracking token, then polls again', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(unregistered())
      .mockResolvedValueOnce(json({ ok: true, key: TX }))
      .mockResolvedValueOnce(json(bridging));
    vi.stubGlobal('fetch', fetchMock);

    expect(await getSwapStatus({ txHash: TX, tracking: 'tok.sig' })).toEqual(bridging);
    const [url, init] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(url).toBe('https://api.bazaarswap.io/status/register');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ txHash: TX, tracking: 'tok.sig' });
  });

  it('asks for the tracking token when an unknown swap comes without one', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => unregistered()));
    await expect(getSwapStatus({ txHash: TX })).rejects.toThrow(/tracking token from build_swap_tx/);
  });

  it('reports a refused registration with its status', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce(unregistered()).mockResolvedValueOnce(json({ error: 'Quote not found or expired' }, 404)),
    );
    await expect(getSwapStatus({ txHash: TX, tracking: 'stale' })).rejects.toThrow(/404 for \/status\/register: .*expired/);
  });
});

describe('getBaseUrl', () => {
  it('defaults to the production BazaarSwap API, since gateway children get no environment', () => {
    expect(getBaseUrl()).toBe('https://api.bazaarswap.io');
  });

  it('honours BAZAAR_API_URL without a trailing slash', () => {
    process.env.BAZAAR_API_URL = 'http://localhost:3001/';
    expect(getBaseUrl()).toBe('http://localhost:3001');
  });
});
