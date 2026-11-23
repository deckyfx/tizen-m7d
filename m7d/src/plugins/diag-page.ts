/**
 * Self-contained browser diagnostics page (`GET /api/diag`).
 *
 * Plain HTML + an ES5 inline script, so it works on very old engines (the TV's).
 * It shows, and POSTs back to `/api/diag`, the features the real UI depends on.
 */
export const DIAG_PAGE_HTML = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>m7d diagnostics</title>
<style>
  :root { color-scheme: light; }
  body { background:#f1f5f9; color:#0f172a; font:22px/1.45 system-ui, sans-serif; margin:40px; }
  main { max-width: 900px; background:#fff; border-radius:16px; padding:28px; box-shadow:0 1px 3px rgba(15,23,42,.08); border:1px solid #e2e8f0; }
  h1 { font-size:30px; margin:16px 0 8px; }
  td { padding:6px 20px 6px 0; vertical-align:top; }
  .ok { color:#047857; font-weight:600; } .bad { color:#be123c; font-weight:600; }
  .ok::before { content:"✔ "; } .bad::before { content:"✖ "; }
  #ua { font-size:16px; color:#475569; word-break:break-all; font-family:ui-monospace, monospace; }
  a.back { display:inline-block; background:#0369a1; color:#fff; padding:10px 18px; border-radius:10px; text-decoration:none; font-weight:600; cursor:pointer; }
  a.back:focus { outline:4px solid #0284c7; outline-offset:3px; }
</style>
</head>
<body>
<main>
<a class="back" href="/" autofocus>&larr; Dashboard</a>
<h1>m7d browser diagnostics</h1>
<p id="ua">(script did not run)</p>
<table id="out"></table>
<p id="sent"></p>
</main>
<script>
(function () {
  var report = {};
  function supports(prop, value) {
    try { return !!(window.CSS && CSS.supports && CSS.supports(prop, value)); } catch (e) { return false; }
  }
  function syntax(code) {
    try { new Function(code); return true; } catch (e) { return false; }
  }
  report.userAgent = navigator.userAgent;
  report.viewport = window.innerWidth + "x" + window.innerHeight;
  report.devicePixelRatio = window.devicePixelRatio || 1;
  report.cssOklch = supports("color", "oklch(0.5 0.1 200)");
  report.cssColorMix = supports("color", "color-mix(in srgb, red 50%, blue)");
  report.cssLayer = typeof window.CSSLayerBlockRule !== "undefined";
  report.cssProperty = typeof window.CSSPropertyRule !== "undefined";
  report.cssGap = supports("gap", "1px");
  report.jsModules = "noModule" in document.createElement("script");
  report.jsOptionalChaining = syntax("var a = {}; return a?.b;");
  report.jsNullishAssign = syntax("var a; a ??= 1;");
  report.jsClassFields = syntax("class A { x = 1; #y = 2; }");
  report.jsTopLevelAwaitHint = syntax("return (async function(){ await 1; })();");

  document.getElementById("ua").textContent = report.userAgent;
  var rows = "";
  for (var key in report) {
    if (key === "userAgent") continue;
    var value = report[key];
    var cls = value === true ? "ok" : value === false ? "bad" : "";
    rows += "<tr><td>" + key + "</td><td class='" + cls + "'>" + value + "</td></tr>";
  }
  document.getElementById("out").innerHTML = rows;

  var xhr = new XMLHttpRequest();
  xhr.open("POST", "/api/diag");
  xhr.setRequestHeader("content-type", "application/json");
  xhr.onload = function () { document.getElementById("sent").textContent = "Report sent to m7d (" + xhr.status + ")."; };
  xhr.onerror = function () { document.getElementById("sent").textContent = "Could not send report."; };
  xhr.send(JSON.stringify(report));
})();
</script>
</body>
</html>`;
