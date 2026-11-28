# The MCP server (`camoucore/mcp`)

An [MCP](https://modelcontextprotocol.io) server that lets an agent drive a
Camoufox or Camouwolf browser. The agent reads each page as an accessibility
tree with a ref on every element and acts on those refs; input goes through
the launcher's `humanize` engines, so it moves, types and scrolls like a
person. It types passwords and one-time codes it is never shown, and hands
the window to the person at the keyboard for anything else it must not do
itself, such as a payment.

## Running it

Each launcher's CLI runs the server for its own browser as `<launcher> mcp`,
so the browser repository's npm package is all it takes, with the browser
installed:

```bash
npx -y camouwolf fetch
npx -y camouwolf mcp
```

`npx camoufox mcp` drives Camoufox the same way. A launcher of your own is
served with `serve()` from `camoucore/mcp`, given a module that exports
`PRODUCT` and `NewBrowser`.

In Claude Code:

```bash
claude mcp add camouwolf -- npx -y camouwolf mcp
```

Any other MCP client takes the same command:

```json
{
  "mcpServers": {
    "camouwolf": {
      "command": "npx",
      "args": ["-y", "camouwolf", "mcp"]
    }
  }
}
```

The launcher reads its usual environment, so `CAMOUWOLF_EXECUTABLE_PATH` points
the server at a build of your own. Node.js 22.15 or newer.

## Tools

| Tool | What it does |
|---|---|
| `session_open { os?, visible?, humanize?, passthrough?, profile? }` | Launches one browser with a fresh identity. `visible` opens a window a person can take over; `humanize` defaults to true. `passthrough` launches with this machine's own fingerprint instead, on a launcher that exports `PASSTHROUGH`. `profile` runs on a copy of [your own profile](#your-own-profile). |
| `navigate { session_id, url }` | http and https only. |
| `snapshot { session_id, ref?, depth?, find? }` | The accessibility tree with refs. Refs last until the next snapshot or navigation. On a large page, read only what you need: `ref` is one element's subtree, `depth` stops that many levels down, and `find` keeps the lines containing its text (ignoring case) under their named ancestors. `find` searches the redacted tree, so it cannot test for a secret. |
| `click`, `hover { session_id, ref }` | |
| `type { session_id, ref, text, submit? }` | Key by key; `submit` presses Enter. |
| `type_secret { session_id, ref, name, submit? }` | Types a [secret](#secrets) by name. Only when secrets are configured. |
| `select_option { session_id, ref, options }` | Chooses options in a `<select>` by label or value. |
| `press_key { session_id, key }` | A key or chord on the focused element: `Enter`, `Escape`, `Control+a`. |
| `go_back { session_id }` | One page back in the tab's history. |
| `tabs`, `switch_tab { session_id, index, close? }` | Lists the session's tabs, and moves to one (closing the current one with `close`). |
| `scroll { session_id, ref, delta_y? }` | Into view, then a wheel of `delta_y` pixels. |
| `screenshot { session_id }` | A PNG of the viewport, refused while the page holds a secret. |
| `upload_file { session_id, ref, files }` | Attaches files [from the uploads directory](#uploads), by name, to a file input or to the button that opens a file picker. Only with `--uploads`. |
| `hand_off { session_id, reason }` | Brings a visible session's window to the front. The agent stops and waits for the person. |
| `session_close { session_id }` | Closes the browser. |

One session is one browser and one identity: sessions never share cookies or a
fingerprint. Closing the client closes every browser it opened.

## Secrets

Passwords and one-time codes go in a JSON file that only you can read, scoped
to the sites they belong to, after browser-use's `sensitive_data`:

```json
{
  "https://accounts.example.com": {
    "email": "me@example.com",
    "password": "correct horse battery staple",
    "otp": { "totp": "JBSWY3DPEHPK3PXP" }
  },
  "*.example.org": { "password": "another one" }
}
```

```bash
chmod 600 ~/.config/camoucore-mcp/secrets.json
claude mcp add camouwolf -- npx -y camouwolf mcp \
  --secrets ~/.config/camoucore-mcp/secrets.json
```

- **The agent sees names, never values.** The server's instructions list each
  pattern and its names, and `snapshot` lists those usable on the current page.
  `type_secret` types the value key by key, like `type`.
- **A secret is typed only on its site.** The check is on the URL of the frame
  the field is in, so a login form in a third-party iframe on the right page is
  refused. A pattern is `[scheme://][*.]host[:port][/path]`: the scheme is
  `https` unless it says `http` or `http*` (both), `*.` adds subdomains, and a
  path may end in `*`. Every secret has a pattern; there is no secret for any
  site.
- **Values are redacted from everything the server returns**: snapshots, page
  titles, URLs and errors, as `<secret:name>`, including their HTML, JSON, URL,
  base64 and hex encodings and any change of case. A snapshot holds every
  field's value, masked or not, so this is what keeps a typed password out of
  the conversation.
- **Pixels cannot be redacted,** so `screenshot` is refused while the page
  holds a secret anywhere in its tree.
- **One-time codes:** `{ "totp": "<base32 seed>" }` types the current 6-digit
  code (RFC 6238, SHA-1, 30 seconds), the seed an authenticator app is set up
  with. The seed is never typed or shown.
- The file is refused if anyone but its owner can read it, and a value under 4
  characters is refused, since redacting it would mangle ordinary text.

What this does not cover: the browser's own memory, and anything you paste into
the chat yourself. A secret you have not configured, or a payment, is still a
`hand_off`.

## Your own profile

`--profile <dir>` lets `session_open { profile: true }` start a browser signed
in wherever you are, from your own browser's profile directory (Firefox's is
under `~/.mozilla/firefox/`, or `~/snap/firefox/common/.mozilla/firefox/` for
the snap; `about:profiles` shows it):

```bash
npx camoufox mcp --profile ~/.mozilla/firefox/abcd1234.default-release
```

- **Each session runs on a private copy,** made when it opens and deleted when
  it closes. The browser writes to its profile, Playwright's prefs included, so
  the original is never launched, and nothing the session does is saved back.
  Your own browser can stay open.
- **The agent gets your signed-in sessions,** for every site the profile is
  signed in to. Pair it with `--allowed-domains` to keep it to the ones the task
  needs.
- **Use `passthrough` with it.** Sites know that profile with this machine's
  fingerprint; a drawn one on the same cookies is a mismatch they can see.
- The profile must be the launcher's engine: a Firefox profile for camoufox,
  a Chromium one for camouwolf.

## Uploads

`--uploads <dir>` is the one directory `upload_file` may attach files from.
Without it there is no `upload_file`, since a page could otherwise be sent any
file the server can read. A name that leads out of the directory, by `..`, an
absolute path or a link, is refused, and refused before it is looked at, so the
agent never learns what exists elsewhere.

```bash
npx camoufox mcp --uploads ~/agent-uploads
```

## Allowed domains

`--allowed-domains <pattern,...>` keeps the agent on those sites, with the same
patterns as secrets:

```bash
npx camouwolf mcp --allowed-domains "*.example.com,accounts.example.org"
```

`navigate` refuses any other URL, and a tab whose page goes elsewhere (a link,
a redirect, a script) is sent back to `about:blank`, with the tool call that
saw it refused. No tool result ever shows such a page. It is a guard for an
agent that a page may try to steer, not a network filter: the request that left
the allowed sites has already been sent, and a page's own images, scripts and
iframes may come from anywhere.

