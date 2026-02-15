# Architecture Decisions Log

This document records the architectural decisions made for CodeBridge, including the context, options considered, and the reasoning behind the chosen approach.

## 1. Session Tracking and Timer Overlay

**Context**: We needed a way to track how long a user spends on a problem and display this time to them while they code.

**Decision**: Implement the timer logic primarily in the **Content Script** (`src/content/sessionTracker.js`) with state persistence in `chrome.storage.local`, backed by a Background Service for cross-tab synchronization.

**Reasoning**:
-   **Visibility**: The timer needs to be visible on the problem page (overlay). A popup-only timer would require the user to click the extension icon to see their time.
-   **Accuracy**: Running the visual timer update loop in the content script (`requestAnimationFrame` or `setInterval`) allows for smooth UI updates without flooding the messaging channel to the background script.
-   **Persistence**: Storing start/end times in `storage.local` ensures the timer survives page reloads or tab closures.
-   **Sync**: The background script (`src/background/session/sessionManager.js`) acts as the source of truth for session state to handle multiple tabs of the same problem or browser restarts.

## 2. Dynamic Platform Configuration

**Context**: The extension supports multiple platforms (LeetCode, Codeforces, HackerRank). Hardcoding platform-specific logic and UI options led to scattered conditionals and maintenance overhead.

**Decision**: Centralize platform definitions in `src/utils/constants.js` using a `SUPPORTED_PLATFORMS` array.

**Reasoning**:
-   **Extensibility**: Adding a new platform now only requires adding an entry to the constant and creating a corresponding adapter. The Options page and Session Tracker automatically pick up the new platform.
-   **Consistency**: Display names, host patterns, and adapter paths are defined in one place.
-   **UI Generation**: The Options page can dynamically generate checkboxes for enabling/disabling platforms, removing the need to manually edit HTML for every new platform.

## 3. DOM-based Timer Overlay

**Context**: We needed to inject a timer UI into third-party websites (LeetCode, etc.).

**Decision**: Inject a floating `<div>` with scoped CSS (using unique IDs like `#cb-timer-overlay`) directly into the `document.body`.

**Reasoning**:
-   **Simplicity**: Direct injection is simpler than Shadow DOM for this use case, as we only need a few specific styles.
-   **Draggability**: A custom implementation allows for a draggable floating window that persists its position across reloads (saved in `storage.local`).
-   **Independence**: The overlay is independent of the host site's layout, ensuring it works even if the site changes its CSS class names (which LeetCode does frequently).

## 4. Adapter Pattern for Content Extraction

**Context**: Each coding platform has a completely different DOM structure for problem titles, descriptions, and code editors.

**Decision**: Use an **Adapter Pattern**. `src/content/adapters/` contains specific modules for each platform (e.g., `leetcodeAdapter.js`, `hackerrankAdapter.js`) that implement a common interface (`detectPageType`, `extractProblemId`, `getDifficulty`).

**Reasoning**:
-   **Isolation**: Platform-specific DOM selectors are isolated in their own files. If LeetCode updates their UI, we only touch `leetcodeAdapter.js`.
-   **Polymorphism**: The main `sessionTracker.js` doesn't need to know *how* to extract data, just *which* adapter to ask.
-   **Fallback**: A `BaseAdapter` provides default implementations for common behaviors.
