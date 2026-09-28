import { handleRequest } from "./core.js";
import docsHtml from "./docs.html";

const SHELL = "/404.html";

export default {
  async fetch (request, env) {
    const url = new URL(request.url);
    const method = request.method;

    // A matching static asset is served before this code runs, so anything that
    // gets here under the site paths matched no file. That is the whole point
    // of this project: every path is the same document, and the document reads
    // the link out of the fragment, or out of the path for a qr code.
    if (!url.pathname.startsWith("/api")) {
      return env.ASSETS.fetch(new Request(new URL(SHELL, url), request));
    }

    let body = null;
    if (method === "POST") {
      body = {
        text: await request.text(),
        contentType: request.headers.get("content-type") || ""
      };
    }

    const result = handleRequest({
      method,
      url,
      body,
      accept: request.headers.get("accept") || "",
      publicUrl: (env.PUBLIC_URL || "https://zbi.baby").replace(/\/+$/, ""),
      maxUrlLength: Number(env.MAX_URL_LENGTH || 2048),
      docsHtml
    });

    return new Response(method === "HEAD" ? null : result.body, {
      status: result.status,
      headers: result.headers
    });
  }
};
