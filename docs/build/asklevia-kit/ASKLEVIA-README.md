# Asklevia

Asklevia is an AI diagnosis and virtual hospital platform. The name joins Asklēpios, the Greek god of medicine, with Latin *levāre*, "to relieve". The identity is light-mode only: calm Paper and White surfaces, Ink type, and one signature device, the Neural Spectrum, used sparingly so it always means "AI is involved here".

## Voice and content

- Write for busy clinicians: short sentences, the finding first, the next step second.
- Plain clinical language. Use real terms (KL grade, DICOM, MRN) and explain them once in a tooltip.
- Buttons start with a verb, in sentence case: "Start analysis", "Sign report".
- Never overstate the AI. Say "AI-assisted", show the probability, and say when confidence is low. Never write "diagnosed by AI".
- No exclamation marks, no emoji, no hype words ("revolutionary", "magic").
- Example data is always labelled as example ("Example patient A"). Never show real patient data in demos.

## Colour

- **Grounds**: the page is `bg-page` (Paper, #F7F8FB); content sits on `bg-surface` (White) cards with a `border-default` hairline. Quiet fills use `bg-subtle`.
- **Text**: `text-primary` (Ink) for body and headings, `text-secondary` (Graphite) for supporting text, `text-tertiary` for metadata and placeholders. All pass 4.5:1 on Paper and White.
- **Action**: `action-primary` (Indigo #2B2FD9) is the only interactive colour: buttons, links, focus, selection. White text on it is 8.4:1.
- **Neural Spectrum**: indigo → violet → azure → teal → verdant, always in that order, left to right or bottom to top. In the interface it appears in exactly three places: the spectrum Progress bar (AI at work), the `ai` Badge (AI-produced content) and the spectrum Divider (one per page at most). Teal and verdant are never text colours (3.4:1).
- **Status**: `success-600`, `warning-600`, `danger-600`, `info-600` on their `*-50` surfaces, always with an icon or a word. Status colours are separate from the spectrum: a verdant spectrum band never means "success".
- No gradients other than the spectrum, no dark mode, no tinted page backgrounds.

## Typography

- **Funnel Display** (500) for display and headings: `display-xl` 56/60 to `heading-3` 20/28, tracking −2% to −0.5%.
- **Host Grotesk** for everything else: `body` 16/24, `body-sm` 14/20, `label` 14/20 at 600, `caption` 12/16. Never below 12px.
- **Geist Mono** only for data: IDs, measurements, probabilities, model versions, with tabular figures (`mono`, `mono-lg`).
- One heading level per section; headings are sentence case.

## Layout and spacing

- A 4px base. Steps: `space-1` 4, `space-2` 8, `space-3` 12, `space-4` 16, `space-6` 24, `space-8` 32, `space-12` 48, `space-16` 64, `space-24` 96.
- Content max width 1200px; 12-column grid with 24px gutters on desktop, 16px side margins on phones.
- App shell: 64px App bar, optional 264px Side navigation, page padding 32px.
- Breakpoints: 640, 768, 1024, 1280px.

## Shape and depth

- Capsules come from the logo's coil: buttons, chips, badges, progress bars and pagination use `radius-pill`.
- Containers use soft corners: inputs `radius-sm` 8, alerts `radius-md` 12, cards and dialogs `radius-lg` 16.
- Depth is mostly hairlines. Cards rest flat; `shadow-sm` on hover, `shadow-md` for menus and toasts, `shadow-lg` for dialogs only.

## Motion

- Durations: 120ms for hover and press, 200ms for toggles and tabs, 320ms for dialogs, toasts and progress. Easing `cubic-bezier(0.2, 0.8, 0.2, 1)`.
- Motion explains a change; it never decorates. Everything respects `prefers-reduced-motion`.
- Signature moment: on the AI Progress bar the spectrum is revealed left to right as analysis advances.

## Iconography

- Outline icons, 2px stroke, round caps and joins, on a 24px grid, shown at 16, 20 or 24px. The open-source Lucide set matches this style.
- Icons inherit `currentColor`. Pair every icon-only button with an `aria-label`.

## Logo

- Use the files in Assets › Logos. Horizontal lockup in the App bar and documents; symbol alone for avatars, app icons and favicons.
- Clear space: a quarter of the symbol's height on every side. Minimum: symbol 16px, horizontal lockup 120px wide.
- Light backgrounds only. Never recolour, reorder or add a second coil to the symbol.

## Accessibility

- Every text token meets WCAG 2.2 AA on Paper and White; control borders meet 3:1.
- Focus is always visible: a 2px `focus-ring` outline, 2px offset.
- Touch targets are at least 40px (48px on mobile forms).
- Status, confidence and errors always carry words or icons, never colour alone.

## Using this system on the website

1. Load `tokens.css` once (it declares the colours, type, spacing and the three `@font-face` rules), then `components/bundle.css` (the `ak-` component classes).
2. Wrap the app in `<body class="ak-app">`.
3. Build with the classes shown on each component card. They are framework-free: use `class` in HTML, `className` in React.
4. Tailwind projects: add the Asklevia preset from the download so utilities like `bg-bg-surface`, `text-text-secondary` and `rounded-pill` map to the same tokens.
5. Never hard-code a hex value in product code: reference a token.
