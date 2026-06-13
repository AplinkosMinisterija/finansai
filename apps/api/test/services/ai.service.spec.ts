/**
 * AI serviso testai (Iter 17).
 *
 *  - `validateDashboardSpec` — LLM output sanitizacija (shared paketo logika,
 *    bet kritiškiausia API pusėje, todėl testuojama čia).
 *  - `ai.dashboard` — deterministinis default spec'as iš realių agregatų.
 *  - `ai.chat` — pilnas SSE ciklas su mock'intu LLM fetch'u (tool call →
 *    spec event → reply → done) + 503 be konfigūracijos.
 *
 * LLM tinklo kvietimai mock'inami per `global.fetch` — testai nepriklauso
 * nuo gyvo vLLM endpoint'o.
 */
import type { ServiceBroker } from 'moleculer';
import type { PassThrough } from 'stream';
import { AI_SPEC_LIMITS, validateDashboardSpec } from '@biip-finansai/shared';
import { createTestBroker } from '../helpers/broker';
import { getTestKnex, closeTestKnex, truncateAll, seedBaseFixtures } from '../helpers/db';
import { mockAuthUser, mockOrgUser } from '../helpers/auth';

describe('validateDashboardSpec', () => {
  it('praleidžia pilną teisingą spec su visais widget tipais', () => {
    const result = validateDashboardSpec({
      title: 'Testas',
      widgets: [
        { id: 's1', type: 'stat', title: 'Suma', value: '100 €', subtitle: 'sub' },
        {
          id: 'b1',
          type: 'bar',
          title: 'Baras',
          data: [{ m: '2026-01', v: 10 }],
          xKey: 'm',
          series: [{ key: 'v', label: 'V', color: '#0f766e' }],
        },
        { id: 'p1', type: 'pie', data: [{ name: 'A', value: 5 }] },
        {
          id: 't1',
          type: 'table',
          columns: [{ key: 'a', label: 'A', format: 'eur' }],
          rows: [{ a: 100 }],
        },
        { id: 'pr1', type: 'progress', items: [{ label: 'X', value: 5, max: 10 }] },
        { id: 'm1', type: 'markdown', content: '## Antraštė\n- punktas' },
      ],
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.spec.widgets).toHaveLength(6);
      expect(result.spec.title).toBe('Testas');
    }
  });

  it('salvage: blogi widget`ai atmetami, geri lieka, klaidos surašomos', () => {
    const result = validateDashboardSpec({
      widgets: [
        { id: 'ok', type: 'stat', value: '1' },
        { id: 'bad-type', type: 'hologram', value: 'x' },
        { id: 'bad-bar', type: 'bar', data: [], xKey: 'm', series: [] },
      ],
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.spec.widgets.map((w) => w.id)).toEqual(['ok']);
    }
  });

  it('atmeta ne-objektą ir tuščią widgets masyvą', () => {
    expect(validateDashboardSpec(null).ok).toBe(false);
    expect(validateDashboardSpec('str').ok).toBe(false);
    expect(validateDashboardSpec({ widgets: [] }).ok).toBe(false);
    expect(validateDashboardSpec({ widgets: [{ id: 'x', type: 'stat' }] }).ok).toBe(false);
  });

  it('karpo viršlimitinius widget`us ir dubliuotus id pervadina', () => {
    const widgets = Array.from({ length: 20 }, (_, i) => ({
      id: 'same',
      type: 'stat',
      value: String(i),
    }));
    const result = validateDashboardSpec({ widgets });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.spec.widgets.length).toBeLessThanOrEqual(AI_SPEC_LIMITS.maxWidgets);
      const ids = result.spec.widgets.map((w) => w.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it('dataRef widgetai praleidžiami be literalių data laukų', () => {
    const result = validateDashboardSpec({
      widgets: [
        {
          id: 's',
          type: 'stat',
          title: 'X',
          dataRef: { source: 'metric', params: { metric: 'islaidos_faktine' } },
        },
        { id: 'sk', type: 'sankey', title: 'Srautas', dataRef: { source: 'budget_flow_sankey' } },
        {
          id: 'tm',
          type: 'treemap',
          title: 'Hierarchija',
          dataRef: { source: 'budget_hierarchy_treemap' },
        },
        { id: 'r', type: 'radar', title: 'Radaras', dataRef: { source: 'requests_by_status' } },
      ],
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.spec.widgets).toHaveLength(4);
      expect(result.spec.widgets[0]?.dataRef?.source).toBe('metric');
      // Be dataRef ir be literalių laukų — atmetama.
      const bad = validateDashboardSpec({ widgets: [{ id: 'x', type: 'sankey' }] });
      expect(bad.ok).toBe(false);
    }
  });

  it('validuoja literalų sankey (nodes+links, indeksai ribose, value>0)', () => {
    const result = validateDashboardSpec({
      widgets: [
        {
          id: 'sk',
          type: 'sankey',
          nodes: [{ name: 'A' }, { name: 'B' }, { name: 'C' }],
          links: [
            { source: 0, target: 1, value: 100 },
            { source: 1, target: 2, value: 50 },
            { source: 0, target: 9, value: 10 }, // indeksas už ribų — atmetamas
            { source: 0, target: 1, value: -5 }, // value<=0 — atmetamas
          ],
        },
      ],
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      const w = result.spec.widgets[0];
      expect(w?.links).toHaveLength(2);
    }
  });

  it('išmeta ne-primityvias reikšmes iš data/rows (sanitizacija)', () => {
    const result = validateDashboardSpec({
      widgets: [
        {
          id: 't',
          type: 'table',
          columns: [{ key: 'a', label: 'A' }],
          rows: [{ a: 1, nested: { evil: true }, fn: 'ok-string' }],
        },
      ],
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      const row = result.spec.widgets[0]?.rows?.[0];
      expect(row).toEqual({ a: 1, fn: 'ok-string' });
    }
  });
});

describe('ai service', () => {
  let broker: ServiceBroker;
  const originalFetch = global.fetch;
  const originalLlmBaseUrl = process.env.LLM_BASE_URL;

  beforeAll(async () => {
    const knex = getTestKnex();
    await truncateAll(knex);
    await seedBaseFixtures(knex);
    broker = await createTestBroker();
  });

  afterAll(async () => {
    if (broker) await broker.stop();
    await closeTestKnex();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    if (originalLlmBaseUrl === undefined) {
      delete process.env.LLM_BASE_URL;
    } else {
      process.env.LLM_BASE_URL = originalLlmBaseUrl;
    }
  });

  describe('ai.dashboard', () => {
    it('grąžina default spec su widget`ais AM admin`ui', async () => {
      const result = (await broker.call(
        'ai.dashboard',
        {},
        { meta: { user: mockAuthUser() } },
      )) as { spec: { widgets: Array<{ id: string; type: string }> }; generatedAt: string };
      expect(result.generatedAt).toBeTruthy();
      expect(result.spec.widgets.length).toBeGreaterThan(0);
      expect(result.spec.widgets.some((w) => w.id === 'stat-prasymai')).toBe(true);
    });

    it('veikia ir org specialistui (ADR-005 scope filtrai netrukdo)', async () => {
      const result = (await broker.call('ai.dashboard', {}, { meta: { user: mockOrgUser() } })) as {
        spec: { widgets: unknown[] };
      };
      expect(result.spec.widgets.length).toBeGreaterThan(0);
    });

    it('be user meta — 401', async () => {
      await expect(broker.call('ai.dashboard', {}, { meta: {} })).rejects.toMatchObject({
        code: 401,
      });
    });

    it('default spec turi dataRef widgetus (gyvi duomenys, ne snapshot)', async () => {
      const result = (await broker.call(
        'ai.dashboard',
        {},
        { meta: { user: mockAuthUser() } },
      )) as {
        spec: { widgets: Array<{ type: string; dataRef?: { source: string } }> };
      };
      // Bent stat + sankey + treemap turi dataRef.
      expect(result.spec.widgets.every((w) => w.dataRef?.source)).toBe(true);
      expect(result.spec.widgets.some((w) => w.type === 'sankey')).toBe(true);
      expect(result.spec.widgets.some((w) => w.type === 'treemap')).toBe(true);
    });
  });

  describe('ai.hydrate', () => {
    it('užpildo dataRef widget šviežiais DB duomenimis', async () => {
      const result = (await broker.call(
        'ai.hydrate',
        {
          spec: {
            widgets: [
              {
                id: 'm',
                type: 'stat',
                title: 'Prašymai',
                dataRef: { source: 'metric', params: { metric: 'prasymu_skaicius' } },
              },
            ],
          },
        },
        { meta: { user: mockAuthUser() } },
      )) as { spec: { widgets: Array<{ value?: string }> }; generatedAt: string };
      expect(result.generatedAt).toBeTruthy();
      expect(result.spec.widgets[0]?.value).toBeDefined();
    });

    it('nežinomas šaltinis — widget paliekamas (be crash)', async () => {
      const result = (await broker.call(
        'ai.hydrate',
        {
          spec: {
            widgets: [{ id: 's', type: 'stat', value: '42', dataRef: { source: 'nera_tokio' } }],
          },
        },
        { meta: { user: mockAuthUser() } },
      )) as { spec: { widgets: Array<{ value?: string }> } };
      expect(result.spec.widgets[0]?.value).toBe('42');
    });

    it('netinkamas spec — 422', async () => {
      await expect(
        broker.call('ai.hydrate', { spec: { widgets: [] } }, { meta: { user: mockAuthUser() } }),
      ).rejects.toMatchObject({ type: 'AI_BAD_SPEC' });
    });

    it('be user — 401', async () => {
      await expect(
        broker.call(
          'ai.hydrate',
          { spec: { widgets: [{ id: 'x', type: 'stat', value: '1' }] } },
          { meta: {} },
        ),
      ).rejects.toMatchObject({ code: 401 });
    });
  });

  describe('ai.chat', () => {
    function collectSse(stream: PassThrough): Promise<Array<Record<string, unknown>>> {
      return new Promise((resolve, reject) => {
        let buffer = '';
        stream.on('data', (chunk: Buffer) => {
          buffer += chunk.toString('utf8');
        });
        stream.on('end', () => {
          const events = buffer
            .split('\n\n')
            .filter((c) => c.startsWith('data: '))
            .map((c) => JSON.parse(c.slice(6)) as Record<string, unknown>);
          resolve(events);
        });
        stream.on('error', reject);
      });
    }

    it('be LLM_BASE_URL — 503 AI_NOT_CONFIGURED', async () => {
      delete process.env.LLM_BASE_URL;
      await expect(
        broker.call(
          'ai.chat',
          { messages: [{ role: 'user', content: 'labas' }] },
          { meta: { user: mockAuthUser() } },
        ),
      ).rejects.toMatchObject({ type: 'AI_NOT_CONFIGURED' });
    });

    it('pilnas ciklas su mock LLM: tool call → spec event → reply → done', async () => {
      process.env.LLM_BASE_URL = 'http://llm-mock.test/v1';

      const llmResponses = [
        // 1: modelis kviečia render_dashboard
        {
          choices: [
            {
              finish_reason: 'tool_calls',
              message: {
                role: 'assistant',
                content: null,
                tool_calls: [
                  {
                    id: 'call-1',
                    type: 'function',
                    function: {
                      name: 'render_dashboard',
                      arguments: JSON.stringify({
                        title: 'Naujas vaizdas',
                        widgets: [{ id: 'w1', type: 'stat', title: 'X', value: '42 €' }],
                      }),
                    },
                  },
                ],
              },
            },
          ],
        },
        // 2: galutinis tekstas
        {
          choices: [
            {
              finish_reason: 'stop',
              message: { role: 'assistant', content: 'Atnaujinau vaizdą — rodau X.' },
            },
          ],
        },
      ];
      let callCount = 0;
      const fetchMock = jest.fn(async () => {
        const body = llmResponses[Math.min(callCount, llmResponses.length - 1)];
        callCount += 1;
        return {
          ok: true,
          status: 200,
          json: async () => body,
          text: async () => JSON.stringify(body),
        } as unknown as Response;
      });
      global.fetch = fetchMock as unknown as typeof fetch;

      const stream = (await broker.call(
        'ai.chat',
        {
          messages: [{ role: 'user', content: 'Rodyk tik X' }],
          spec: { widgets: [{ id: 'old', type: 'stat', value: '1' }] },
        },
        { meta: { user: mockAuthUser() } },
      )) as PassThrough;

      const events = await collectSse(stream);
      const types = events.map((e) => e.type);

      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(types).toContain('status');
      expect(types).toContain('spec');
      expect(types).toContain('reply');
      expect(types[types.length - 1]).toBe('done');

      const specEvent = events.find((e) => e.type === 'spec') as {
        spec: { title?: string; widgets: Array<{ id: string }> };
      };
      expect(specEvent.spec.title).toBe('Naujas vaizdas');
      expect(specEvent.spec.widgets[0]?.id).toBe('w1');

      const replyEvent = events.find((e) => e.type === 'reply') as { text: string };
      expect(replyEvent.text).toContain('Atnaujinau');

      // Sisteminis promptas perduotas su dabartiniu spec'u + user kontekstu.
      const firstCallBody = JSON.parse(
        (fetchMock.mock.calls[0] as unknown as [string, { body: string }])[1].body,
      ) as { messages: Array<{ role: string; content: string }> };
      expect(firstCallBody.messages[0]?.role).toBe('system');
      expect(firstCallBody.messages[0]?.content).toContain('Test AM Admin');
      expect(firstCallBody.messages[0]?.content).toContain('"old"');
    });

    it('LLM klaida → error event + done (stream`as neužstringa)', async () => {
      process.env.LLM_BASE_URL = 'http://llm-mock.test/v1';
      global.fetch = jest.fn(async () => {
        throw new Error('connection refused');
      }) as unknown as typeof fetch;

      const stream = (await broker.call(
        'ai.chat',
        { messages: [{ role: 'user', content: 'labas' }] },
        { meta: { user: mockAuthUser() } },
      )) as PassThrough;

      const events = await collectSse(stream);
      const types = events.map((e) => e.type);
      expect(types).toContain('error');
      expect(types[types.length - 1]).toBe('done');
    });

    it('spec atsakymo tekste (be tool call) išgelbėjamas į dashboard', async () => {
      process.env.LLM_BASE_URL = 'http://llm-mock.test/v1';
      const specInText = JSON.stringify({
        title: 'Tekste paskendęs vaizdas',
        widgets: [{ id: 'r1', type: 'stat', title: 'X', value: '7 €' }],
      });
      global.fetch = jest.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          choices: [
            {
              finish_reason: 'stop',
              message: {
                role: 'assistant',
                content: `Štai jūsų dashboard:\n\`\`\`json\n${specInText}\n\`\`\`\nViskas atnaujinta.`,
              },
            },
          ],
        }),
        text: async () => '',
      })) as unknown as typeof fetch;

      const stream = (await broker.call(
        'ai.chat',
        { messages: [{ role: 'user', content: 'perpiešk' }] },
        { meta: { user: mockAuthUser() } },
      )) as PassThrough;

      const events = await collectSse(stream);
      const specEvent = events.find((e) => e.type === 'spec') as
        | { spec: { title?: string; widgets: Array<{ id: string }> } }
        | undefined;
      expect(specEvent).toBeDefined();
      expect(specEvent?.spec.title).toBe('Tekste paskendęs vaizdas');
      const replyEvent = events.find((e) => e.type === 'reply') as { text: string };
      // Tekste nebėra JSON'o — tik žmogiška dalis.
      expect(replyEvent.text).not.toContain('"widgets"');
      expect(replyEvent.text).toContain('Štai jūsų dashboard');
    });

    it('nukirstas spec tekste — verčia perdaryti per tool, žalio JSON vartotojas nemato', async () => {
      process.env.LLM_BASE_URL = 'http://llm-mock.test/v1';
      // 1: modelis įmeta NUKIRSTĄ (neparsinamą) JSON į tekstą.
      // 2: po korekcijos — teisingas render_dashboard tool call.
      let call = 0;
      const fetchMock = jest.fn(async () => {
        call += 1;
        let body: unknown;
        if (call === 1) {
          body = {
            choices: [
              {
                finish_reason: 'length',
                message: {
                  role: 'assistant',
                  content:
                    'Štai vaizdas:\n```json\n{"title":"X","widgets":[{"id":"w1","type":"stat","title":"Biudžetas","dataRef":{"source":"metric","params":{"metric":"biudzeto', // nukirsta
                },
              },
            ],
          };
        } else if (call === 2) {
          body = {
            choices: [
              {
                finish_reason: 'tool_calls',
                message: {
                  role: 'assistant',
                  content: null,
                  tool_calls: [
                    {
                      id: 'c1',
                      type: 'function',
                      function: {
                        name: 'render_dashboard',
                        arguments: JSON.stringify({
                          widgets: [
                            {
                              id: 'w1',
                              type: 'stat',
                              title: 'Biudžetas',
                              dataRef: { source: 'metric', params: { metric: 'prasymu_skaicius' } },
                            },
                          ],
                        }),
                      },
                    },
                  ],
                },
              },
            ],
          };
        } else {
          body = {
            choices: [
              {
                finish_reason: 'stop',
                message: { role: 'assistant', content: 'Atnaujinau vaizdą.' },
              },
            ],
          };
        }
        return {
          ok: true,
          status: 200,
          json: async () => body,
          text: async () => '',
        } as unknown as Response;
      });
      global.fetch = fetchMock as unknown as typeof fetch;

      const stream = (await broker.call(
        'ai.chat',
        { messages: [{ role: 'user', content: 'perpiešk' }] },
        { meta: { user: mockAuthUser() } },
      )) as PassThrough;

      const events = await collectSse(stream);
      // Pirmas (nukirstas) JSON NEturi tapti reply su žaliu JSON.
      const replies = events.filter((e) => e.type === 'reply') as Array<{ text: string }>;
      for (const r of replies) expect(r.text).not.toContain('"widgets"');
      // Po korekcijos modelis iškvietė render_dashboard → spec event yra.
      expect(events.some((e) => e.type === 'spec')).toBe(true);
      // Bent korekcijos retry įvyko (≥ 2 LLM kvietimai).
      expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(2);
    });

    /**
     * REGRESIJA (review 2026-06-12, critical): duomenų tool'ai NETURI paveldėti
     * Moleculer distributed timeout iš request konteksto. Su `ctx.call` po
     * `requestTimeout` (prod 10s) visi tool call'ai mirtų RequestSkippedError —
     * todėl naudojam `broker.call` su nauju root kontekstu (žr. callAction).
     *
     * Testas: brokeris su requestTimeout=300ms, mock LLM pirmame žingsnyje
     * "galvoja" 500ms (ilgiau už requestTimeout) ir tada kviečia duomenų tool'ą.
     * Tool'as privalo pavykti — tool result'e turi būti realūs duomenys, ne
     * "Nepavyko gauti duomenų".
     */
    it('duomenų tool veikia ir po broker requestTimeout (distributed timeout nepaveldimas)', async () => {
      process.env.LLM_BASE_URL = 'http://llm-mock.test/v1';

      const { ServiceBroker } = await import('moleculer');
      const aiService = (await import('../../src/services/ai.service')).default;
      const slowBroker = new ServiceBroker({
        namespace: 'finansai-test-timeout',
        nodeID: `test-timeout-${process.pid}`,
        logger: false,
        transporter: null,
        requestTimeout: 300,
      });
      slowBroker.createService(aiService);
      // Stub dashboard servisas — tikrinam tik timeout mechaniką, ne duomenis.
      slowBroker.createService({
        name: 'dashboard',
        actions: {
          get: {
            handler: () => ({
              year: 2026,
              stats: {
                totalRequests: 7,
                byStatus: {
                  DRAFT: 0,
                  SUBMITTED: 0,
                  RETURNED: 0,
                  APPROVED: 7,
                  REJECTED: 0,
                  NEAKTUALU: 0,
                },
                amountsByStatus: { SUBMITTED: 0, RETURNED: 0, APPROVED: 0, REJECTED: 0 },
                totalRequestedThisYear: 0,
                totalApprovedThisYear: 0,
                totalRejectedThisYear: 0,
                usersCount: 1,
              },
              monthlyTrend: [],
              costCategories: [],
              budgetCategoryStats: [],
            }),
          },
        },
      });
      await slowBroker.start();

      const fetchBodies: string[] = [];
      let call = 0;
      global.fetch = jest.fn(async (_url: unknown, init?: { body?: string }) => {
        fetchBodies.push(String(init?.body ?? ''));
        call += 1;
        const body =
          call === 1
            ? // Pirmas žingsnis: "galvojam" ilgiau už requestTimeout, tada tool call.
              await new Promise((resolve) =>
                setTimeout(
                  () =>
                    resolve({
                      choices: [
                        {
                          finish_reason: 'tool_calls',
                          message: {
                            role: 'assistant',
                            content: null,
                            tool_calls: [
                              {
                                id: 'tc-1',
                                type: 'function',
                                function: {
                                  name: 'query_data',
                                  arguments: '{"source":"requests_by_status"}',
                                },
                              },
                            ],
                          },
                        },
                      ],
                    }),
                  500,
                ),
              )
            : {
                choices: [
                  { finish_reason: 'stop', message: { role: 'assistant', content: 'Baigta.' } },
                ],
              };
        return {
          ok: true,
          status: 200,
          json: async () => body,
          text: async () => '',
        } as unknown as Response;
      }) as unknown as typeof fetch;

      try {
        const stream = (await slowBroker.call(
          'ai.chat',
          { messages: [{ role: 'user', content: 'statistika' }] },
          { meta: { user: mockAuthUser() } },
        )) as PassThrough;
        const events = await collectSse(stream);
        expect(events.some((e) => e.type === 'reply')).toBe(true);

        // Antro LLM kvietimo body turi tool result'ą — jis turi būti SU duomenimis.
        const secondBody = JSON.parse(fetchBodies[1] ?? '{}') as {
          messages: Array<{ role: string; content: string }>;
        };
        const toolMsg = secondBody.messages.find((m) => m.role === 'tool');
        expect(toolMsg).toBeDefined();
        expect(toolMsg?.content).toContain('"kiekis":7');
        expect(toolMsg?.content).not.toContain('Nepavyko gauti duomenų');
      } finally {
        await slowBroker.stop();
      }
    });
  });
});
