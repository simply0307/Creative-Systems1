const headers = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, content-type",
  "access-control-allow-methods": "GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS",
};

const gone = JSON.stringify({
  ok: false,
  retired: true,
  error: "The legacy Operations API is retired.",
  successor: "/api/creative-os",
  mutationAuthority: "creative-os-api",
});

export default async (request) => {
  if (request?.method === "OPTIONS") return new Response(null, { status: 204, headers });
  return new Response(gone, { status: 410, headers });
};
