# CLAUDE.md — Design System Rules for Figma MCP Integration

This document defines how to implement Figma designs in the **إدارة درجات المقرر المشترك** (Course Grade Manager) codebase. Read this before generating or editing any UI code.

---

## 1. Project Overview

- **Framework**: React 18 + TypeScript (Vite)
- **Styling**: Plain CSS — single file `src/styles.css` (no Tailwind, no CSS Modules, no CSS-in-JS)
- **Language/Direction**: Arabic, RTL (`dir="rtl"` on `<html>`)
- **Font**: `"IBM Plex Sans Arabic"` → `"Segoe UI"` → Tahoma → Arial → sans-serif
- **Entry point**: `src/main.tsx` (single-file React app, ~1300 lines)
- **Max container width**: `1480px` (`width: min(1480px, calc(100% - 32px))`)

---

## 2. Design Tokens

No CSS custom properties exist yet — all values are hard-coded. When adding new UI, use these exact values to stay consistent.

### Color Palette

| Token name (conceptual) | Value | Usage |
|---|---|---|
| `brand` | `#1f6f61` | Primary color, buttons, icons, accents, borders |
| `brand-dark` | `#195b50` | Button hover state |
| `brand-bg` | `#e8f3ee` | Light tint backgrounds (chips, badges, icons) |
| `brand-border` | `#c9e3d7` | Borders on tinted areas |
| `brand-border-soft` | `#dbe8e3` | Softer green borders |
| `page-bg` | `#eef2f4` | Root background |
| `surface` | `#ffffff` | Cards, panels, inputs |
| `surface-alt` | `#f9fbfb` / `#fbfcfc` | Subtle card backgrounds |
| `surface-dark` | `#17202a` | Storage panel (dark mode section) |
| `text-primary` | `#17202a` | Body text |
| `text-secondary` | `#607077` | Muted text, helper labels |
| `text-label` | `#445158` | Form labels |
| `text-link` | `#4b5960` | Nav inactive text |
| `text-dark-surface` | `#dbe7e3` | Text on dark panel |
| `text-success-dark` | `#9be0ca` | Success message on dark panel |
| `border` | `#cfd8dc` | Default input/button borders |
| `border-card` | `#dce3e7` | Card/panel borders |
| `border-subtle` | `#e0e6e9` | Table rows, inner borders |
| `border-hover` | `#9ccabd` / `#bfd5ce` | Border on hover |
| `table-header-bg` | `#f7f9fa` | `<th>` background |
| `table-row-hover` | `#f7fbf9` | `<tr>` hover |
| `row-selected` | `#eef7f3` | Selected table row |
| `pill-theory-bg` | `#edf3ff` | Theory assessment pill |
| `pill-theory-text` | `#255184` | Theory assessment text |
| `pill-practical-bg` | `#f0f5e6` | Practical assessment pill |
| `pill-practical-text` | `#4c641f` | Practical assessment text |
| `pill-default-bg` | `#eef1f3` | Neutral pill |
| `pill-default-text` | `#37474f` | Neutral pill text |
| `feature-strip-bg` | `#f6fbf8` | Feature tag backgrounds |
| `feature-strip-border` | `#dbe8e3` | Feature tag borders |
| `feature-strip-text` | `#2c5c53` | Feature tag text |

### Typography Scale

```css
/* Headings */
h1  { font-size: clamp(24px, 3vw, 38px); line-height: 1.35; margin-bottom: 0; }
h2  { font-size: 20px; margin-bottom: 4px; }

/* UI text */
.section-kicker   { font-size: 13px; font-weight: 900; color: #1f6f61; }
.home-kicker      { font-size: 13px; font-weight: 900; color: #1f6f61; }
label             { font-size: 13px; font-weight: 800; color: #445158; }
.muted / small    { font-size: 13px; color: #607077; }
.panel-head span  { font-size: 14px; color: #607077; }
.auth-message     { font-size: 14px; font-weight: 800; color: #1f6f61; }
.metric strong    { font-size: 26px; }
.hero-mini-grid span { font-size: 22px; font-weight: 900; }
.grand-total strong  { font-size: 28px; color: #1f6f61; }
.code-card h2     { font-size: clamp(24px, 4vw, 38px); color: #1f6f61; direction: ltr; }
table th          { font-size: 13px; color: #445158; }
.session-chip     { font-size: 13px; font-weight: 900; }
.home-copy p      { line-height: 1.8; color: #526168; }
```

### Spacing System

Spacing follows a loose 4px/8px grid. Common values:

```
4px   — small gap (card-title gap)
6px   — label-to-input gap, nav button padding inline
8px   — component internal gaps, pill/badge padding
10px  — standard gap (form fields, assessment list, steps)
12px  — medium gap (form padding, trainer tags)
14px  — panel padding (smaller panels), margin before sections
16px  — standard panel padding, grid gap between sections
18px  — topbar margin-bottom
20px  — topbar gap
24px  — app-shell top padding
28px  — empty state padding
40px  — app-shell bottom padding
```

### Border Radius

```
8px   — everything: buttons, cards, inputs, panels, icons, badges
999px — pills (.pill, .status-badge, .session-chip)
```

### Shadows

```css
/* Brand shadow (logo mark, primary elements) */
box-shadow: 0 12px 24px rgba(31, 111, 97, 0.18);

/* Card/panel shadow */
box-shadow: 0 18px 44px rgba(23, 32, 42, 0.07);
```

### Transitions

```css
transition: transform 180ms ease, border-color 180ms ease, background 180ms ease, color 180ms ease;
/* Table rows use 160ms */
```

---

## 3. Component Patterns

### Buttons

```html
<!-- Default -->
<button class="button">Label</button>

<!-- Primary (brand) -->
<button class="button primary">Label</button>

<!-- Icon-only -->
<button class="icon-button" aria-label="...">
  <!-- lucide-react icon, 18px -->
</button>
```

Rules:
- `min-height: 42px`, `border-radius: 8px`, `font-weight: 700`
- Hover: `translateY(-1px)`, border shifts to `#9ccabd`
- Primary hover: `background #195b50`
- Disabled: `opacity: 0.55; cursor: not-allowed`
- On mobile (`≤760px`): full-width

### Cards / Panels

```html
<!-- Standard white panel -->
<div class="panel">
  <div class="panel-head horizontal">
    <div>
      <p class="section-kicker">Section label</p>
      <h2>Title</h2>
      <span>Subtitle or count</span>
    </div>
    <button class="button">Action</button>
  </div>
  <!-- content -->
</div>
```

All panels: `background #fff`, `border 1px solid #dce3e7`, `border-radius 8px`, `padding 16px`.  
Panels have `animation: fadeUp 520–560ms ease both` on mount.  
Hover: `translateY(-2px)`, border shifts to `#bfd5ce`.

### Metrics / KPI Cards

```tsx
<div class="metric">
  <div class="metric-icon">
    <Icon size={22} />   {/* lucide-react icon */}
  </div>
  <span>Label</span>
  <strong>Value</strong>
</div>
```

Grid: `repeat(4, minmax(160px, 1fr))` → `1fr 1fr` on mobile.

### Form Fields

```html
<label>
  Field label
  <input type="text" placeholder="..." />
</label>
```

- Input/select/textarea: `width 100%`, `border 1px solid #cfd8dc`, `border-radius 8px`, `min-height 38px`, `padding 7px 10px`
- Focus: `border-color #1f6f61`, `outline 3px solid rgba(31, 111, 97, 0.14)`
- Textarea: `min-height 118px`, `resize vertical`

### Badges / Pills

```html
<!-- Status badge (rounded-full) -->
<span class="status-badge">Unsaved</span>
<span class="status-badge saved">Saved</span>

<!-- Assessment type pill -->
<span class="pill theory">نظري</span>
<span class="pill practical">عملي</span>

<!-- Session chip -->
<span class="session-chip">مرحبًا، {name}</span>
```

### Section Kicker (eyebrow text)

```html
<p class="section-kicker">كود المقرر</p>
```

Always `font-size: 13px`, `font-weight: 900`, `color: #1f6f61`, `margin: 0 0 4px`.

### Storage Panel (dark)

```html
<div class="storage-panel">
  <div>
    <h2>عنوان</h2>
    <span>وصف</span>
    <strong>رسالة النجاح</strong>
  </div>
  <div class="storage-actions">
    <button class="button">حفظ</button>
  </div>
</div>
```

`background #17202a`, `color #fff`. Buttons inside get `border-color: rgba(255,255,255,0.28)`.

---

## 4. Layout System

### App Shell

```html
<div class="app-shell">   <!-- max-width 1480px, centered, padding 24px 0 40px -->
  <header class="topbar"> <!-- sticky, backdrop-filter blur(14px) -->
    <div class="brand-block">...</div>
    <nav class="main-nav">...</nav>
    <div class="top-actions">...</div>
  </header>
  <!-- panels stack vertically with mb-16px -->
</div>
```

### Key Grid Layouts

```css
/* Home panel: 2-col */
.home-panel       { grid-template-columns: minmax(0, 1fr) minmax(340px, 0.72fr); }

/* Auth panel: 2-col */
.auth-panel       { grid-template-columns: minmax(0, 0.8fr) minmax(320px, 0.55fr); }

/* Course code + join: 2-col */
.course-code-panel { grid-template-columns: minmax(280px, 0.45fr) minmax(0, 1fr); }

/* Trainee import + Assessments: 2-col */
.workflow         { grid-template-columns: minmax(0, 1.2fr) minmax(360px, 0.8fr); }

/* Grades table + student card: 2-col */
.grades-layout    { grid-template-columns: minmax(0, 1fr) 340px; }

/* All collapse to 1fr at ≤1100px */
```

### Responsive Breakpoints

```css
@media (max-width: 1100px) {
  /* All 2-col grids → 1fr */
  /* Topbar wraps, nav goes full-width order:3 */
  /* Student card loses sticky positioning */
}

@media (max-width: 760px) {
  /* app-shell width: min(100% - 20px, 1480px) */
  /* topbar, panel-head, storage-panel → display: grid */
  /* buttons → width: 100% */
  /* metrics-grid → 1fr 1fr */
  /* setup-grid, names-tools, join-form, course-result → 1fr */
}
```

---

## 5. Icon System

**Library**: `lucide-react` (all icons from this package only)

**Icons in use**:
```
BarChart3, CheckCircle2, ClipboardList, Copy, Database, Download,
FileUp, GraduationCap, IdCard, LogIn, LogOut, Plus, RefreshCw,
RotateCcw, Save, Search, ShieldCheck, UserPlus, Users
```

**Usage pattern**:
```tsx
import { Save, Users } from "lucide-react";

// In JSX — always explicit size, color via inheritance
<Save size={18} />
<Users size={22} />

// Icon button with background (metric-icon, brand-mark, step number)
<div class="metric-icon">
  <BarChart3 size={22} />   {/* inherits color: #1f6f61 */}
</div>
```

Icon containers use `width/height: 44px`, `border-radius: 8px`, `background: #e8f3ee`, `color: #1f6f61`.

---

## 6. Animation

```css
@keyframes fadeUp {
  from { opacity: 0; transform: translateY(14px); }
  to   { opacity: 1; transform: translateY(0); }
}

/* Apply to panels on mount */
animation: fadeUp 520ms ease both;  /* home-panel */
animation: fadeUp 540ms ease both;  /* storage-panel */
animation: fadeUp 560ms ease both;  /* setup-panel, auth-panel, code/join cards */
```

---

## 7. Implementing Figma Designs

### Mapping Figma → Code

| Figma concept | Code implementation |
|---|---|
| Frame/Section | `<div class="panel">` or `<section>` |
| Card | `<div class="panel">` with `fadeUp` animation |
| Primary button | `<button class="button primary">` |
| Secondary button | `<button class="button">` |
| Icon button | `<button class="icon-button">` |
| Text input | `<input>` inside `<label>` |
| Chip / tag | `<span class="session-chip">` or `<span class="feature-strip span">` |
| Pill badge | `<span class="pill theory/practical">` |
| Status badge | `<span class="status-badge saved/unsaved">` |
| KPI card | `<div class="metric">` |
| Dark section | `<div class="storage-panel">` |
| 2-column layout | `display: grid; grid-template-columns: ...` |
| Icon with bg | `<div class="metric-icon">` or `<div class="brand-mark">` |

### Adding New Styles

1. Add CSS rules to `src/styles.css` only — never inline styles, never new CSS files.
2. Use the exact token values from Section 2 — no new colors.
3. Use `clamp()` for responsive font sizes on headings.
4. All new cards/panels get: `background #fff`, `border 1px solid #dce3e7`, `border-radius 8px`, `padding 16px`, `animation: fadeUp 520ms ease both`.
5. New grid layouts collapse to `1fr` at `≤1100px`.

### Adding New Components

1. Add to `src/main.tsx` as a function component above the `App` function.
2. Props typed inline or via `types.ts`.
3. Do not create separate component files — the project uses a single-file architecture.

### Asset References

No external image assets in the project. Icons are SVG via lucide-react. The only custom SVG is the favicon (inline in `index.html`).

---

## 8. File Map

```
src/
├── main.tsx       # All React components + App state (1300 lines)
├── styles.css     # All styles (1111 lines)
├── types.ts       # TypeScript types (AppState, Trainee, Assessment, Grade, ...)
├── courseData.ts  # Pure business logic utilities (no side effects)
├── storage.ts     # Supabase CRUD operations
└── supabase.ts    # Supabase client (createClient)

index.html         # dir="rtl" lang="ar", IBM Plex Sans Arabic font, favicon SVG
vite.config.ts     # React plugin + @openai/sites-vite-plugin
```

---

## 9. Figma → Code Checklist

When translating a Figma frame to code:

- [ ] RTL direction preserved (text alignment, flex/grid flow)
- [ ] Font is "IBM Plex Sans Arabic" — no other fonts
- [ ] Colors match tokens in Section 2 exactly
- [ ] Border radius is `8px` (components) or `999px` (pills only)
- [ ] New panels animate with `fadeUp`
- [ ] Hover states use `translateY(-1px)` or `translateY(-2px)` + border color shift
- [ ] Focus states use `border-color #1f6f61` + `outline 3px solid rgba(31,111,97,0.14)`
- [ ] Icons from `lucide-react` only, sized explicitly
- [ ] Responsive: collapses at `1100px` and `760px`
- [ ] CSS goes in `src/styles.css`, components in `src/main.tsx`
