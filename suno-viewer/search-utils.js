function normalizeSearchText(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}@]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenizeSearch(value) {
  return normalizeSearchText(value)
    .split(" ")
    .map((token) => token.trim())
    .filter(Boolean);
}

function makeSearchExcerpt(value, query, radius = 44) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  const normalizedText = normalizeSearchText(text);
  const normalizedQuery = normalizeSearchText(query);
  const queryTokens = tokenizeSearch(query);
  let lookup = normalizedQuery;
  let index = lookup ? normalizedText.indexOf(lookup) : -1;
  if (index < 0) {
    const firstToken = queryTokens.find((token) => normalizedText.includes(token));
    if (firstToken) {
      lookup = firstToken;
      index = normalizedText.indexOf(firstToken);
    }
  }
  if (index < 0) return text.slice(0, radius * 2).trim();
  const start = Math.max(0, index - radius);
  const end = Math.min(text.length, index + lookup.length + radius);
  const prefix = start > 0 ? "…" : "";
  const suffix = end < text.length ? "…" : "";
  return `${prefix}${text.slice(start, end).trim()}${suffix}`;
}

function scoreSearchField(input, rawQuery) {
  const query = normalizeSearchText(rawQuery);
  const tokens = tokenizeSearch(rawQuery);
  if (!query || tokens.length === 0) return null;

  let bestScore = 0;
  let excerptSource = "";
  let matchedTokens = [];
  let phraseMatched = false;

  for (const rawValue of input.values) {
    const value = String(rawValue || "").trim();
    if (!value) continue;
    const normalized = normalizeSearchText(value);
    if (!normalized) continue;

    let score = 0;
    if (normalized === query) {
      score = Math.max(score, input.exactScore);
      phraseMatched = true;
    } else if (normalized.startsWith(query)) {
      score = Math.max(score, input.startsWithScore);
      phraseMatched = true;
    } else if (normalized.includes(query)) {
      score = Math.max(score, input.containsScore);
      phraseMatched = true;
    }

    const localMatchedTokens = tokens.filter((token) => normalized.includes(token));
    if (localMatchedTokens.length > 0) {
      score += localMatchedTokens.length * input.tokenScore;
      score += localMatchedTokens.filter((token) => normalized.startsWith(token)).length * input.tokenPrefixScore;
      if (tokens.length > 1 && localMatchedTokens.length === tokens.length) {
        score += input.allTokensBonus || 0;
      }
    }

    if (score > bestScore) {
      bestScore = score;
      excerptSource = value;
      matchedTokens = localMatchedTokens;
    }
  }

  if (bestScore <= 0) return null;

  return {
    label: input.label,
    score: bestScore,
    excerptSource,
    excerptPriority: input.excerptPriority || 0,
    matchedTokens,
    phraseMatched,
  };
}

function getSearchMatchSummary(document, rawQuery) {
  const query = normalizeSearchText(rawQuery);
  const tokens = tokenizeSearch(rawQuery);
  if (!query || tokens.length === 0) return null;

  const fieldInputs = [
    {
      label: "Title",
      values: [document.title || ""],
      excerptPriority: 5,
      containsScore: 760,
      startsWithScore: 900,
      exactScore: 1100,
      tokenScore: 54,
      tokenPrefixScore: 24,
      allTokensBonus: 120,
    },
    {
      label: "Account",
      values: document.account || [],
      excerptPriority: 2,
      containsScore: 680,
      startsWithScore: 820,
      exactScore: 980,
      tokenScore: 46,
      tokenPrefixScore: 20,
      allTokensBonus: 96,
    },
    {
      label: "Style",
      values: document.styles || [],
      excerptPriority: 3,
      containsScore: 420,
      startsWithScore: 520,
      exactScore: 680,
      tokenScore: 28,
      tokenPrefixScore: 12,
      allTokensBonus: 48,
    },
    {
      label: "Tags",
      values: document.tags || [],
      excerptPriority: 3,
      containsScore: 360,
      startsWithScore: 460,
      exactScore: 620,
      tokenScore: 24,
      tokenPrefixScore: 10,
      allTokensBonus: 42,
    },
    {
      label: "Lyrics",
      values: document.lyrics ? [document.lyrics] : [],
      excerptPriority: 4,
      containsScore: 220,
      startsWithScore: 280,
      exactScore: 360,
      tokenScore: 16,
      tokenPrefixScore: 6,
      allTokensBonus: 36,
    },
  ];

  const matches = fieldInputs
    .map((field) => scoreSearchField(field, rawQuery))
    .filter(Boolean);

  if (matches.length === 0) return null;

  const matchedTokens = new Set(matches.flatMap((field) => field.matchedTokens));
  const phraseMatched = matches.some((field) => field.phraseMatched);
  if (tokens.length > 1 && !phraseMatched && matchedTokens.size < tokens.length) {
    return null;
  }

  matches.sort((a, b) => b.score - a.score);
  const bestMatch = matches[0];
  const bestExcerptMatch = [...matches].sort((a, b) => {
    if (b.matchedTokens.length !== a.matchedTokens.length) return b.matchedTokens.length - a.matchedTokens.length;
    if (a.phraseMatched !== b.phraseMatched) return Number(b.phraseMatched) - Number(a.phraseMatched);
    if (b.excerptPriority !== a.excerptPriority) return b.excerptPriority - a.excerptPriority;
    return b.score - a.score;
  })[0];
  const fieldCoverageBonus = Math.max(0, matches.length - 1) * 18;
  const tokenCoverageBonus =
    tokens.length > 1 && matchedTokens.size === tokens.length
      ? 60 + Math.max(0, matchedTokens.size - 2) * 10
      : 0;

  return {
    fields: matches.map((field) => field.label),
    excerpt: makeSearchExcerpt(bestExcerptMatch.excerptSource, rawQuery),
    score: bestMatch.score + fieldCoverageBonus + tokenCoverageBonus,
  };
}

module.exports = {
  getSearchMatchSummary,
};
