/** Scoped CSS for the viewer HUD (injected once; every class is prefixed `rv-`). */
export const VIEWER_CSS = `
.rv-root{position:relative;width:100%;font-family:inherit;color:#f5f3ec;-webkit-tap-highlight-color:transparent;outline:none}
.rv-stage{position:relative;width:100%;overflow:hidden;border-radius:14px;background:#0f1d15;box-shadow:0 10px 30px rgba(0,0,0,.35);touch-action:manipulation;user-select:none;-webkit-user-select:none}
.rv-canvas{position:absolute;inset:0}
.rv-canvas canvas{display:block;width:100%!important;height:100%!important}
.rv-loading{position:absolute;inset:0;display:grid;place-items:center;font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:rgba(255,255,255,.6)}
.rv-hud{position:absolute;left:0;right:0;top:0;padding:10px 12px 18px;display:flex;flex-direction:column;gap:6px;pointer-events:none;background:linear-gradient(rgba(6,12,9,.62),rgba(6,12,9,.28) 65%,rgba(6,12,9,0))}
.rv-row{display:flex;justify-content:space-between;align-items:flex-start;gap:10px}
.rv-title{min-width:0}
.rv-name{font-weight:700;font-size:15px;line-height:1.2;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-shadow:0 1px 2px rgba(0,0,0,.5)}
.rv-chips{display:flex;gap:5px;margin-top:4px;flex-wrap:wrap}
.rv-chip{font-size:11px;font-weight:600;line-height:1;padding:4px 7px;border-radius:999px;background:rgba(255,255,255,.14);border:1px solid rgba(255,255,255,.18);white-space:nowrap}
.rv-chip-turf{background:rgba(70,150,70,.45)}
.rv-chip-dirt{background:rgba(150,100,60,.5)}
.rv-chip-synthetic{background:rgba(110,100,140,.5)}
.rv-clock{text-align:right;flex:none}
.rv-time{font-size:22px;font-weight:800;font-variant-numeric:tabular-nums;line-height:1;letter-spacing:.01em;text-shadow:0 1px 3px rgba(0,0,0,.5)}
.rv-togo{font-size:11px;font-weight:600;opacity:.85;margin-top:4px;font-variant-numeric:tabular-nums;text-transform:uppercase;letter-spacing:.06em}
.rv-standings{display:flex;gap:5px;overflow-x:auto;scrollbar-width:none;pointer-events:auto;mask-image:linear-gradient(90deg,#000 88%,transparent)}
.rv-standings::-webkit-scrollbar{display:none}
.rv-st{display:flex;align-items:center;gap:5px;flex:none;font-size:11.5px;line-height:1;padding:4px 7px 4px 4px;border-radius:7px;background:rgba(10,16,13,.62);border:1px solid rgba(255,255,255,.1);white-space:nowrap}
.rv-st-me{border-color:#f2c230;box-shadow:0 0 0 1px #f2c230 inset}
.rv-st-pos{font-weight:800;width:16px;text-align:center;font-variant-numeric:tabular-nums}
.rv-st-gap{opacity:.7;font-variant-numeric:tabular-nums}
.rv-swatch{display:inline-block;vertical-align:middle;width:13px;height:13px;border-radius:3px;flex:none;border:1px solid rgba(0,0,0,.35)}
.rv-ticker{align-self:flex-start;max-width:min(560px,92%);font-size:13px;font-weight:600;padding:6px 10px;border-radius:8px;background:rgba(10,16,13,.7);border-left:3px solid #f2c230;animation:rv-in .35s ease-out}
@keyframes rv-in{from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:none}}
.rv-controls{position:absolute;left:0;right:0;bottom:0;display:flex;align-items:center;gap:6px;padding:16px 10px 8px;background:linear-gradient(rgba(6,12,9,0),rgba(6,12,9,.72) 45%)}
.rv-btn{appearance:none;border:1px solid rgba(255,255,255,.18);background:rgba(255,255,255,.12);color:#fff;font:inherit;font-size:12px;font-weight:700;min-width:36px;height:36px;padding:0 9px;border-radius:9px;display:inline-flex;align-items:center;justify-content:center;gap:5px;cursor:pointer;flex:none;touch-action:manipulation}
.rv-btn:hover{background:rgba(255,255,255,.2)}
.rv-btn:focus-visible{outline:2px solid #f2c230;outline-offset:1px}
.rv-btn[aria-pressed=true]{background:#f2c230;color:#1b1406;border-color:#f2c230}
.rv-btn:disabled{opacity:.4;cursor:default}
.rv-seg{display:flex;flex:none;border-radius:9px;overflow:hidden;border:1px solid rgba(255,255,255,.18)}
.rv-seg .rv-btn{border:0;border-radius:0;background:rgba(255,255,255,.08)}
.rv-seg .rv-btn[aria-pressed=true]{background:#f2c230;color:#1b1406}
.rv-scrub{flex:1;min-width:60px;display:flex;align-items:center;gap:8px}
.rv-range{flex:1;min-width:40px;height:28px;accent-color:#f2c230;cursor:pointer;background:transparent}
.rv-elapsed{font-size:11.5px;font-weight:600;font-variant-numeric:tabular-nums;opacity:.9;white-space:nowrap}
.rv-live{color:#fff}
.rv-live-dot{width:8px;height:8px;border-radius:50%;background:#9aa;flex:none}
.rv-live[aria-pressed=true]{background:#d7263d;border-color:#d7263d;color:#fff}
.rv-live[aria-pressed=true] .rv-live-dot{background:#fff;animation:rv-pulse 1.2s infinite}
@keyframes rv-pulse{50%{opacity:.3}}
.rv-center{position:absolute;inset:0;display:grid;place-items:center;pointer-events:none;text-align:center}
.rv-center-top{place-items:start center;padding-top:clamp(70px,19%,140px)}
.rv-count{padding:12px 20px;border-radius:14px;background:rgba(8,14,11,.7);border:1px solid rgba(255,255,255,.14)}
.rv-count-k{font-size:11px;letter-spacing:.14em;text-transform:uppercase;opacity:.8;font-weight:700}
.rv-count-v{font-size:38px;font-weight:800;font-variant-numeric:tabular-nums;line-height:1.1}
.rv-photo{font-size:44px;font-weight:900;letter-spacing:.3em;padding:8px 10px 8px 22px;border:4px solid #fff;color:#fff;transform:rotate(-6deg);text-shadow:0 2px 8px rgba(0,0,0,.6);background:rgba(0,0,0,.25);animation:rv-stamp .3s ease-out}
@keyframes rv-stamp{from{transform:rotate(-6deg) scale(1.6);opacity:0}}
.rv-badge{position:absolute;right:12px;bottom:62px;font-size:11px;font-weight:800;letter-spacing:.12em;padding:4px 8px;border-radius:6px;background:rgba(242,194,48,.9);color:#1b1406;pointer-events:none}
.rv-modal{position:absolute;left:0;right:0;top:0;bottom:52px;display:grid;place-items:center;padding:10px;background:rgba(4,8,6,.45);animation:rv-in .3s ease-out}
.rv-card{width:min(440px,100%);max-height:100%;overflow:auto;border-radius:14px;background:rgba(14,22,18,.96);border:1px solid rgba(255,255,255,.14);box-shadow:0 14px 40px rgba(0,0,0,.5)}
.rv-card-h{display:flex;align-items:flex-start;justify-content:space-between;gap:8px;padding:12px 12px 8px 14px;position:sticky;top:0;background:rgba(14,22,18,.98)}
.rv-card-k{font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:#f2c230;font-weight:800}
.rv-card-t{font-size:16px;font-weight:800;margin-top:2px}
.rv-card-s{font-size:12px;opacity:.75;margin-top:2px}
.rv-res{width:100%;border-collapse:collapse;font-size:13px}
.rv-res td{padding:7px 6px;border-top:1px solid rgba(255,255,255,.07);white-space:nowrap}
.rv-res td:first-child{padding-left:14px;font-weight:800;width:34px}
.rv-res td:last-child{padding-right:14px;text-align:right;opacity:.8}
.rv-res .rv-res-name{white-space:normal;font-weight:600}
.rv-res .rv-res-time{font-variant-numeric:tabular-nums;text-align:right}
.rv-res tr.rv-me td{background:rgba(242,194,48,.14)}
.rv-res tr.rv-win td:first-child{color:#f2c230}
.rv-card-f{display:flex;gap:8px;justify-content:flex-end;padding:10px 12px 12px}
.rv-debug{position:absolute;right:8px;bottom:58px;font:600 10.5px/1.35 ui-monospace,SFMono-Regular,Menlo,monospace;padding:4px 6px;border-radius:6px;background:rgba(0,0,0,.6);color:#9fe39f;pointer-events:none;white-space:pre}
.rv-narrow .rv-hud{padding:8px 9px 14px;gap:5px}
.rv-narrow .rv-name{font-size:13px}
.rv-narrow .rv-chip{font-size:10px;padding:3px 6px}
.rv-narrow .rv-time{font-size:18px}
.rv-narrow .rv-togo{font-size:10px}
.rv-narrow .rv-st{font-size:10.5px;padding:3px 6px 3px 3px}
.rv-narrow .rv-ticker{font-size:11.5px;padding:5px 8px}
.rv-ticker-low{position:absolute;left:8px;right:8px;bottom:50px;display:flex;pointer-events:none}
.rv-narrow .rv-controls{gap:4px;padding:12px 6px 6px}
.rv-narrow .rv-btn{min-width:34px;height:34px;padding:0 7px;font-size:11.5px}
.rv-narrow .rv-elapsed{display:none}
.rv-narrow .rv-modal{bottom:46px;padding:6px}
.rv-narrow .rv-card-h{padding:9px 9px 6px 11px}
.rv-narrow .rv-card-t{font-size:14px}
.rv-narrow .rv-card-s{font-size:11px}
.rv-narrow .rv-res{font-size:12px}
.rv-narrow .rv-res td{padding:5px 4px}
.rv-narrow .rv-res td:first-child{padding-left:10px;width:28px}
.rv-narrow .rv-res td:last-child{padding-right:10px}
.rv-narrow .rv-card-f{padding:8px 9px 9px}
.rv-narrow .rv-photo{font-size:30px}
.rv-narrow .rv-count{padding:7px 14px}
.rv-narrow .rv-count-k{font-size:9.5px}
.rv-narrow .rv-count-v{font-size:24px}
.rv-narrow .rv-center-top{padding-top:96px}
.rv-narrow .rv-badge{bottom:52px}
.rv-narrow .rv-debug{bottom:auto;top:92px;font-size:9px}
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
