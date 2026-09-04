# @ucdavis/caes-ai-assistant-react

React bindings for embedding a CAES AI assistant. The root entry contains the headless runtime. Accessible UI components and the starter theme are separate opt-in exports. Host applications own their layout, branding, structured renderers, client tools, and typed UI-effect handlers.

## Starter UI

```tsx
import {
  AssistantProvider,
  type AssistantRendererRegistry,
  useAssistant,
} from "@ucdavis/caes-ai-assistant-react";
import {
  AssistantDrawer,
  AssistantLauncher,
} from "@ucdavis/caes-ai-assistant-react/ui";
import "@ucdavis/caes-ai-assistant-react/theme.css";

<AssistantProvider
  createSession={api.createAssistantSession}
  clientTools={clientTools}
  renderers={renderers}
  uiBridge={uiBridge}
>
  <App />
  <AssistantLauncher />
  <AssistantDrawer />
</AssistantProvider>;
```

`styles.css` remains as a compatibility alias for `theme.css`.

Sessions are lazy by default. Mounting `AssistantProvider` alone does not call the host session endpoint. Opening a drawer, rendering a visible panel, or calling `openWithDraft` creates and caches a session. Pass `eager` only when a host intentionally wants session creation at provider mount. Expired sessions are refreshed, and one 401 triggers one forced renewal and retry.

The client owns the versioned CAES AI browser transport. It sends the current protocol version in the request header and envelope, requires the same response header, and validates every streamed event before exposing it to React. A mismatch stops the stream with a compatibility error rather than letting a newer server payload reach application code.

Client tools use a CAES AI-owned implementation shape. Their descriptions and
schemas come from the server-accepted session manifest, so an application cannot
replace a server tool or advertise a browser tool that was not accepted:

```tsx
const clientTools = [{
  name: "set_project_filter",
  execute(args: unknown) {
    setFilter((args as { filter: "all" | "active" }).filter);
    return { applied: true };
  },
}];
```

Host controls can open the drawer with an editable draft. This does not submit the message:

```tsx
function AskAboutThisPage() {
  const assistant = useAssistant();

  return (
    <button
      type="button"
      onClick={() => assistant.openWithDraft("How many active items do I have?")}
    >
      Try Ask CAES AI
    </button>
  );
}
```

## Integrated UI

Applications that use Tailwind or another design system can omit `theme.css`. The components keep their accessible behavior and expose `className`, standard DOM props, and stable `data-caes-ai-slot` attributes.

```tsx
import {
  AssistantApproval,
  AssistantComposer,
  AssistantMessages,
} from "@ucdavis/caes-ai-assistant-react/ui";

function ProjectAssistant() {
  return (
    <aside className="flex h-full flex-col bg-white">
      <AssistantMessages className="min-h-0 flex-1 overflow-y-auto p-4" />
      <AssistantApproval className="px-4" />
      <AssistantComposer
        className="border-t p-4"
        placeholder="Ask about this project"
      />
    </aside>
  );
}
```

`AssistantPanel` supplies the default header and component composition when an application wants the shared structure without the theme. Its `messagesProps`, `approvalProps`, and `composerProps` configure the contained components. `AssistantDrawer` accepts the same configuration through `panelProps`.

The component classes remain for the starter theme. The `data-caes-ai-slot` attributes are the customization contract for host CSS. For example:

```css
[data-caes-ai-slot="message"][data-role="user"] {
  background: var(--color-primary-50);
}
```

The theme reads scoped custom properties such as `--caes-ai-assistant-accent`, `--caes-ai-assistant-surface`, `--caes-ai-assistant-border`, and `--caes-ai-assistant-width`. It does not write variables to `:root`.

## Structured presentations

Keep charts, tables, and domain cards in the host application. Register them by the `display.kind` returned in a validated tool output envelope:

```tsx
const renderers: AssistantRendererRegistry = {
  "spend-by-category": SpendByCategoryChart,
  "project-balances": ProjectBalanceTable,
};
```

This package does not depend on a chart or table library. A host may use Recharts, ECharts, TanStack Table, plain HTML, or its existing design system without adding those dependencies to every assistant.

The root entry exports `AssistantProvider`, `useAssistant`, `createAssistantClient`, and CAES AI-owned types. Its emitted declarations do not expose TanStack types. Session and tool descriptor types come directly from `@ucdavis/caes-ai-protocol`, and host session responses receive runtime validation before use. The `/ui` entry exports `AssistantDrawer`, `AssistantInline`, `AssistantPanel`, `AssistantLauncher`, `AssistantMessages`, `AssistantComposer`, `AssistantApproval`, and their prop types. TanStack AI remains the package's internal chat engine and a peer runtime dependency, so an application can upgrade the shared package without writing TanStack-specific tool definitions or transport code. Build all entries with `npm run build --workspace @ucdavis/caes-ai-assistant-react`.

Client tool arguments and results are checked against the accepted session schemas
before host execution and before submission. Validation uses Ajv compilation in the
browser; hosts using a CSP that disallows dynamic code generation must account for
this when enabling client tools. Registering an implementation alone does not add
it to the session's accepted tool manifest.
