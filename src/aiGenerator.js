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

async function callChatCompletion({ baseUrl, apiKey, model, messages, useJsonFormat = true, temperature = 0.82, timeoutMs = 75000 }) {
  const base = normalizeBaseUrl(baseUrl);
  const body = {
    model,
    messages,
    temperature
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

async function generateSingleBatch({
  baseUrl,
  apiKey,
  model,
  subjectId,
  subjectName,
  topic = '',
  count = 5,
  difficulty = 'Mixed',
  avoidQuestions = [],
  batchHint = '',
  timeoutMs = 75000
}) {
  const chosenModel = String(model || 'deepseek-v4.1-flash').trim();
  const safeCount = Math.max(1, Math.min(20, Number(count) || 5));
  const diffPrompt = difficulty === 'Mixed'
    ? 'Mix of Easy, Medium, and Hard difficulty'
    : `${difficulty} difficulty`;

  const todayKey = new Date().toLocaleDateString('en-CA');
  const lenses = [
    'real-world debugging and code output tracing',
    'edge cases, subtle syntax traps, and modern best practices',
    'practical problem solving and conceptual understanding',
    'performance, security, and clean architecture scenarios'
  ];
  const lensPick = batchHint || lenses[Math.floor(Math.random() * lenses.length)];

  const systemPrompt = [
    'You are an expert computer science instructor writing multiple-choice exam questions.',
    'Return ONLY a valid JSON object with the exact shape:',
    '{"questions":[{"question":"...","code":"optional code snippet or empty string","options":["opt A","opt B","opt C","opt D"],"correctIndex":0,"difficulty":"Easy|Medium|Hard","explanation":"brief explanation"}]}',
    'Rules:',
    '- Exactly 4 distinct options per question.',
    '- correctIndex must be an integer 0, 1, 2, or 3.',
    '- Generate completely fresh, original questions distinct from prior sets.',
    '- Verify technical accuracy carefully before returning.',
    '- Do NOT wrap JSON in markdown or include extra commentary.'
  ].join('\n');

  const avoidSnippet = avoidQuestions.length > 0
    ? ` Do NOT repeat or closely paraphrase these existing questions: ${avoidQuestions.slice(-30).map((q) => `"${String(q).slice(0, 75)}"`).join(', ')}.`
    : '';

  const userPrompt = [
    `Date: ${todayKey}. Generate ${safeCount} unique fresh MCQ questions for the subject: ${subjectName || subjectId}.`,
    topic ? `Focus on topic: ${topic}.` : `Emphasize ${lensPick}.`,
    `Difficulty: ${diffPrompt}.`,
    avoidSnippet,
    `Return exact JSON with ${safeCount} items in "questions".`
  ].filter(Boolean).join(' ');

  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt }
  ];

  let rawContent;
  try {
    rawContent = await callChatCompletion({
      baseUrl,
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
        baseUrl,
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
  return validateAndNormalizeMcqs(parsed, {
    subjectId,
    defaultDifficulty: difficulty === 'Mixed' ? 'Medium' : difficulty
  });
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
  existingQuestions = [],
  minRequired = null,
  timeoutMs = 75000
}) {
  const base = normalizeBaseUrl(baseUrl);
  if (!base || !apiKey) {
    const err = new Error('AI API Base URL and API Key must be configured in Settings.');
    err.statusCode = 400;
    throw err;
  }

  const targetCount = Math.max(1, Math.min(50, Number(count) || 5));
  const requiredFloor = Number.isFinite(Number(minRequired)) && Number(minRequired) > 0
    ? Math.min(targetCount, Number(minRequired))
    : targetCount;
  const collected = [];
  const existingSet = new Set(
    (Array.isArray(existingQuestions) ? existingQuestions : [])
      .map((q) => String(q || '').trim().toLowerCase())
      .filter(Boolean)
  );
  const seenQuestions = new Set(existingSet);

  const chunkHints = [
    'syntax rules, runtime behavior, and core API output snippets',
    'debugging tricky code bugs, async/edge cases, and common pitfalls',
    'data structures, best practices, and real-world problem solving'
  ];

  // Run parallel chunks when targetCount > 18 to keep generation fast
  if (targetCount > 18) {
    const numChunks = targetCount > 36 ? 3 : 2;
    const baseSize = Math.floor(targetCount / numChunks);
    let rem = targetCount % numChunks;
    const chunkJobs = Array.from({ length: numChunks }, (_, idx) => {
      const sz = baseSize + (rem > 0 ? 1 : 0);
      if (rem > 0) rem -= 1;
      return generateSingleBatch({
        baseUrl: base,
        apiKey,
        model,
        subjectId,
        subjectName,
        topic,
        count: Math.min(20, sz),
        difficulty,
        avoidQuestions: [...seenQuestions],
        batchHint: chunkHints[idx % chunkHints.length],
        timeoutMs
      }).catch(() => []);
    });
    const parallelBatches = await Promise.all(chunkJobs);
    for (const batch of parallelBatches) {
      for (const q of batch) {
        const key = q.question.trim().toLowerCase();
        if (!seenQuestions.has(key) && collected.length < targetCount) {
          seenQuestions.add(key);
          collected.push(q);
        }
      }
    }
  }

  let remaining = targetCount - collected.length;
  let attempts = 0;
  const maxAttempts = Math.ceil(targetCount / 18) + 2;
  while (collected.length < requiredFloor && remaining > 0 && attempts < maxAttempts) {
    attempts += 1;
    const batchSize = Math.min(18, remaining);
    const batch = await generateSingleBatch({
      baseUrl: base,
      apiKey,
      model,
      subjectId,
      subjectName,
      topic,
      count: batchSize,
      difficulty,
      avoidQuestions: [...seenQuestions],
      batchHint: chunkHints[attempts % chunkHints.length],
      timeoutMs
    });

    let addedThisRound = 0;
    for (const q of batch) {
      const key = q.question.trim().toLowerCase();
      if (!seenQuestions.has(key) && collected.length < targetCount) {
        seenQuestions.add(key);
        collected.push(q);
        addedThisRound += 1;
      }
    }
    remaining = targetCount - collected.length;
    if (addedThisRound === 0) break;
  }

  if (collected.length === 0) {
    throw new Error('AI returned no valid 4-option MCQs. Please try again.');
  }
  return collected;
}

async function generateMixedSubjectMcqs({
  baseUrl,
  apiKey,
  model,
  subjects,
  topic = '',
  count = 10,
  difficulty = 'Mixed',
  existingBySubject = {},
  timeoutMs = 75000
}) {
  const targetTotal = Math.max(1, Math.min(50, Number(count) || 10));
  const activeSubjects = subjects.slice(0, targetTotal);
  const perSubject = Math.floor(targetTotal / activeSubjects.length);
  let extra = targetTotal % activeSubjects.length;

  const jobs = activeSubjects.map((subj) => {
    const take = perSubject + (extra > 0 ? 1 : 0);
    if (extra > 0) extra -= 1;
    return generateMcqsWithAi({
      baseUrl,
      apiKey,
      model,
      subjectId: subj.id,
      subjectName: subj.fullName || subj.name,
      topic,
      count: take,
      difficulty,
      existingQuestions: existingBySubject[subj.id] || [],
      timeoutMs
    });
  });

  const results = await Promise.all(jobs);
  return results.flat();
}

module.exports = {
  normalizeBaseUrl,
  extractJsonPayload,
  validateAndNormalizeMcqs,
  fetchAvailableModels,
  generateMcqsWithAi,
  generateMixedSubjectMcqs
};
