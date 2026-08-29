export function createSiemBackgroundFetch(runtime = browser.runtime) {
  return async (url, options = {}) => {
    const target = new URL(url);
    const response = await runtime.sendMessage({
      type: "siem:api",
      path: `${target.pathname}${target.search}`,
      method: options.method ?? "GET",
      body: options.body,
    });
    if (!response?.ok) {
      const error = new Error(response?.error ?? "SIEM background request failed");
      error.code = response?.errorCode;
      throw error;
    }
    return new Response(response.response.status === 204 ? null : response.response.bodyText, {
      status: response.response.status,
      statusText: response.response.statusText,
      headers: { "Content-Type": response.response.contentType },
    });
  };
}
