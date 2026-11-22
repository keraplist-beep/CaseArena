export async function onRequest(context) {
  const target = new URL(context.request.url);
  target.protocol = "https:";
  target.hostname = "casearena-opqb.onrender.com";
  target.port = "";
  const upstreamRequest = new Request(target.toString(), context.request);
  return fetch(upstreamRequest);
}
