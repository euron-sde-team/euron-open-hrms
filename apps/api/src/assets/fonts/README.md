# Fonts

Inter, vendored deliberately rather than pulled from a CDN or the host OS.

**Why these files exist:** every PDF the product issues (offer, appraisal, relieving,
experience, termination, retirement, absconding and settlement letters, plus payslips) used
pdfkit's built-in Helvetica. That is a WinAnsi-encoded core font with no Indian rupee glyph,
so every `₹` printed as `¹`. A Unicode TTF has to be embedded to fix it, and it has to be in
the repo so macOS and the `node:20-bookworm` container render identically.

Inter also matches the tenant app's own UI font, so documents look like the product.

- `Inter_400Regular.ttf`, `Inter_500Medium.ttf`, `Inter_600SemiBold.ttf`, `Inter_700Bold.ttf`
- Licence: SIL Open Font License 1.1, see `OFL.txt`. Redistribution in this form is permitted.
- Source: the `@expo-google-fonts/inter` npm package (upstream: Google Fonts / rsms).

Registered once in `server/pdf/fonts.ts`. Do not reference Helvetica directly in document code.
