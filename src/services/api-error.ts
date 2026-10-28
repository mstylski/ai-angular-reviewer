export function classifyApiError(error: unknown): Error {
  const value = error as { status?: number; code?: string; name?: string } | null;
  let category = 'Could not connect to the OpenAI API.';
  if (value?.status === 401 || value?.status === 403)
    category = 'OpenAI API access was denied. Check the API key and permissions.';
  else if (value?.status === 429) category = 'OpenAI API rate limit reached. Try again later.';
  else if (
    value?.name === 'AbortError' ||
    value?.code === 'ETIMEDOUT' ||
    value?.code === 'ETIMEOUT'
  )
    category = 'The OpenAI API request timed out.';
  else if (typeof value?.status === 'number' && value.status >= 500)
    category = 'The OpenAI service is temporarily unavailable.';
  return new Error(category, { cause: error });
}
