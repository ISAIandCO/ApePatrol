const MAX_DOWNLOAD_BYTES = 64 * 1024 * 1024;

export async function downloadText(content, { filename, mime = "text/plain", saveAs = true } = {}, downloadsApi = browser.downloads, urlApi = URL) {
  const text = String(content ?? "");
  if (new TextEncoder().encode(text).byteLength > MAX_DOWNLOAD_BYTES) throw new TypeError("Download exceeds 64 MiB");
  const safeFilename = String(filename ?? "download.txt").replace(/[\\/:*?"<>|\u0000-\u001f]/g, "-").slice(0, 220);
  if (!safeFilename) throw new TypeError("Download filename is empty");
  const safeMime = /^[\w.+-]+\/[\w.+-]+$/.test(mime) ? mime : "text/plain";
  const url = urlApi.createObjectURL(new Blob([text], { type: `${safeMime};charset=utf-8` }));
  try {
    const id = await downloadsApi.download({ url, filename: safeFilename, saveAs });
    setTimeout(() => urlApi.revokeObjectURL(url), 60_000);
    return id;
  } catch (error) {
    urlApi.revokeObjectURL(url);
    throw error;
  }
}
