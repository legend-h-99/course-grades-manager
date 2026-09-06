// Disabled in production. No admin client, credentials, or account mutations.
Deno.serve(() => new Response(JSON.stringify({ message: "Test account factory is disabled." }), {
  status: 410,
  headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
}));
