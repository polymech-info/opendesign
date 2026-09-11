/** Drop inherited NODE_DEBUG so `http` / undici don't spam the CLI. */
if (!process.env.OPEND_DEBUG) {
  delete process.env.NODE_DEBUG;
  delete process.env.NODE_DEBUG_NATIVE;
}
