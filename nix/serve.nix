# `nix run .#serve` — serve the built site on localhost, exactly the tree
# pages deploys. no-store because store paths carry a 1970 mtime, and a
# 304 would keep a previous build's modules forever. $RHL_SITE serves a
# checkout's site/ directory instead, for iterating without a rebuild; it
# then also answers game.json and deep.json from the checkout's data/.
{ pkgs, site }:
pkgs.writeShellScript "serve-site" ''
  exec ${pkgs.python3}/bin/python3 - "''${1:-8139}" <<'EOF'
  import http.server, os, sys, urllib.parse

  SITE = os.environ.get("RHL_SITE") or "${site}"
  DATA = os.path.join(SITE, "..", "data")

  class Handler(http.server.SimpleHTTPRequestHandler):
      def translate_path(self, path):
          path = urllib.parse.urlparse(path).path
          if path == "/":
              path = "/index.html"
          if path in ("/game.json", "/deep.json") and os.path.isdir(DATA):
              return os.path.join(DATA, path.lstrip("/"))
          return os.path.join(SITE, path.lstrip("/"))

      def end_headers(self):
          self.send_header("Cache-Control", "no-store")
          super().end_headers()

  http.server.SimpleHTTPRequestHandler.extensions_map[".js"] = "text/javascript"
  port = int(sys.argv[1])
  print(f"serving on http://127.0.0.1:{port}/ (site={SITE})", flush=True)
  http.server.ThreadingHTTPServer(("", port), Handler).serve_forever()
  EOF
''
