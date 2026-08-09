/** @type {import('next').NextConfig} */
export default {
  // Keep the fixture's output noise down; the integration tests assert on served HTML, not on
  // build logs.
  typescript: { ignoreBuildErrors: true },
}
