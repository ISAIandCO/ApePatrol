import { downloadText as download } from "@isaiandco/ape-share-core/ui/download";
export const downloadText = (content, options, downloadsApi = browser.downloads, urlApi = URL) => download(content, options, downloadsApi, urlApi);
