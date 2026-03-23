---
description: "Alakazam project conventions for code style, comments, and commits"
---

# Alakazam Development Standards

## Code Style Preferences

Follow these conventions for all comments and headers:

```js
//! This Is All Capitalized Header
//* This is header 2
// this is helper comment or header 3 with no capitalization
```

- Use `//!` for major section headers (capitalized title case)
- Use `//*` for subsection headers (title case)
- Use `//` for inline comments or tertiary headers (lowercase unless it's a code reference)

## Commit Message Format

```
short descriptive title under 40 chars & use &

- past tense bullet per actual change made
- one change per bullet
- no empty lines between bullet points
```

### Rules
- **Title**: Keep the title under 40 characters, use `&` instead of `and`
  - Focus on *what changed*, not just the action verb
  - Only add type prefixes (`feat:`, `fix:`, etc.) if they provide deeper contextual value
- **Body**: Each bullet point is one atomic change in past tense
- **Spacing**: No blank lines between bullets
- **Example**:
  ```
  Autobuy strategy & efficiency scoring
  
  - added evaluation window tracking variable
  - added getCurrentCookies() helper function
  - rewrote buyBakers() to implement core algorithm
  - replaced inefficient building purchase logic
  ```
