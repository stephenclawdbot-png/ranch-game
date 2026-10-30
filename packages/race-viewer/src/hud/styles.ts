/** Scoped CSS for the viewer HUD (injected once; every class is prefixed `rv-`). */
export const VIEWER_CSS = `
.rv-root{--rv-ink:#0b0f0c;--rv-green:#0f2a1d;--rv-green2:#163a28;--rv-cream:#f3e7c9;--rv-brass:#d9a441;--rv-brass2:#f2c86a;--rv-ox:#7a1f1f;--rv-live:#e5483a;
  --rv-f-display:var(--font-display,"Pixelify Sans","Courier New",monospace);--rv-f-pixel:var(--font-pixel,"Silkscreen",monospace);--rv-f-num:var(--font-num,"Jersey 10",monospace);--rv-f-sans:var(--font-sans,ui-sans-serif,system-ui,sans-serif);
  position:relative;width:100%;font-family:var(--rv-f-sans);color:var(--rv-cream);-webkit-tap-highlight-color:transparent;outline:none}
.rv-panel,.rv-chip,.rv-st,.rv-ticker,.rv-btn,.rv-count,.rv-card,.rv-debug{border-radius:0}
.rv-stage{position:relative;width:100%;overflow:hidden;background:var(--rv-green);border:3px solid var(--rv-ink);box-shadow:inset 0 0 0 2px rgba(242,200,106,.35),0 6px 0 rgba(0,0,0,.35);touch-action:manipulation;user-select:none;-webkit-user-select:none}
.rv-canvas{position:absolute;inset:0}
.rv-canvas canvas{display:block;width:100%!important;height:100%!important}
.rv-loading{position:absolute;inset:0;display:grid;place-items:center;font:12px var(--rv-f-pixel);letter-spacing:.08em;text-transform:uppercase;color:rgba(243,231,201,.7)}
.rv-hud{position:absolute;left:0;right:0;top:0;padding:10px 12px 18px;display:flex;flex-direction:column;gap:6px;pointer-events:none;background:linear-gradient(rgba(8,21,14,.7),rgba(8,21,14,.3) 70%,rgba(8,21,14,0))}
.rv-row{display:flex;justify-content:space-between;align-items:flex-start;gap:10px}
.rv-title{min-width:0}
.rv-name{font-family:var(--rv-f-display);font-weight:700;font-size:18px;line-height:1.1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--rv-cream);text-shadow:2px 2px 0 var(--rv-ink)}
.rv-chips{display:flex;gap:5px;margin-top:5px;flex-wrap:wrap}
.rv-chip{font:10px/1 var(--rv-f-pixel);text-transform:uppercase;letter-spacing:.04em;padding:4px 6px 3px;background:var(--rv-green2);border:2px solid var(--rv-ink);box-shadow:inset 1px 1px 0 rgba(255,255,255,.12);white-space:nowrap}
.rv-chip-turf{background:#2c6645}
.rv-chip-dirt{background:#7a4a2a}
.rv-chip-synthetic{background:#4d4466}
.rv-clock{text-align:right;flex:none}
.rv-time{font-family:var(--rv-f-num);font-size:34px;line-height:.9;font-variant-numeric:tabular-nums;color:var(--rv-brass2);text-shadow:2px 2px 0 var(--rv-ink)}
.rv-togo{font:10px var(--rv-f-pixel);text-transform:uppercase;margin-top:3px;letter-spacing:.04em;text-shadow:1px 1px 0 var(--rv-ink)}
.rv-standings{display:flex;gap:4px;pointer-events:auto}
.rv-st-cand{display:flex;gap:4px;position:absolute;visibility:hidden;pointer-events:none}
.rv-st{display:flex;align-items:center;gap:5px;flex:none;font-size:12px;font-weight:700;line-height:1;padding:3px 7px 3px 3px;background:rgba(15,42,29,.9);border:2px solid var(--rv-ink);box-shadow:inset 1px 1px 0 rgba(242,200,106,.18);white-space:nowrap}
.rv-st-me{background:#3a2c0e;box-shadow:inset 0 0 0 2px var(--rv-brass)}
.rv-st-pos{font-family:var(--rv-f-num);font-size:17px;font-weight:400;width:16px;text-align:center;color:var(--rv-brass2)}
.rv-st-gap{opacity:.75;font-weight:600;font-variant-numeric:tabular-nums}
.rv-swatch{display:inline-block;vertical-align:middle;width:12px;height:12px;flex:none;border:2px solid var(--rv-ink);image-rendering:pixelated}
.rv-ticker{align-self:flex-start;max-width:min(560px,92%);font-size:13px;font-weight:700;padding:5px 10px 5px 8px;background:rgba(11,15,12,.85);border:2px solid var(--rv-ink);border-left:4px solid var(--rv-brass);animation:rv-in .3s steps(3)}
@keyframes rv-in{from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:none}}
.rv-controls{position:absolute;left:0;right:0;bottom:0;display:flex;align-items:center;gap:6px;padding:16px 10px 8px;background:linear-gradient(rgba(8,21,14,0),rgba(8,21,14,.82) 45%)}
.rv-btn{appearance:none;border:2px solid var(--rv-ink);background:var(--rv-green2);color:var(--rv-cream);font:11px var(--rv-f-pixel);text-transform:uppercase;min-width:36px;height:36px;padding:0 9px;display:inline-flex;align-items:center;justify-content:center;gap:5px;cursor:pointer;flex:none;touch-action:manipulation;box-shadow:inset 2px 2px 0 rgba(255,255,255,.14),inset -2px -2px 0 rgba(0,0,0,.35)}
.rv-btn:hover{background:#1f4d35}
.rv-btn:active{box-shadow:inset 2px 2px 0 rgba(0,0,0,.35)}
.rv-btn:focus-visible{outline:2px solid var(--rv-brass2);outline-offset:1px}
.rv-btn[aria-pressed=true]{background:var(--rv-brass);color:var(--rv-ink);box-shadow:inset 2px 2px 0 rgba(255,241,193,.7),inset -2px -2px 0 rgba(122,84,24,.8)}
.rv-btn:disabled{opacity:.4;cursor:default}
.rv-seg{display:flex;flex:none;gap:0}
.rv-seg .rv-btn+.rv-btn{border-left-width:0}
.rv-scrub{flex:1;min-width:60px;display:flex;align-items:center;gap:8px}
.rv-range{flex:1;min-width:40px;height:28px;accent-color:var(--rv-brass);cursor:pointer;background:transparent}
.rv-elapsed{font:18px var(--rv-f-num);font-variant-numeric:tabular-nums;white-space:nowrap;text-shadow:1px 1px 0 var(--rv-ink)}
.rv-live-dot{width:8px;height:8px;background:#8a958e;flex:none}
.rv-live[aria-pressed=true]{background:var(--rv-live);color:#fff;box-shadow:inset 2px 2px 0 rgba(255,255,255,.3),inset -2px -2px 0 rgba(0,0,0,.35)}
.rv-live[aria-pressed=true] .rv-live-dot{background:#fff;animation:rv-pulse 1s steps(2) infinite}
@keyframes rv-pulse{50%{opacity:.2}}
.rv-center{position:absolute;inset:0;display:grid;place-items:center;pointer-events:none;text-align:center}
.rv-center-top{place-items:start center;padding-top:clamp(64px,13%,110px)}
.rv-count{padding:10px 20px 8px;background:rgba(15,42,29,.92);border:3px solid var(--rv-ink);box-shadow:inset 2px 2px 0 rgba(242,200,106,.45),inset -2px -2px 0 rgba(0,0,0,.4)}
.rv-count-k{font:10px var(--rv-f-pixel);text-transform:uppercase;letter-spacing:.06em;color:var(--rv-brass2)}
.rv-count-v{font-family:var(--rv-f-num);font-size:44px;line-height:1;font-variant-numeric:tabular-nums}
.rv-photo{font-family:var(--rv-f-display);font-size:46px;font-weight:700;letter-spacing:.25em;padding:6px 8px 6px 20px;border:4px solid var(--rv-cream);color:var(--rv-cream);transform:rotate(-5deg);text-shadow:3px 3px 0 var(--rv-ink);background:rgba(122,31,31,.55);box-shadow:4px 4px 0 var(--rv-ink);animation:rv-stamp .25s steps(4)}
@keyframes rv-stamp{from{transform:rotate(-5deg) scale(1.6);opacity:0}}
.rv-badge-buffer{right:auto!important;left:12px;background:#8a958e!important}
.rv-minimap{position:absolute;left:10px;right:10px;bottom:54px;height:36px;width:calc(100% - 20px);border:2px solid var(--rv-ink);pointer-events:none;image-rendering:pixelated}
.rv-pip{position:absolute;pointer-events:none;border:3px solid var(--rv-ink);box-shadow:inset 0 0 0 2px var(--rv-brass),3px 3px 0 rgba(0,0,0,.45);margin:-3px}
.rv-pip span{position:absolute;left:4px;top:4px;font:9px var(--rv-f-pixel);text-transform:uppercase;background:var(--rv-brass);color:var(--rv-ink);padding:2px 4px}
.rv-badge{position:absolute;right:12px;bottom:92px;font:10px var(--rv-f-pixel);text-transform:uppercase;padding:5px 8px 4px;background:var(--rv-brass);color:var(--rv-ink);border:2px solid var(--rv-ink);pointer-events:none}
.rv-modal{position:absolute;left:0;right:0;top:0;bottom:52px;display:grid;place-items:center;padding:10px;background:rgba(8,21,14,.5);animation:rv-in .3s steps(3)}
.rv-card{width:min(440px,100%);max-height:100%;overflow:auto;background:var(--rv-green);border:3px solid var(--rv-ink);box-shadow:inset 2px 2px 0 rgba(242,200,106,.5),inset -2px -2px 0 rgba(0,0,0,.45),5px 5px 0 rgba(0,0,0,.45)}
.rv-card-h{display:flex;align-items:flex-start;justify-content:space-between;gap:8px;padding:12px 12px 8px 14px;position:sticky;top:0;background:var(--rv-green);border-bottom:2px solid var(--rv-ink)}
.rv-card-k{font:10px var(--rv-f-pixel);text-transform:uppercase;letter-spacing:.06em;color:var(--rv-brass2)}
.rv-card-t{font-family:var(--rv-f-display);font-size:20px;font-weight:700;margin-top:3px;text-shadow:2px 2px 0 var(--rv-ink)}
.rv-card-s{font-size:12px;opacity:.8;margin-top:2px}
.rv-res{width:100%;border-collapse:collapse;font-size:13px}
.rv-res td{padding:6px 6px;border-top:2px solid rgba(11,15,12,.6);white-space:nowrap}
.rv-res td:first-child{padding-left:14px;font:18px var(--rv-f-num);width:38px;color:var(--rv-cream)}
.rv-res td:last-child{padding-right:14px;text-align:right;opacity:.85;font-weight:600}
.rv-res .rv-res-name{white-space:normal;font-weight:700}
.rv-res .rv-res-time{font:18px var(--rv-f-num);font-variant-numeric:tabular-nums;text-align:right}
.rv-res tr.rv-me td{background:rgba(217,164,65,.2)}
.rv-res tr.rv-win td:first-child{color:var(--rv-brass2)}
.rv-card-f{display:flex;gap:8px;justify-content:flex-end;padding:10px 12px 12px}
.rv-debug{position:absolute;right:8px;top:96px;font:600 10.5px/1.35 ui-monospace,SFMono-Regular,Menlo,monospace;padding:4px 6px;background:rgba(0,0,0,.65);color:#9fe39f;pointer-events:none;white-space:pre}
.rv-narrow .rv-hud{padding:8px 9px 14px;gap:5px}
.rv-narrow .rv-name{font-size:15px}
.rv-narrow .rv-chip{font-size:9px;padding:3px 5px 2px}
.rv-narrow .rv-time{font-size:26px}
.rv-narrow .rv-togo{font-size:9px}
.rv-narrow .rv-st{font-size:11px;padding:2px 6px 2px 2px}
.rv-narrow .rv-st-cand .rv-st-name{max-width:60px;overflow:hidden}
.rv-narrow .rv-standings .rv-st{flex:0 1 auto;min-width:0}
.rv-narrow .rv-standings .rv-st>*{flex:none}
.rv-narrow .rv-standings .rv-st-name{flex:0 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis}
.rv-standings .rv-st-more{flex:none}
.rv-narrow .rv-st-pos{font-size:15px}
.rv-narrow .rv-ticker{font-size:11.5px;padding:4px 8px 4px 6px}
.rv-ticker-low{position:absolute;left:8px;right:8px;bottom:86px;display:flex;pointer-events:none}
.rv-narrow .rv-controls{gap:3px;padding:12px 6px 6px}
.rv-narrow .rv-btn{min-width:32px;height:34px;padding:0 7px;font-size:10px}
.rv-narrow .rv-scrub{min-width:40px}
.rv-narrow .rv-range{min-width:28px}
.rv-narrow .rv-seg .rv-btn{padding:0 5px;gap:4px}
.rv-narrow .rv-elapsed{display:none}
.rv-narrow .rv-modal{bottom:46px;padding:6px}
.rv-narrow .rv-card-h{padding:9px 9px 6px 11px}
.rv-narrow .rv-card-t{font-size:16px}
.rv-narrow .rv-card-s{font-size:11px}
.rv-narrow .rv-res{font-size:12px}
.rv-narrow .rv-res td{padding:4px 4px}
.rv-narrow .rv-res td:first-child{padding-left:10px;width:30px;font-size:16px}
.rv-narrow .rv-res .rv-res-time{font-size:16px}
.rv-narrow .rv-res td:last-child{padding-right:10px}
.rv-narrow .rv-card-f{padding:8px 9px 9px}
.rv-narrow .rv-photo{font-size:30px}
.rv-narrow .rv-count{padding:6px 14px 5px}
.rv-narrow .rv-count-k{font-size:8.5px}
.rv-narrow .rv-count-v{font-size:30px}
.rv-narrow .rv-center-top{padding-top:96px}
.rv-narrow .rv-badge{bottom:72px}
.rv-narrow .rv-minimap{bottom:48px;height:30px;left:6px;right:6px;width:calc(100% - 12px)}
.rv-narrow .rv-debug{bottom:auto;top:92px;font-size:9px}
.rv-cmap{position:absolute;right:10px;top:var(--rv-cmap-top,98px);width:176px;background:rgba(11,15,12,.78);border:2px solid var(--rv-ink);box-shadow:inset 1px 1px 0 rgba(242,200,106,.25),2px 2px 0 rgba(0,0,0,.35);pointer-events:auto}
.rv-cmap-tab{appearance:none;display:flex;align-items:center;gap:6px;width:100%;min-height:24px;padding:3px 6px 2px;background:var(--rv-green2);color:var(--rv-cream);border:0;border-bottom:2px solid var(--rv-ink);font:10px/1 var(--rv-f-pixel);text-transform:uppercase;letter-spacing:.04em;cursor:pointer;text-align:left}
.rv-cmap-tab:focus-visible{outline:2px solid var(--rv-brass2);outline-offset:1px}
.rv-cmap-name{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.rv-cmap-slope{flex:none;padding:2px 4px 1px;background:#e0902f;color:var(--rv-ink)}
.rv-cmap-down{background:#7fb6d9}
.rv-cmap-svg{width:100%;height:auto;max-height:124px;padding:4px}
.rv-cmap-shut{width:auto}
.rv-cmap-shut .rv-cmap-tab{border-bottom:0}
.rv-has-cmap .rv-debug{right:auto;left:8px}
.rv-narrow .rv-cmap{right:6px;top:var(--rv-cmap-top,84px);width:118px}
.rv-narrow .rv-cmap-tab{font-size:9px;min-height:22px;padding:2px 5px 1px;gap:4px}
.rv-narrow .rv-cmap-svg{padding:3px;max-height:70px}
`;

let injected = false;
export function injectViewerCss(): void {
  if (injected || typeof document === "undefined") return;
  injected = true;
  const el = document.createElement("style");
  el.setAttribute("data-race-viewer", "");
  el.textContent = VIEWER_CSS;
  document.head.appendChild(el);
}
