# Visual design for Deckup slides

Deckup renders real HTML and CSS, and that is its core strength: you are not limited to headings and bullet lists. Design each slide like a presentation designer preparing boardroom material — clarity, narrative flow, and back-of-the-room readability — using custom markup, color panels, and large figures. A deck where most slides are title-plus-bullets wastes the medium.

Two principles govern everything in this reference:

1. **Show structure visually.** Content that has structure — parallelism, sequence, comparison, magnitude, change — should look like that structure, not like a list describing it.
2. **One design system per deck.** Every visual decision (colors, type scale, corner radii, spacing, number formatting) is made once per deck and reused everywhere. Consistency across slides matters more than any individual slide's cleverness.

## The slide canvas

- Every slide is a fixed 16:9 canvas rendered at 1600×900 for PNG and PDF. The interactive preview scales, so author sizes in container-query units: `1cqw` equals 1% of slide width (16px at render size). Use `cqw` for font sizes, padding, and gaps so preview, PNG, and PDF stay identical.
- Projection needs far larger type than the web. Minimum sizes: titles ≥ 3cqw (48px), body text ≥ 1.7cqw (~28px), captions and labels ≥ 1.5cqw (24px). If a size feels generous on a laptop screen, it is probably right; web-density text (14–16px equivalent) is a defect.
- The theme wraps content in `.deckup-slide`: a centered CSS grid with generous padding, and every direct child is capped at a `max-width` of 84–92cqw depending on the theme. In-flow content therefore sits inside a comfortable text frame automatically. Add `w-full max-w-none` (or equivalent) on a block that should use the full text frame.
- To break out of that frame for full-bleed art (color panels, section breaks, hero imagery), add an absolutely positioned wrapper: `class="absolute inset-0 max-w-none"` (or equivalent CSS). It resolves against the slide shell, so it reaches all four edges. Put the slide's own layout (flex or grid with its own padding) inside that wrapper.
- Both the slide and the shell clip overflow. Nothing scrolls; anything outside the frame is silently cut off, so verify edges in the PNG review.

## Styling tools

- Tailwind CSS v4 is enabled by default and scans deck sources, so utility classes work directly in `.mdx` and `.astro` slides. Arbitrary values accept container units: `text-[2cqw]`, `p-[4cqw]`, `gap-[1.5cqw]`, `rounded-[1cqw]`.
- In MDX, embed CSS with a JSX-wrapped style tag: `<style>{`...`}</style>`. These styles are global to the deck, not scoped to the slide — which is exactly what makes them the right home for the deck's design system (see below). Prefix class names (`.deck-card`, not `.card`) to avoid collisions with theme classes.
- In Astro decks, `<style>` is scoped per component the normal Astro way; use `is:global` only when a rule must cross slides.
- Theme CSS variables (`--deckup-text`, `--deckup-text-strong`, `--deckup-accent`, `--deckup-bg`, `--deckup-sans`, `--deckup-heading`, `--deckup-mono`) carry the active theme's palette and fonts. Build custom elements on these variables when you want custom structure that still matches the theme; use literal colors when the user asked for a specific brand or aesthetic.
- Theme text colors assume the theme background. On a dark or colored panel, set the text color explicitly on the panel and its headings — inherited theme grays will fail contrast.

## One design system per deck

This is the heart of good deck design. Slides styled one at a time drift apart — slide 3's cards end up with different radii, tints, and number sizes than slide 6's, and the deck reads as assembled rather than designed. An audience can't articulate why such a deck feels amateurish, but they feel it instantly. Prevent drift structurally, not by vigilance:

**Design once, at the deck level.** Before writing slide two, decide the deck's visual vocabulary and encode it as reusable definitions:

- Declare design tokens in a single `<style>` block on the first slide: an accent color, a muted color, a surface tint, and the type scale, as CSS custom properties (e.g. `--deck-accent`, `--deck-surface`, `--deck-num: 4.5cqw`).
- Every visual element that appears on more than one slide becomes a named class defined in that same block — not a Tailwind string re-typed per slide. Two hand-copied utility strings on different slides will diverge; one class cannot. What those elements _are_ depends on the content: a deck about metrics may need a `.deck-card` and `.deck-num`; a process-heavy deck may need a `.deck-step`; a photo-driven deck may need a `.deck-caption` and a scrim. Derive the vocabulary from the content — this reference deliberately does not prescribe a fixed pattern set.
- In Astro decks (or MDX with imports), extracting a repeated element into a small component (`<MetricCard value="42%" label="..." />`) is even stronger — use it when the same element appears on three or more slides. If the project's theme already ships a layout or component for the job, prefer it over a custom rebuild.
- Inline `style` attributes are for content-derived values (a chart bar's `width: 57%`) and slide-specific layout (flex ratios) only. Never use them to override what the system decided — font sizes, colors, radii. Wanting `style="font-size: 8cqw"` on one card's number is the signal to add a named variant (`.deck-num--hero`) to the system instead: the ad-hoc override makes this slide's number silently disagree with its twin on another slide, while a named variant keeps every future use of the same emphasis identical.

**What must stay uniform across the whole deck:**

- **Color:** one accent color for every emphasis job (big figures, highlights, active states). A second color only for a semantic contrast the content requires (problem vs. goal, before vs. after) — and then that pairing is used consistently too.
- **Shape and surface:** one corner radius, one border treatment, one surface tint. A card, chip, or panel on slide 6 must be indistinguishable in style from its siblings on slide 3.
- **Type scale:** the same few sizes recur everywhere; a "big number" is the same size on every slide that has one.
- **Placement:** titles sit in the same position at the same scale on every content slide; section breaks share one identical treatment.
- **Formatting:** number precision (zero-fill or not: `2.0分` vs `2分`), unit style, multiplication signs (`×` vs `x`), and date format are decided once and applied to every figure. `12分→3分` on one slide next to `1.5x` on another is visible sloppiness at presentation scale.

**Variety lives inside the system.** Vary slide anatomy across the deck — full-bleed breaks, figure-dominant slides, comparisons, quotes, prose — to create rhythm; three near-identical slides in a row is a monotony defect. But every variation is built from the same tokens and classes. Variety of composition, uniformity of vocabulary.

## Divide the labor: theme layouts vs custom markup

Theme layouts and custom HTML are complements, not rivals.

- Use theme layouts as-is where they already deliver the strongest form: `cover`, `section`, `statement`, and `quote` are deliberate typographic set pieces. Custom rebuilds of these usually look worse.
- Set pieces lose power with repetition: more than one or two `statement` slides in a deck dilutes all of them. Reserve `statement` for the single central claim and the closing action.
- Use custom HTML inside `page`/`default` layouts (or a full-bleed wrapper) whenever the content has structure: metrics, comparisons, timelines, processes, architectures, feature groups. Structured content rendered as bullets is the failure mode this reference exists to prevent.
- Keep the theme's fonts and overall palette unless the user requests a specific aesthetic. Visual richness should come from layout, scale contrast, and color panels — not from introducing new font families per slide.

## Expressing structure

Rather than memorizing patterns, ask what the content's underlying structure is, and give that structure a visible shape using the deck's design system:

- **Peers** (metrics, options, subcommands, features, roles) are the litmus test: lay them out side by side — as tiles, columns, or table cells — so the parallelism is visible. Writing peers as a vertical bullet stack hides the very structure that makes them interesting.
- **Sequences** (steps, phases, history) read left-to-right with visible order — numbering, connectors, or progression.
- **Comparisons** across more than two attributes belong in a table or aligned columns, not prose.
- **Magnitude** (one dominant fact) earns scale: a single figure at 8–12cqw with a one-line qualifier (unit, period, baseline) beats a sentence containing the number.
- **Change** (old value → new value) is a comparison, not a sentence: show both values with visual weight on the new one, rather than burying the change in text.
- **Genuinely list-like content** still gets visual form: each item as its own leaf element with an accent marker, or short parallel items as a horizontal row of chips. Raw markdown bullets are the last resort, acceptable for secondary supporting points, never for a slide's main content.
- **Images:** keep screenshots and diagrams aspect-fit (`object-contain`) inside a bounded box with a contrasting background; never stretch them. Full-bleed photos may aspect-fill (`object-cover`) behind a text protection gradient. Always give meaningful `alt` text.

Do not use emoji as decoration or icons unless the user asks. Prefer real assets, CSS shapes, or plain typographic treatment.

## Composition rules

- One primary message per slide. If a slide needs eight bullets, it is two slides or one table.
- Generous whitespace is structural, not wasted. Content sitting in the upper two-thirds with air below is correct slide composition; resist the web-design reflex to fill or vertically center everything.
- Titles should work as a table of contents: pick one grammatical style (short noun phrases, or short declarative action titles) and use it for every title. Avoid AI-tells: verdict-delivering drama, "It's not X. It's Y.", faux-insightful punchlines like "The magic moment". A title introduces the slide; the speaker delivers the punchline.
