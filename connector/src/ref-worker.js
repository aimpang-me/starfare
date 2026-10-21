// The starfare-ref Worker (wrangler.ref.jsonc): only the reference company's Durable Object, StarfareRef (ref.js). It has no
// public routes; the starfare Worker's StarfareWorld reaches it through its STARFARE_REF binding.
export { StarfareRef } from "./ref.js";

export default {
  fetch() { return new Response("Not found", { status: 404 }); },
};
