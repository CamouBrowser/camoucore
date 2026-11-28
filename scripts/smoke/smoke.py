#!/usr/bin/env python3
"""Launch an installed Python driver the way a user's code does, and check the launch.

    <venv>/bin/python scripts/smoke/smoke.py <launcher>

The browser is the one <LAUNCHER>_EXECUTABLE_PATH names (CI: the newest
release). A local page records the User-Agent it was requested with; the
navigator's must be the same, and must not name the launcher. Then a click and
typed text go through Playwright's locators, and must arrive as trusted events
that leave the text in the input. smoke.mjs is the npm twin.

Prints one JSON line with what it saw; exits non-zero on a failed check.
"""

import http.server
import importlib
import json
import sys
import threading
from pathlib import Path

PAGE = (Path(__file__).resolve().parent / 'page.html').read_bytes()
TYPED = 'smoketest'


def serve():
    seen = {}

    class Handler(http.server.BaseHTTPRequestHandler):
        def do_GET(self):
            seen['ua'] = self.headers.get('User-Agent', '')
            self.send_response(200)
            self.send_header('Content-Type', 'text/html')
            self.end_headers()
            self.wfile.write(PAGE)

        def log_message(self, *args):
            pass

    server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server, seen


def main() -> int:
    launcher = sys.argv[1]
    api = importlib.import_module(f'camoucore.{launcher}.sync_api')
    browser_class = getattr(api, launcher.capitalize())
    server, seen = serve()
    try:
        with browser_class(headless=True) as browser:
            page = browser.new_page()
            page.goto(f'http://127.0.0.1:{server.server_address[1]}/')
            ua = page.evaluate('navigator.userAgent')
            page.locator('#button').click()
            page.locator('#input').press_sequentially(TYPED)
            events = [json.loads(line) for line in page.locator('#events').text_content().splitlines() if line]
            value = page.locator('#input').input_value()
    finally:
        server.shutdown()
    result = {'navigator_ua': ua, 'wire_ua': seen.get('ua'), 'events': len(events), 'value': value}
    print(json.dumps(result))
    problems = []
    if ua != seen.get('ua'):
        problems.append('the navigator and the request disagree on the User-Agent')
    if launcher in ua.lower():
        problems.append(f'the User-Agent names {launcher}')
    if value != TYPED:
        problems.append(f'the input holds {value!r}, not {TYPED!r}')
    if not events or not all(e['trusted'] for e in events) or len(events) != 1 + len(TYPED):
        problems.append(f'expected 1 trusted click and {len(TYPED)} trusted keydowns, saw {events}')
    for problem in problems:
        print(f'::error::{launcher} (Python): {problem}', file=sys.stderr)
    return 1 if problems else 0


if __name__ == '__main__':
    sys.exit(main())
