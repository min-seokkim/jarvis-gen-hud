import { expect, test, type Page } from '@playwright/test';

const VALID_BUILD_HUD =
  '<Panel title="Build status" state="info"><Steps steps={data.build.steps} /><ProgressBar label="Build progress" value={data.build.progress} state="info" showPct /></Panel>';

const REPAIRED_HUD =
  '<Panel title="Recovered build status" state="stable"><Steps steps={data.build.steps} /><ProgressBar label="Recovered progress" value={data.build.progress} state="stable" showPct /></Panel>';

test('renders build status HUD from envelope data', async ({ page }) => {
  await mockHermes(page, [
    envelope({
      say: 'Build HUD ready.',
      design: {
        data_kind: 'progress/pipeline',
        primitives: ['Steps', 'ProgressBar'],
        layout: 'pipeline steps followed by completion meter',
        why: 'Build status is a pipeline with current completion.',
      },
      data: {
        build: {
          progress: 74,
          steps: [
            { name: 'Install deps', status: 'done' },
            { name: 'Smoke test', status: 'failed' },
          ],
        },
      },
      jsx: VALID_BUILD_HUD,
    }),
  ]);
  await page.goto('/');

  await submitCommand(page, '빌드 상태 보여줘');
  await revealHudPanel(page);

  await expect(page.getByText('Build status')).toBeVisible();
  await expect(page.getByText('Build progress')).toBeVisible();
  await expect(page.getByText('74%')).toBeVisible();
  await expect(page.getByText('Smoke test')).toBeVisible();

  const failedStep = page.locator('.hud-steps .is-failed');
  await expect(failedStep).toContainText('Smoke test');
  await expect(failedStep).toHaveCSS('color', 'rgb(239, 68, 68)');
});

test('renders an invented project HUD from agent-supplied data', async ({
  page,
}) => {
  await mockHermes(page, [
    envelope({
      say: 'Project status ready.',
      design: {
        data_kind: 'status/overview',
        primitives: ['StatusPanel', 'ProgressBar', 'KeyValue', 'Steps'],
        layout: 'branch status, readiness meter, facts, and worktree steps',
        why: 'Repository status mixes one headline state with progress and evidence.',
      },
      data: {
        branch: 'feature/hud-invention',
        progress: 64,
        state: 'caution',
        summaryItems: [
          { k: 'branch', v: 'feature/hud-invention' },
          { k: 'changed', v: '5' },
        ],
        steps: [
          { name: 'Read git status', status: 'done' },
          { name: 'Working tree has changes', status: 'active' },
        ],
      },
      jsx: '<Panel title="Invented project HUD" state={data.state}><StatusPanel label="Branch" value={data.branch} state={data.state} /><ProgressBar label="Readiness" value={data.progress} state={data.state} showPct /><KeyValue items={data.summaryItems} /><Steps steps={data.steps} /></Panel>',
    }),
  ]);
  await page.goto('/');

  await submitCommand(page, '이 프로젝트 상태 보여줘');
  await revealHudPanel(page);

  await expect(page.getByText('Invented project HUD')).toBeVisible();
  await expect(page.locator('.hud-status-value')).toContainText(
    'feature/hud-invention',
  );
  await expect(page.getByText('64%')).toBeVisible();
  await expect(page.getByText('Working tree has changes')).toBeVisible();
});

test('uses named Responses conversations without resending transcript', async ({
  page,
}) => {
  const requests: Array<{
    body: Record<string, unknown>;
    sessionKey?: string;
  }> = [];
  await page.route('**/v1/responses', async (route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    requests.push({
      body,
      sessionKey: route.request().headers()['x-hermes-session-key'],
    });
    const input = String(body.input ?? '');
    const say = input.includes('방금')
      ? '방금 실행한 도구 결과 기준으로는 E: 볼륨이 제일 찼습니다.'
      : '디스크 사용량을 확인했습니다. E: 볼륨이 가장 높습니다.';
    await route.fulfill(
      responseSse(envelope({ say, design: null, data: {}, jsx: null })),
    );
  });
  await page.goto('/');

  await submitCommand(page, '디스크 사용량 봐줘');
  await revealChatPanel(page);
  await expect(page.getByText(/E: 볼륨이 가장 높습니다/)).toBeVisible();

  const firstConversation = requests[0].body.conversation;
  expect(requests[0].body.input).toBe('디스크 사용량 봐줘');
  expect(requests[0].body.messages).toBeUndefined();
  expect(String(requests[0].body.instructions)).toContain('project root');
  expect(String(requests[0].body.instructions)).toContain('term_project');
  expect(requests[0].sessionKey).toBe('jarvis:main');
  expect(typeof firstConversation).toBe('string');
  expect(requests).toHaveLength(1);

  await page.reload();
  await revealChatPanel(page);
  await expect(page.getByText(/E: 볼륨이 가장 높습니다/)).toBeVisible();
  await submitCommand(page, '방금 어느 볼륨이 제일 찼었지?');
  await revealChatPanel(page);
  await expect(page.getByText(/E: 볼륨이 제일 찼습니다/)).toBeVisible();

  expect(requests[1].body.input).toBe('방금 어느 볼륨이 제일 찼었지?');
  expect(requests[1].body.messages).toBeUndefined();
  expect(requests[1].body.conversation).toBe(firstConversation);

  await page.getByRole('button', { name: '새 대화' }).click();
  await submitCommand(page, '방금 뭐 실행했지?');

  expect(requests[2].body.input).toBe('방금 뭐 실행했지?');
  expect(requests[2].body.messages).toBeUndefined();
  expect(requests[2].body.conversation).not.toBe(firstConversation);
  expect(requests[2].sessionKey).toBe('jarvis:main');
});

test('does not leak HUD envelope JSON into the chat panel', async ({
  page,
}) => {
  await page.route('**/v1/responses', async (route) => {
    await route.fulfill(
      responseSse(
        chunkString(
          envelope({
            say: '의존성은 총 23개입니다.',
            design: {
              data_kind: 'breakdown/composition',
              primitives: ['PieChart', 'Stat'],
              layout: 'composition',
              why: 'test envelope',
            },
            data: {
              total: 23,
              slices: [
                { label: 'prod', value: 3 },
                { label: 'dev', value: 20 },
              ],
            },
            jsx: '<Panel title="Packages" state="info"><PieChart slices={data.slices} label="Dependency mix" state="info" /><Stat label="Total" value={data.total} state="info" /></Panel>',
          }),
          9,
        ),
      ),
    );
  });
  await page.goto('/');

  await submitCommand(page, '의존성 개수 보여줘');
  await revealChatPanel(page);

  await expect(page.getByText('의존성은 총 23개입니다.')).toBeVisible();
  await expect(page.getByText(/"jsx"/)).toHaveCount(0);
  await expect(page.getByText(/<Panel/)).toHaveCount(0);
});

test('updates rendered HUD data from live WebSocket without regenerating JSX', async ({
  page,
}) => {
  const responseRequests: Array<Record<string, unknown>> = [];
  await page.route('**/v1/responses', async (route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    responseRequests.push(body);
    await route.fulfill(
      responseSse(
        envelope({
          say: 'Live build HUD ready.',
          design: {
            data_kind: 'progress/pipeline',
            primitives: ['Steps', 'ProgressBar'],
            layout: 'live build progress',
            why: 'Build progress changes over time.',
          },
          live: {
            source: 'build_sim',
            params: { stepSeconds: 1 },
            intervalMs: 1000,
          },
          data: {
            progress: 0,
            state: 'info',
            steps: [
              { name: 'Install deps', status: 'active' },
              { name: 'Typecheck', status: 'pending' },
            ],
          },
          jsx: '<Panel title="Live Build" state={data.state}><Steps steps={data.steps} /><ProgressBar label="Build progress" value={data.progress} state={data.state} showPct /></Panel>',
        }),
      ),
    );
  });

  const subscriptions: string[] = [];
  await page.routeWebSocket('/ws', (ws) => {
    ws.onMessage((message) => {
      const payload = JSON.parse(String(message)) as { subId: string };
      subscriptions.push(String(payload.subId));
      ws.send(
        JSON.stringify({
          type: 'hud.data',
          subId: payload.subId,
          data: {
            progress: 50,
            state: 'info',
            steps: [
              { name: 'Install deps', status: 'done' },
              { name: 'Typecheck', status: 'active' },
            ],
          },
        }),
      );
    });
  });

  await page.goto('/');
  await submitCommand(page, '빌드 상태 보여줘');
  await revealHudPanel(page);

  await expect(hudPreview(page).getByText('Live Build')).toBeVisible();
  await expect(page.getByText('50%')).toBeVisible();
  await expect(page.getByText('Typecheck')).toBeVisible();
  expect(subscriptions).toHaveLength(1);
  expect(responseRequests).toHaveLength(1);

  await page.reload();
  await revealHudPanel(page);

  await expect(hudPreview(page).getByText('Live Build')).toBeVisible();
  await expect(page.getByText('50%')).toBeVisible();
  expect(subscriptions).toHaveLength(2);
  expect(responseRequests).toHaveLength(1);
});

test('renders disk usage as a pie-style HUD, not a flat table', async ({
  page,
}) => {
  await mockHermes(page, [
    envelope({
      say: 'Disk usage ready.',
      design: {
        data_kind: 'breakdown/composition',
        primitives: ['PieChart', 'ProgressBar', 'KeyValue'],
        layout: 'composition graphic with usage meter and supporting facts',
        why: 'Used versus free capacity is a composition, not a plain table.',
      },
      data: {
        usePct: 14,
        slices: [
          { label: 'Used', value: 14, state: 'caution' },
          { label: 'Free', value: 86, state: 'stable' },
        ],
        summaryItems: [
          { k: 'drive', v: 'E:' },
          { k: 'used', v: '257G' },
          { k: 'free', v: '1.6T' },
        ],
      },
      jsx: '<Panel title="Disk Usage" state="stable"><PieChart slices={data.slices} label="E: drive" state="stable" /><ProgressBar value={data.usePct} label="Used" state="stable" showPct /><KeyValue items={data.summaryItems} /></Panel>',
    }),
  ]);
  await page.goto('/');

  await submitCommand(page, '디스크 사용량 보여줘');
  await revealHudPanel(page);

  await expect(hudPreview(page).getByText('Disk Usage')).toBeVisible();
  await expect(page.getByText('E: drive')).toBeVisible();
  await expect(page.locator('.hud-pie-legend')).toContainText('Used');
  await expect(page.locator('.hud-pie-legend')).toContainText('Free');
  await expect(page.locator('.hud-pie-legend')).toContainText('14%');
  await expect(page.locator('.hud-pie-segment')).toHaveCount(2);
});

test('does not render HUD when envelope returns jsx null', async ({ page }) => {
  await mockHermes(page, [
    envelope({
      say: 'No visual surface needed.',
      design: null,
      data: { reason: 'small talk' },
      jsx: null,
    }),
  ]);
  await page.goto('/');

  await submitCommand(page, '왜 그래?');
  await revealHudPanel(page);

  await expect(page.getByTestId('hud-empty')).toBeVisible();
  await expect(page.getByTestId('hud-live-preview')).toHaveCount(0);
});

test('keeps the previous HUD when a later envelope returns jsx null', async ({
  page,
}) => {
  await mockHermes(page, [
    envelope({
      say: 'Build HUD ready.',
      design: {
        data_kind: 'progress/pipeline',
        primitives: ['Steps', 'ProgressBar'],
        layout: 'pipeline steps followed by completion meter',
        why: 'Build status is a pipeline with current completion.',
      },
      data: {
        build: {
          progress: 74,
          steps: [{ name: 'Smoke test', status: 'failed' }],
        },
      },
      jsx: VALID_BUILD_HUD,
    }),
    envelope({
      say: 'Hello.',
      design: null,
      data: { reason: 'small talk' },
      jsx: null,
    }),
  ]);
  await page.goto('/');

  await submitCommand(page, '빌드 상태 보여줘');
  await revealHudPanel(page);
  await expect(page.getByText('Build status')).toBeVisible();

  await submitCommand(page, '안녕');
  await revealHudPanel(page);

  await expect(page.getByText('Build status')).toBeVisible();
  await expect(page.getByTestId('hud-empty')).toHaveCount(0);
});

test('repairs broken JSX without crashing the app', async ({ page }) => {
  await mockHermes(page, [
    envelope({
      say: 'Broken first draft.',
      design: {
        data_kind: 'progress/pipeline',
        primitives: ['Steps'],
        layout: 'pipeline steps',
        why: 'Build failures are easiest to scan as steps.',
      },
      data: {
        build: {
          progress: 74,
          steps: [{ name: 'Smoke test', status: 'failed' }],
        },
      },
      jsx: '<Panel title="Broken" state="critical"><Steps steps={data.build.steps}></Panel>',
    }),
    envelope({
      say: 'Recovered.',
      design: {
        data_kind: 'progress/pipeline',
        primitives: ['Steps', 'ProgressBar'],
        layout: 'pipeline steps followed by completion meter',
        why: 'The repaired HUD preserves build progress and failing step.',
      },
      data: {
        build: {
          progress: 74,
          steps: [{ name: 'Smoke test', status: 'failed' }],
        },
      },
      jsx: REPAIRED_HUD,
    }),
  ]);
  await page.goto('/');

  await submitCommand(page, '빌드 상태 보여줘');
  await revealHudPanel(page);

  await expect(page.getByText('Recovered build status')).toBeVisible();
  await expect(page.getByText('Recovered progress')).toBeVisible();
  await expect(page.locator('input[type="text"]')).toBeVisible();
  await expect(page.getByTestId('hud-fallback')).toHaveCount(0);
});

test('rejects disallowed raw HTML/style and heals with allowed primitives', async ({
  page,
}) => {
  await mockHermes(page, [
    envelope({
      say: 'Bad draft.',
      design: {
        data_kind: 'status/overview',
        primitives: ['Alert'],
        layout: 'invalid draft',
        why: 'This draft intentionally violates render rules.',
      },
      data: {},
      jsx: '<div style={{ color: "red" }}>bad</div>',
    }),
    envelope({
      say: 'Recovered.',
      design: {
        data_kind: 'progress/pipeline',
        primitives: ['Steps', 'ProgressBar'],
        layout: 'pipeline steps followed by completion meter',
        why: 'The repair uses allowed HUD primitives.',
      },
      data: {
        build: {
          progress: 74,
          steps: [{ name: 'Smoke test', status: 'failed' }],
        },
      },
      jsx: REPAIRED_HUD,
    }),
  ]);
  await page.goto('/');

  await submitCommand(page, '빌드 상태 보여줘');
  await revealHudPanel(page);

  await expect(page.getByText('Recovered build status')).toBeVisible();
  await expect(page.getByText('Recovered progress')).toBeVisible();
  await expect(page.locator('div[style*="red"]')).toHaveCount(0);
});

async function submitCommand(page: Page, text: string) {
  await page.locator('input[type="text"]').fill(text);
  await page.locator('button[type="submit"]').click();
}

async function revealHudPanel(page: Page) {
  const hudTab = page.getByRole('tab', { name: 'HUD' });
  if (await hudTab.isVisible()) {
    await hudTab.click();
  }
}

async function revealChatPanel(page: Page) {
  const chatTab = page.getByRole('tab', { name: 'Chat' });
  if (await chatTab.isVisible()) {
    await chatTab.click();
  }
}

function hudPreview(page: Page) {
  return page.getByTestId('hud-live-preview');
}

async function mockHermes(page: Page, hudResponses: string[]) {
  let hudIndex = 0;
  await page.route('**/v1/chat/completions', async (route) => {
    await route.abort();
  });
  await page.route('**/v1/responses', async (route) => {
    const content =
      hudResponses[Math.min(hudIndex, hudResponses.length - 1)] ??
      envelope({
        say: 'ok',
        design: {
          data_kind: 'progress/pipeline',
          primitives: ['Steps', 'ProgressBar'],
          layout: 'pipeline fallback',
          why: 'Default mock HUD mirrors build progress.',
        },
        data: {},
        jsx: VALID_BUILD_HUD,
      });
    hudIndex += 1;
    await route.fulfill(responseSse(content));
  });
}

function envelope(value: {
  say: string;
  design: {
    data_kind: string;
    primitives: string[];
    layout: string;
    why: string;
  } | null;
  live?: object | null;
  data: object;
  jsx: string | null;
}): string {
  return JSON.stringify(value);
}

function responseSse(content: string | string[]) {
  const chunks = Array.isArray(content) ? content : [content];
  const completed = JSON.stringify({ type: 'response.completed' });
  const body: string[] = [];
  for (const chunk of chunks) {
    const payload = JSON.stringify({
      type: 'response.output_text.delta',
      delta: chunk,
    });
    body.push('event: response.output_text.delta', `data: ${payload}`, '');
  }
  body.push(
    'event: response.completed',
    `data: ${completed}`,
    '',
    'data: [DONE]',
    '',
  );
  return {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
    body: body.join('\n'),
  };
}

function chunkString(value: string, size: number): string[] {
  const chunks: string[] = [];
  for (let index = 0; index < value.length; index += size) {
    chunks.push(value.slice(index, index + size));
  }
  return chunks;
}
