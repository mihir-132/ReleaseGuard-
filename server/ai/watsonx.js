/**
 * watsonx.ai Integration — Release Notes Generator
 *
 * Exports generateReleaseNotes(summaryContext) which calls the IBM watsonx.ai
 * text-generation API to produce a human-readable Markdown release note.
 *
 * Gracefully degrades to a deterministic fallback string when:
 *   - Required environment variables are missing
 *   - IAM token retrieval fails
 *   - The watsonx.ai API call fails
 *
 * Environment variables (all read at call time, not at module load time so
 * that tests can inject them):
 *   WATSONX_API_KEY      — IBM Cloud API key (required)
 *   WATSONX_PROJECT_ID   — watsonx.ai project ID (required)
 *   WATSONX_URL          — service endpoint (default: https://us-south.ml.cloud.ibm.com)
 *   WATSONX_MODEL_ID     — model to use (default: ibm/granite-4-h-small)
 */

const IAM_TOKEN_URL      = 'https://iam.cloud.ibm.com/identity/token';
const GENERATION_VERSION = '2023-05-29';

// ---------------------------------------------------------------------------
// Prompt builder
// ---------------------------------------------------------------------------

/**
 * Build a concise prompt from the summary context.
 * Kept intentionally brief to stay well under 500 tokens.
 *
 * @param {{ name: string, version: string, diffSummary: string,
 *           depSummary: string, migrationCount: number, readinessScore: number }} ctx
 * @returns {string}
 */
function buildPrompt(ctx) {
  const {
    name,
    version,
    diffSummary,
    depSummary,
    migrationCount,
    readinessScore,
  } = ctx;

  return `Create a factual Markdown release note from the verified release data below.

STRICT RULES:
- Use ONLY the verified facts provided below.
- Do not invent or infer anything.
- Do not describe benefits, purpose, impact, improvements, fixes, compatibility, performance, reliability, security, user experience, recommendations, optimization, future work, or readiness interpretation.
- Do not add facts that are not explicitly provided.
- Do not evaluate what the changes mean.
- Do not explain why the changes were made.
- Do not call the release ready, safe, stable, improved, or similar.
- Preserve the exact release name and version.
- Preserve all verified counts and the readiness score.
- Output only the release note.
- Keep the note between 60 and 100 words.

Use exactly this structure:

# Release Notes — <name> v<version>

## Changes
- Code changes: <diffSummary>
- Dependency changes: <depSummary>
- Database migrations: <migrationCount>

## Deployment Readiness
Deployment readiness score: <readinessScore>/100

Do not add any other sections or claims.

VERIFIED RELEASE DATA:
Name: ${name}
Version: ${version}
Code changes: ${diffSummary}
Dependency changes: ${depSummary}
Database migrations: ${migrationCount}
Deployment readiness score: ${readinessScore}/100`;
}

// ---------------------------------------------------------------------------
// IAM token fetch
// ---------------------------------------------------------------------------

/**
 * Exchange an IBM Cloud API key for a short-lived IAM bearer token.
 *
 * @param {string} apiKey
 * @returns {Promise<string>} Bearer token
 */
async function fetchIamToken(apiKey) {
  const body = new URLSearchParams({
    grant_type: 'urn:ibm:params:oauth:grant-type:apikey',
    apikey:     apiKey,
  });

  const response = await fetch(IAM_TOKEN_URL, {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:    body.toString(),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`IAM token request failed (${response.status}): ${text}`);
  }

  const data = await response.json();
  if (!data.access_token) {
    throw new Error('IAM response did not contain access_token');
  }
  return data.access_token;
}

// ---------------------------------------------------------------------------
// watsonx.ai text generation
// ---------------------------------------------------------------------------

/**
 * Call the watsonx.ai text-generation endpoint and return the generated text.
 *
 * @param {string} token       IAM bearer token
 * @param {string} url         WATSONX_URL
 * @param {string} modelId     WATSONX_MODEL_ID
 * @param {string} projectId   WATSONX_PROJECT_ID
 * @param {string} prompt      The prompt string
 * @returns {Promise<string>}  Generated Markdown text
 */
async function callGenerationApi(token, url, modelId, projectId, prompt) {
  const endpoint = `${url}/ml/v1/text/chat?version=${GENERATION_VERSION}`;

  const payload = {
    model_id: modelId,
    project_id: projectId,
    messages: [
      {
        role: 'user',
        content: prompt,
      },
    ],
    max_tokens: 400,
    temperature: 0,
  };

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`watsonx.ai chat failed (${response.status}): ${text}`);
  }

  const data = await response.json();
  const generated = data?.choices?.[0]?.message?.content;

  if (typeof generated !== 'string' || !generated.trim()) {
    throw new Error('watsonx.ai chat response contained no generated text');
  }

  return generated.trim();
}
// ---------------------------------------------------------------------------
// Fallback
// ---------------------------------------------------------------------------

/**
 * Return a deterministic fallback release-notes string when AI is unavailable.
 *
 * @param {{ name: string, version: string, readinessScore: number }} ctx
 * @returns {string}
 */
function fallbackReleaseNotes(ctx) {
  const { name, version, readinessScore } = ctx ?? {};
  return `## Release Notes — ${name ?? 'unknown'} v${version ?? 'unknown'}

> ⚠️ AI-generated release notes are unavailable. This is a fallback summary.

**Deployment Readiness Score:** ${readinessScore ?? 'N/A'}/100

Please review the full analysis report for details on code changes, dependency updates, migrations, and deployment checklist items.`;
}

function materializeReleaseNote(markdown, ctx) {
  const {
    name,
    version,
    diffSummary,
    depSummary,
    migrationCount,
    readinessScore,
  } = ctx;

  if (typeof markdown !== 'string' || !markdown.trim()) {
    throw new Error('watsonx response was empty');
  }

  const output = markdown.trim();

  // The release identity must remain present.
  if (!output.includes(String(name))) {
    throw new Error('watsonx response omitted the verified release name');
  }

  if (!output.includes(String(version))) {
    throw new Error('watsonx response omitted the verified release version');
  }

  // Only numbers already present in the verified release data are allowed.
 const verifiedNumbers = new Set([
  ...String(version).match(/\d+(?:\.\d+)*/g) ?? [],
  ...String(diffSummary).match(/\d+(?:\.\d+)*/g) ?? [],
  ...String(depSummary).match(/\d+(?:\.\d+)*/g) ?? [],
  String(migrationCount),
  String(readinessScore),
  '100',
]);

  const outputNumbers = output.match(/\d+(?:\.\d+)*/g) ?? [];

  for (const number of outputNumbers) {
    if (!verifiedNumbers.has(number)) {
      throw new Error(
        `watsonx response introduced an unverified numeric claim: ${number}`
      );
    }
  }

  return output;
}
// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Generate a Markdown release note using watsonx.ai.
 *
 * Falls back gracefully (with a console.warn) if credentials are missing or
 * if any network/API call fails.
 *
 * @param {{ name: string, version: string, diffSummary: string,
 *           depSummary: string, migrationCount: number,
 *           readinessScore: number }} summaryContext
 * @returns {Promise<string>} Markdown release note
 */
export async function generateReleaseNotes(summaryContext) {
  const apiKey    = process.env.WATSONX_API_KEY;
  const projectId = process.env.WATSONX_PROJECT_ID;
  const url       = process.env.WATSONX_URL      ?? 'https://us-south.ml.cloud.ibm.com';
  const modelId = process.env.WATSONX_MODEL_ID ?? 'ibm/granite-4-h-small';

  if (!apiKey || !projectId) {
    console.warn('[watsonx] WATSONX_API_KEY or WATSONX_PROJECT_ID is not set — using fallback release notes.');
    return fallbackReleaseNotes(summaryContext);
  }

  try {
    const token  = await fetchIamToken(apiKey);
    const prompt = buildPrompt(summaryContext);
    const generated = await callGenerationApi(
  	token,
	url,
  	modelId,
  	projectId,
  	prompt,
	);

return materializeReleaseNote(generated, summaryContext);
  } catch (err) {
    console.warn(`[watsonx] Failed to generate release notes: ${err.message} — using fallback.`);
    return fallbackReleaseNotes(summaryContext);
  }
}
