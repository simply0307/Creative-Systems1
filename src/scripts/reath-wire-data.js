const storiesFrom = (payload) => Array.isArray(payload?.stories) ? payload.stories : [];

export const withUnverifiedIntake = (query = "") => {
  const parameters = new URLSearchParams(query.startsWith("?") ? query.slice(1) : query);
  parameters.set("include_low_signal", "true");
  return `?${parameters.toString()}`;
};

export const loadDeskStories = async (api, query = "", { fallbackToUnverified = false } = {}) => {
  const requested = await api(`/api/reath/stories${query}`);
  const requestedStories = storiesFrom(requested);
  if (requestedStories.length || !fallbackToUnverified) {
    return { stories: requestedStories, query, unverifiedFallback: false };
  }

  const fallbackQuery = withUnverifiedIntake(query);
  const fallback = await api(`/api/reath/stories${fallbackQuery}`);
  return {
    stories: storiesFrom(fallback),
    query: fallbackQuery,
    unverifiedFallback: true,
  };
};
