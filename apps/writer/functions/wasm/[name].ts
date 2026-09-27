// Serves large WebAssembly modules (the Typst compiler) from R2 on the
// writer's own origin. Keys are versioned, so responses are immutable.
interface R2ObjectBody {
  body: ReadableStream;
  httpEtag: string;
  size: number;
}
interface Env {
  WRITER_ASSETS: { get(key: string): Promise<R2ObjectBody | null> };
}
interface Context {
  params: { name?: string | string[] };
  env: Env;
  request: Request;
}

export async function onRequestGet({ params, env, request }: Context): Promise<Response> {
  const name = Array.isArray(params.name) ? params.name.join("/") : (params.name ?? "");
  if (!/^[\w.-]+\.wasm$/.test(name)) return new Response("Not found", { status: 404 });
  const object = await env.WRITER_ASSETS.get(`wasm/${name}`);
  if (!object) return new Response("Not found", { status: 404 });
  if (request.headers.get("If-None-Match") === object.httpEtag) {
    return new Response(null, { status: 304, headers: { ETag: object.httpEtag } });
  }
  return new Response(object.body, {
    headers: {
      "Content-Type": "application/wasm",
      "Content-Length": String(object.size),
      "Cache-Control": "public, max-age=31536000, immutable",
      ETag: object.httpEtag,
    },
  });
}
