import { handleRequest } from "./core.js";
import docsHtml from "./docs.html";

export default {
  async fetch (request, env) {
    const url = new URL(request.url);
    const method = request.method;
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
    });  }
};
