/**
 * OpenAI-compatible AI MCQ Generator for CodeAura Exam Portal.
 * Supports custom Base URLs (e.g. Cent-AI, OpenAI, OpenRouter) without storing keys in source code.
 */

function normalizeBaseUrl(rawUrl) {
  let url = String(rawUrl || '').trim().replace(/\/+$/, '');
  if (!url) return '';
  if (!/^https?:\/\//i.test(url)) {
    url = `https://${url}`;
  }
  return url;
}

function extractJsonPayload(text) {
  const cleaned = String(text || '')
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  try {
    return JSON.parse(cleaned);
  } catch {
    // Fallback: locate outermost JSON object or array
    const objStart = cleaned.indexOf('{');
    const objEnd = cleaned.lastIndexOf('}');
    if (objStart !== -1 && objEnd > objStart) {
      return JSON.parse(cleaned.slice(objStart, objEnd + 1));
    }
    const arrStart = cleaned.indexOf('[');
    const arrEnd = cleaned.lastIndexOf(']');
    if (arrStart !== -1 && arrEnd > arrStart) {
      return JSON.parse(cleaned.slice(arrStart, arrEnd + 1));
    }
    throw new Error('AI response did not contain valid JSON.');
  }
}

function validateAndNormalizeMcqs(parsed, { subjectId, defaultDifficulty }) {
  const list = Array.isArray(parsed)
    ? parsed
    : (Array.isArray(parsed?.questions) ? parsed.questions : []);

  const allowedDiff = ['Easy', 'Medium', 'Hard'];
  const fallbackDiff = allowedDiff.includes(defaultDifficulty) ? defaultDifficulty : 'Medium';
  const valid = [];

  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const question = String(item.question || '').trim();
    const options = Array.isArray(item.options)
      ? item.options.slice(0, 4).map((o) => String(o ?? '').trim())
      : [];
    const correctIndex = Number(item.correctIndex);

    if (!question || options.length !== 4 || options.some((o) => !o)) continue;
    if (!Number.isInteger(correctIndex) || correctIndex < 0 || correctIndex > 3) continue;

    const difficulty = allowedDiff.includes(item.difficulty) ? item.difficulty : fallbackDiff;
    valid.push({
      subjectId,
      difficulty,
      question,
      code: String(item.code || '').trim(),
      options,
      correctIndex,
      explanation: String(item.explanation || '').trim()
    });
  }

  return valid;
}

async function fetchAvailableModels({ baseUrl, apiKey, timeoutMs = 15000 }) {
  const base = normalizeBaseUrl(baseUrl);
  if (!base || !apiKey) {
    throw new Error('AI Base URL and API Key are required.');
  }

  const res = await fetch(`${base}/models`, {
    headers: {
      Authorization: `Bearer ${apiKey}`
    },
    signal: AbortSignal.timeout(timeoutMs)
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Models endpoint returned ${res.status}: ${errText.slice(0, 200)}`);
  }

  const json = await res.json();
  const rows = Array.isArray(json?.data) ? json.data : [];
  return rows
    .filter((m) => m && m.id && !String(m.id).includes('image'))
    .map((m) => ({
      id: m.id,
      status: m.status || 'operational',
      free: Boolean(m.event?.free_today || String(m.id).endsWith(':free'))
    }));
}

async function callChatCompletion({ baseUrl, apiKey, model, messages, useJsonFormat = true, timeoutMs = 45000 }) {
  const base = normalizeBaseUrl(baseUrl);
  const body = {
    model,
    messages,
    temperature: 0.4
  };
  if (useJsonFormat) {
    body.response_format = { type: 'json_object' };
  }

  const res = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs)
  });

  const text = await res.text();
  if (!res.ok) {
    let errMsg = `AI API error (${res.status})`;
    try {
      const parsedErr = JSON.parse(text);
      if (parsedErr?.error?.message) errMsg = parsedErr.error.message;
    } catch {
      if (text && !text.trim().startsWith('<!DOCTYPE')) {
        errMsg = `${errMsg}: ${text.slice(0, 220)}`;
      }
    }
    const err = new Error(errMsg);
    err.statusCode = res.status;
    throw err;
  }

  const data = JSON.parse(text);
  const content = data?.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error('AI API returned an empty completion.');
  }
  return content;
}

async function generateMcqsWithAi({
  baseUrl,
  apiKey,
  model,
  subjectId,
  subjectName,
  topic = '',
  count = 5,
  difficulty = 'Mixed',
  timeoutMs = 55000
}) {
  const base = normalizeBaseUrl(baseUrl);
  if (!base || !apiKey) {
    const err = new Error('AI API Base URL and API Key must be configured in Settings.');
    err.statusCode = 400;
    throw err;
  }
  const chosenModel = String(model || 'deepseek-v4.1-flash').trim();
  const safeCount = Math.max(1, Math.min(30, Number(count) || 5));
  const diffPrompt = difficulty === 'Mixed'
    ? 'Mix of Easy, Medium, and Hard difficulty'
    : `${difficulty} difficulty`;

  const systemPrompt = [
    'You are an expert computer science instructor writing multiple-choice exam questions.',
    'Return ONLY a valid JSON object with the exact shape:',
    '{"questions":[{"question":"...","code":"optional code snippet or empty string","options":["opt A","opt B","opt C","opt D"],"correctIndex":0,"difficulty":"Easy|Medium|Hard","explanation":"brief explanation"}]}',
    'Rules:',
    '- Exactly 4 distinct options per question.',
    '- correctIndex must be an integer 0, 1, 2, or 3.',
    '- Verify technical accuracy carefully before returning.',
    '- Do NOT wrap JSON in markdown or include extra commentary.'
  ].join('\n');

  const userPrompt = [
    `Generate ${safeCount} unique MCQ questions for the subject: ${subjectName || subjectId}.`,
    topic ? `Focus on topic: ${topic}.` : 'Cover practical core concepts and code output questions.',
    `Difficulty: ${diffPrompt}.`,
    `Return exact JSON with ${safeCount} items in "questions".`
  ].join(' ');

  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt }
  ];

  let rawContent;
  try {
    rawContent = await callChatCompletion({
      baseUrl: base,
      apiKey,
      model: chosenModel,
      messages,
      useJsonFormat: true,
      timeoutMs
    });
  } catch (err) {
    // Some OpenAI-compatible models reject response_format; retry once without it on 400
    if (err.statusCode === 400 && /response_format/i.test(err.message)) {
      rawContent = await callChatCompletion({
        baseUrl: base,
        apiKey,
        model: chosenModel,
        messages,
        useJsonFormat: false,
        timeoutMs
      });
    } else {
      throw err;
    }
  }

  const parsed = extractJsonPayload(rawContent);
  const validated = validateAndNormalizeMcqs(parsed, {
    subjectId,
    defaultDifficulty: difficulty === 'Mixed' ? 'Medium' : difficulty
  });

  if (validated.length === 0) {
    throw new Error('AI returned no valid 4-option MCQs. Please try again.');
  }
  return validated;
}

module.exports = {
  normalizeBaseUrl,
  extractJsonPayload,
  validateAndNormalizeMcqs,
  fetchAvailableModels,
  generateMcqsWithAi
};
