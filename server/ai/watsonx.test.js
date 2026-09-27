/**
 * Tests for server/ai/watsonx.js — watsonx.ai Release Notes Generator
 *
 * Covers:
 *   - prompt contains all required summaryContext fields
 *   - successful API response is parsed and returned as a string
 *   - missing WATSONX_API_KEY produces fallback release notes
 *   - missing WATSONX_PROJECT_ID produces fallback release notes
 *   - IAM token fetch failure produces fallback release notes
 *   - watsonx.ai generation API failure produces fallback release notes
 *   - fallback string contains name and version
 *   - default URL and model ID are used when env vars absent
 *   - custom URL and model ID are used when env vars present
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mock global fetch — injected before importing the module under test so that
// the module picks up the mocked version at runtime.
// ---------------------------------------------------------------------------

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

import { generateReleaseNotes } from './watsonx.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SUMMARY_CONTEXT = {
  name:           'payment-service',
  version:        '1.2.0',
  diffSummary:    '9 file(s) changed',
  depSummary:     '4 dependency change(s)',
  migrationCount: 2,
  readinessScore: 60,
};

/** Build a successful IAM fetch response */
function iamOkResponse(token = 'test-token-abc') {
  return {
    ok:   true,
    json: vi.fn().mockResolvedValue({ access_token: token }),
    text: vi.fn().mockResolvedValue(''),
  };
}

/** Build a successful watsonx generation response */
function generationOkResponse(
  text = `# Release Notes — payment-service v1.2.0

## Changes
- Code changes: 9 file(s) changed
- Dependency changes: 4 dependency change(s)
- Database migrations: 2

## Deployment Readiness
Deployment readiness score: 60/100`,
) {
  return {
    ok: true,
    json: vi.fn().mockResolvedValue({
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: text,
          },
          finish_reason: 'stop',
        },
      ],
    }),
    text: vi.fn().mockResolvedValue(''),
  };
}

/** Build a failed fetch response */
function errorResponse(status = 500, body = 'Internal Server Error') {
  return {
    ok:   false,
    status,
    text: vi.fn().mockResolvedValue(body),
    json: vi.fn().mockResolvedValue({}),
  };
}

// ---------------------------------------------------------------------------
// Env var management helpers
// ---------------------------------------------------------------------------

function setEnv(vars) {
  for (const [k, v] of Object.entries(vars)) {
    if (v === undefined) {
      delete process.env[k];
    } else {
      process.env[k] = v;
    }
  }
}

const DEFAULT_ENV = {
  WATSONX_API_KEY:    'test-api-key',
  WATSONX_PROJECT_ID: 'test-project-id',
  WATSONX_URL:        'https://us-south.ml.cloud.ibm.com',
  WATSONX_MODEL_ID:   'ibm/granite-4-h-small',
};

// Save and restore original env
let savedEnv;
beforeEach(() => {
  savedEnv = {
    WATSONX_API_KEY:    process.env.WATSONX_API_KEY,
    WATSONX_PROJECT_ID: process.env.WATSONX_PROJECT_ID,
    WATSONX_URL:        process.env.WATSONX_URL,
    WATSONX_MODEL_ID:   process.env.WATSONX_MODEL_ID,
  };
  setEnv(DEFAULT_ENV);
  mockFetch.mockReset();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  setEnv(savedEnv);
  console.warn.mockRestore?.();
});

// ---------------------------------------------------------------------------
// Tests — prompt content
// ---------------------------------------------------------------------------

describe('generateReleaseNotes — prompt construction', () => {
  it('the prompt sent to watsonx contains the project name', async () => {
    mockFetch
      .mockResolvedValueOnce(iamOkResponse())
      .mockResolvedValueOnce(generationOkResponse());

    await generateReleaseNotes(SUMMARY_CONTEXT);

    const generationCall = mockFetch.mock.calls[1];
    const body = JSON.parse(generationCall[1].body);
    expect(body.messages[0].content).toContain('payment-service');
  });

  it('the prompt sent to watsonx contains the version', async () => {
    mockFetch
      .mockResolvedValueOnce(iamOkResponse())
      .mockResolvedValueOnce(generationOkResponse());

    await generateReleaseNotes(SUMMARY_CONTEXT);

    const generationCall = mockFetch.mock.calls[1];
    const body = JSON.parse(generationCall[1].body);
    expect(body.messages[0].content).toContain('1.2.0');
  });

  it('the prompt sent to watsonx contains diffSummary', async () => {
    mockFetch
      .mockResolvedValueOnce(iamOkResponse())
      .mockResolvedValueOnce(generationOkResponse());

    await generateReleaseNotes(SUMMARY_CONTEXT);

    const generationCall = mockFetch.mock.calls[1];
    const body = JSON.parse(generationCall[1].body);
    expect(body.messages[0].content).toContain('9 file(s) changed');
  });

  it('the prompt sent to watsonx contains depSummary', async () => {
    mockFetch
      .mockResolvedValueOnce(iamOkResponse())
      .mockResolvedValueOnce(generationOkResponse());

    await generateReleaseNotes(SUMMARY_CONTEXT);

    const generationCall = mockFetch.mock.calls[1];
    const body = JSON.parse(generationCall[1].body);
    expect(body.messages[0].content).toContain('4 dependency change(s)');
  });

  it('the prompt sent to watsonx contains migrationCount', async () => {
    mockFetch
      .mockResolvedValueOnce(iamOkResponse())
      .mockResolvedValueOnce(generationOkResponse());

    await generateReleaseNotes(SUMMARY_CONTEXT);

    const generationCall = mockFetch.mock.calls[1];
    const body = JSON.parse(generationCall[1].body);
    expect(body.messages[0].content).toContain('2');
  });

  it('the prompt sent to watsonx contains readinessScore', async () => {
    mockFetch
      .mockResolvedValueOnce(iamOkResponse())
      .mockResolvedValueOnce(generationOkResponse());

    await generateReleaseNotes(SUMMARY_CONTEXT);

    const generationCall = mockFetch.mock.calls[1];
    const body = JSON.parse(generationCall[1].body);
    expect(body.messages[0].content).toContain('60');
  });
});

// ---------------------------------------------------------------------------
// Tests — successful response parsing
// ---------------------------------------------------------------------------

describe('generateReleaseNotes — successful response', () => {
  it('returns the generated chat message content', async () => {
  const expectedText = `# Release Notes — payment-service v1.2.0

## Changes
- Code changes: 9 file(s) changed
- Dependency changes: 4 dependency change(s)
- Database migrations: 2

## Deployment Readiness
Deployment readiness score: 60/100`;

  mockFetch
    .mockResolvedValueOnce(iamOkResponse())
    .mockResolvedValueOnce(generationOkResponse(expectedText));

  const result = await generateReleaseNotes(SUMMARY_CONTEXT);
  expect(result).toBe(expectedText);
});

it('trims whitespace from the generated text', async () => {
  const generatedText = `  # Release Notes — payment-service v1.2.0

## Changes
- Code changes: 9 file(s) changed
- Dependency changes: 4 dependency change(s)
- Database migrations: 2

## Deployment Readiness
Deployment readiness score: 60/100  `;

  const expectedText = `# Release Notes — payment-service v1.2.0

## Changes
- Code changes: 9 file(s) changed
- Dependency changes: 4 dependency change(s)
- Database migrations: 2

## Deployment Readiness
Deployment readiness score: 60/100`;

  mockFetch
    .mockResolvedValueOnce(iamOkResponse())
    .mockResolvedValueOnce(generationOkResponse(generatedText));

  const result = await generateReleaseNotes(SUMMARY_CONTEXT);
  expect(result).toBe(expectedText);
});

  it('uses the IAM token in the Authorization header', async () => {
    mockFetch
      .mockResolvedValueOnce(iamOkResponse('my-bearer-token'))
      .mockResolvedValueOnce(generationOkResponse());

    await generateReleaseNotes(SUMMARY_CONTEXT);

    const generationCall = mockFetch.mock.calls[1];
    expect(generationCall[1].headers['Authorization']).toBe('Bearer my-bearer-token');
  });

  it('uses the correct WATSONX_PROJECT_ID in the request body', async () => {
    mockFetch
      .mockResolvedValueOnce(iamOkResponse())
      .mockResolvedValueOnce(generationOkResponse());

    await generateReleaseNotes(SUMMARY_CONTEXT);

    const body = JSON.parse(mockFetch.mock.calls[1][1].body);
    expect(body.project_id).toBe('test-project-id');
  });

  it('uses the correct WATSONX_MODEL_ID in the request body', async () => {
    mockFetch
      .mockResolvedValueOnce(iamOkResponse())
      .mockResolvedValueOnce(generationOkResponse());

    await generateReleaseNotes(SUMMARY_CONTEXT);

    const body = JSON.parse(mockFetch.mock.calls[1][1].body);
    expect(body.model_id).toBe('ibm/granite-4-h-small');
  });

  it('calls the generation endpoint on the correct WATSONX_URL', async () => {
    mockFetch
      .mockResolvedValueOnce(iamOkResponse())
      .mockResolvedValueOnce(generationOkResponse());

    await generateReleaseNotes(SUMMARY_CONTEXT);

    const generationUrl = mockFetch.mock.calls[1][0];
    expect(generationUrl).toContain('https://us-south.ml.cloud.ibm.com/ml/v1/text/chat');
  });

  it('uses custom WATSONX_URL when set', async () => {
    process.env.WATSONX_URL = 'https://eu-de.ml.cloud.ibm.com';
    mockFetch
      .mockResolvedValueOnce(iamOkResponse())
      .mockResolvedValueOnce(generationOkResponse());

    await generateReleaseNotes(SUMMARY_CONTEXT);

    const generationUrl = mockFetch.mock.calls[1][0];
    expect(generationUrl).toContain('https://eu-de.ml.cloud.ibm.com/ml/v1/text/chat');
  });
});

// ---------------------------------------------------------------------------
// Tests — missing credentials → fallback
// ---------------------------------------------------------------------------

describe('generateReleaseNotes — missing credentials', () => {
  it('returns fallback when WATSONX_API_KEY is missing', async () => {
    delete process.env.WATSONX_API_KEY;
    const result = await generateReleaseNotes(SUMMARY_CONTEXT);
    expect(result).toContain('payment-service');
    expect(result).toContain('1.2.0');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('returns fallback when WATSONX_PROJECT_ID is missing', async () => {
    delete process.env.WATSONX_PROJECT_ID;
    const result = await generateReleaseNotes(SUMMARY_CONTEXT);
    expect(result).toContain('payment-service');
    expect(result).toContain('1.2.0');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('logs a warning when credentials are missing', async () => {
    delete process.env.WATSONX_API_KEY;
    await generateReleaseNotes(SUMMARY_CONTEXT);
    expect(console.warn).toHaveBeenCalled();
  });

  it('fallback string contains the readinessScore', async () => {
    delete process.env.WATSONX_API_KEY;
    const result = await generateReleaseNotes(SUMMARY_CONTEXT);
    expect(result).toContain('60');
  });
});

// ---------------------------------------------------------------------------
// Tests — API / token failure → fallback
// ---------------------------------------------------------------------------

describe('generateReleaseNotes — IAM token failure', () => {
  it('returns fallback when IAM token request fails with HTTP error', async () => {
    mockFetch.mockResolvedValueOnce(errorResponse(401, 'Unauthorized'));
    const result = await generateReleaseNotes(SUMMARY_CONTEXT);
    expect(result).toContain('payment-service');
    expect(result).toContain('1.2.0');
  });

  it('logs a warning when IAM token fetch fails', async () => {
    mockFetch.mockResolvedValueOnce(errorResponse(401, 'Unauthorized'));
    await generateReleaseNotes(SUMMARY_CONTEXT);
    expect(console.warn).toHaveBeenCalled();
  });

  it('returns fallback when IAM fetch throws a network error', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network error'));
    const result = await generateReleaseNotes(SUMMARY_CONTEXT);
    expect(result).toContain('payment-service');
  });

  it('returns fallback when IAM response has no access_token', async () => {
    mockFetch.mockResolvedValueOnce({
      ok:   true,
      json: vi.fn().mockResolvedValue({}),
      text: vi.fn().mockResolvedValue(''),
    });
    const result = await generateReleaseNotes(SUMMARY_CONTEXT);
    expect(result).toContain('payment-service');
  });
});

describe('generateReleaseNotes — generation API failure', () => {
  it('returns fallback when generation API returns an HTTP error', async () => {
    mockFetch
      .mockResolvedValueOnce(iamOkResponse())
      .mockResolvedValueOnce(errorResponse(503, 'Service Unavailable'));
    const result = await generateReleaseNotes(SUMMARY_CONTEXT);
    expect(result).toContain('payment-service');
    expect(result).toContain('1.2.0');
  });

  it('logs a warning when generation API fails', async () => {
    mockFetch
      .mockResolvedValueOnce(iamOkResponse())
      .mockResolvedValueOnce(errorResponse(503));
    await generateReleaseNotes(SUMMARY_CONTEXT);
    expect(console.warn).toHaveBeenCalled();
  });

  it('returns fallback when generation API throws a network error', async () => {
    mockFetch
      .mockResolvedValueOnce(iamOkResponse())
      .mockRejectedValueOnce(new Error('Connection reset'));
    const result = await generateReleaseNotes(SUMMARY_CONTEXT);
    expect(result).toContain('payment-service');
  });

  it('returns fallback when results array is empty', async () => {
    mockFetch
      .mockResolvedValueOnce(iamOkResponse())
      .mockResolvedValueOnce({
        ok:   true,
        json: vi.fn().mockResolvedValue({ choices: [] }),
        text: vi.fn().mockResolvedValue(''),
      });
    const result = await generateReleaseNotes(SUMMARY_CONTEXT);
    expect(result).toContain('payment-service');
  });

  it('returns fallback when generated_text is an empty string', async () => {
    mockFetch
      .mockResolvedValueOnce(iamOkResponse())
      .mockResolvedValueOnce({
        ok:   true,
        json: vi.fn().mockResolvedValue({
  	choices: [
  	  {
   	  	 message: {
       		 role: 'assistant',
       		 content: '   ',
    		  },
   		 },
  		],
	}),
        text: vi.fn().mockResolvedValue(''),
      });
    const result = await generateReleaseNotes(SUMMARY_CONTEXT);
    expect(result).toContain('payment-service');
  });
});
